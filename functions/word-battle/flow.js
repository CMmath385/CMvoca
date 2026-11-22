'use strict';
/*
  WORD BATTLE 방 진행 흐름 (순수 함수 — Firebase 를 모른다)
  Cloud Functions 가 Firestore 트랜잭션 안에서 room·secret 을 읽어 아래 함수를 부르고, 결과를 저장한다.
  - room   : wb_rooms/{id}   (학생 화면이 실시간으로 읽는다. 정답·채점 정보 없음)
  - secret : wb_secrets/{id} (서버 전용. questions=학생에게 보낼 문제 60개, secrets=정답·채점)
  상태: WAITING → IN_PROGRESS → ROUND_RESULT → SWAP_TICKET → IN_PROGRESS … → COMPLETED / CANCELLED
  모든 함수는 받은 상태를 고치지 않고 새 상태를 돌려준다. 시간(now)은 항상 밖에서 넣는다.
  반환: { ok, room, reason?, changed? }  — ok=false 라도 changed=true 면 room 을 저장해야 한다(예: 시간 초과 정리).
*/
const E = require('./engine');
const { grade } = require('./questions');

const CHARACTERS = ['검은이', '말티즈', '다람쥐', '핵잼이'];
const ROOM_MAX = 4, ROOM_MIN = 2;
const DEFAULT_TIMING = { limitMs: [15000, 15000, 25000], revealMs: 1500, roundResultMs: 5000, swapMs: 10000, swapAnimMs: 1500, waitingTtlMs: 30 * 60 * 1000 };
const clone = o => JSON.parse(JSON.stringify(o));
const no = (room, reason) => ({ ok: false, room, reason });
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0 O 1 I L) 제외

function makeCode(rand) { let c = ''; for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]; return c; }

/** 방 만들기. match = questions.buildMatch() 결과, words = { title, count, itemIds } */
function createRoom({ id, code, hostUid, hostBranchId, character, words, match, cfg, timing, now }) {
  if (!CHARACTERS.includes(character)) return { ok: false, reason: 'BAD_CHARACTER' };
  const t = { ...DEFAULT_TIMING, ...(timing || {}) };
  const eng = E.createRoom([{ uid: hostUid, character }], cfg);
  const room = {
    ...eng, id, code, status: 'WAITING', hostUid, createdAt: now, expiresAt: now + t.waitingTtlMs, timing: t,
    playerUids: [hostUid], branchIds: [hostBranchId], words, total: match.questions.length, perRound: match.meta.perRound, reducedRound: match.meta.reduced,
    round: 0, qIndex: -1, cur: null, reveal: null, nextAt: null, result: null, finalized: false
  };
  room.players[hostUid].ready = true; room.players[hostUid].branchId = hostBranchId; room.players[hostUid].left = false;
  const secret = { id, questions: match.questions, secrets: match.secrets };
  return { ok: true, room, secret };
}

function taken(room, character, exceptUid) { return Object.entries(room.players).some(([u, p]) => u !== exceptUid && p.baseCharacter === character); }

function joinRoom(room, uid, branchId, character, now) {
  if (room.status !== 'WAITING') return no(room, 'NOT_WAITING');
  if (now >= room.expiresAt) return no(room, 'EXPIRED');
  if (room.players[uid]) return no(room, 'ALREADY_IN');
  if (room.playerUids.length >= ROOM_MAX) return no(room, 'FULL');
  if (!CHARACTERS.includes(character)) return no(room, 'BAD_CHARACTER');
  if (taken(room, character)) return no(room, 'CHARACTER_TAKEN');
  const r = clone(room);
  r.players[uid] = { ...E.newPlayer(character), ready: false, branchId, left: false };
  r.playerUids.push(uid); if (!r.branchIds.includes(branchId)) r.branchIds.push(branchId);
  return { ok: true, room: r, changed: true };
}

function chooseCharacter(room, uid, character) {
  if (room.status !== 'WAITING') return no(room, 'NOT_WAITING');
  if (!room.players[uid]) return no(room, 'NOT_PLAYER');
  if (!CHARACTERS.includes(character)) return no(room, 'BAD_CHARACTER');
  if (taken(room, character, uid)) return no(room, 'CHARACTER_TAKEN');
  const r = clone(room); r.players[uid].character = r.players[uid].baseCharacter = character; r.players[uid].ready = uid === r.hostUid;
  return { ok: true, room: r, changed: true };
}

function setReady(room, uid, ready) {
  if (room.status !== 'WAITING') return no(room, 'NOT_WAITING');
  if (!room.players[uid]) return no(room, 'NOT_PLAYER');
  const r = clone(room); r.players[uid].ready = !!ready; return { ok: true, room: r, changed: true };
}

function activeUids(room) { return room.playerUids.filter(u => !room.players[u].left); }

/** 나가기. 대기 중이면 목록에서 빼고(방장이 나가면 다음 사람이 방장), 진행 중이면 "나감"으로 표시한다. */
function leaveRoom(room, uid, now) {
  if (!room.players[uid] || room.players[uid].left) return no(room, 'NOT_PLAYER');
  if (['COMPLETED', 'CANCELLED'].includes(room.status)) return no(room, 'ENDED');
  const r = clone(room);
  if (r.status === 'WAITING') {
    delete r.players[uid]; r.playerUids = r.playerUids.filter(u => u !== uid);
    r.branchIds = [...new Set(r.playerUids.map(u => r.players[u].branchId))];
    if (!r.playerUids.length) r.status = 'CANCELLED';
    else if (r.hostUid === uid) { r.hostUid = r.playerUids[0]; r.players[r.hostUid].ready = true; }
    return { ok: true, room: r, changed: true };
  }
  r.players[uid].left = true;
  if (activeUids(r).length < ROOM_MIN) { r.status = 'CANCELLED'; r.cur = null; r.nextAt = null; }
  return { ok: true, room: r, changed: true };
}

/** 방장이 경기를 모두 끝낸다 (대기 중이든 진행 중이든). 점수·포인트는 기록하지 않고 방을 닫는다 */
function endRoom(room, uid, now) {
  if (['COMPLETED', 'CANCELLED'].includes(room.status)) return no(room, 'ENDED');
  if (uid !== room.hostUid) return no(room, 'NOT_HOST');
  const r = clone(room);
  r.status = 'CANCELLED'; r.cur = null; r.reveal = null; r.nextAt = null; r.swap = null; r.endedBy = 'host'; r.endedAt = now;
  return { ok: true, room: r, changed: true };
}

/** 문제 하나 열기 (다음 번호) */
function openNext(room, secret, now) {
  const idx = room.qIndex + 1, pub = secret.questions[idx];
  const o = E.openQuestion(room, pub.id, pub.round, now, room.timing.limitMs[pub.round - 1]);
  if (!o.ok) return o;
  const r = o.room;
  r.status = 'IN_PROGRESS'; r.round = pub.round; r.qIndex = idx; r.cur = pub; r.reveal = null; r.nextAt = null;
  return { ok: true, room: r };
}

/** 방장이 게임 시작: 방장 외 모두 준비 완료, 2명 이상 */
function startGame(room, secret, uid, now) {
  if (room.status !== 'WAITING') return no(room, 'NOT_WAITING');
  if (uid !== room.hostUid) return no(room, 'NOT_HOST');
  if (now >= room.expiresAt) return no(room, 'EXPIRED');
  if (room.playerUids.length < ROOM_MIN) return no(room, 'NEED_MORE_PLAYERS');
  if (!room.playerUids.every(u => room.players[u].ready)) return no(room, 'NOT_READY');
  const o = openNext(room, secret, now);
  return o.ok ? { ok: true, room: o.room, changed: true } : o;
}

function closeInfo(room, secret) {
  const s = secret.secrets[room.qIndex];
  return s.kind === 'choice' ? { kind: 'choice', answerIndex: s.answerIndex, word: s.word } : { kind: 'spell', word: s.word };
}
function afterClose(r, secret, now) { r.reveal = closeInfo(r, secret); r.nextAt = now + r.timing.revealMs; }

/** 답 제출 (정답 채점은 여기서, 서버에서만) */
function submit(room, secret, uid, qid, answer, now) {
  if (room.status !== 'IN_PROGRESS' || !room.cur) return no(room, 'NOT_IN_PROGRESS');
  if (!room.players[uid] || room.players[uid].left) return no(room, 'NOT_PLAYER');
  if (room.cur.id !== qid) return no(room, 'STALE_QUESTION');
  const ok = grade(secret.secrets[room.qIndex], answer);
  const res = E.submitAnswer(room, uid, ok, now);
  const r = clone(res.room);
  const wasOpen = room.q && !room.q.closed;
  if (wasOpen && r.q.closed) afterClose(r, secret, now);
  const changed = res.ok || (wasOpen && r.q.closed); // 늦은 제출이 시간 종료 정리를 일으킨 경우도 저장
  return res.ok ? { ok: true, room: r, correct: res.correct, changed: true } : { ok: false, room: r, reason: res.reason, changed };
}

function endRound(room, secret, now) {
  const r = E.revertCharacters(room); // 라운드가 끝나면 캐릭터를 원래대로
  r.cur = null; r.reveal = null;
  if (r.round >= 3) return finalize(r, now);
  r.status = 'ROUND_RESULT'; r.nextAt = now + r.timing.roundResultMs;
  return r;
}

function finalize(r, now) {
  r.status = 'COMPLETED'; r.nextAt = null;
  const rank = E.ranking(r);
  r.result = rank.map(x => ({ ...x, character: r.players[x.uid].baseCharacter, points: E.pointsFor(x.score, r.cfg.pointRate) }));
  return r;
}

/**
 * 시간이 흐르면 방을 앞으로 보낸다 (문제 시간 종료 → 정답 공개 → 다음 문제 → 라운드 결과 → 획득권 → 다음 라운드 → 종료).
 * 학생 화면이 시간이 되면 호출한다. 여러 명이 동시에 불러도 한 번만 반영된다 (이미 지난 단계는 건너뜀).
 */
function tick(room, secret, now) {
  if (['COMPLETED', 'CANCELLED'].includes(room.status)) return no(room, 'ENDED');
  if (room.status === 'WAITING') {
    if (now >= room.expiresAt) { const r = clone(room); r.status = 'CANCELLED'; return { ok: true, room: r, changed: true }; }
    return no(room, 'NOT_YET');
  }
  let r = clone(room), changed = false, guard = 0;
  while (guard++ < 5) {
    if (r.status === 'IN_PROGRESS') {
      if (r.q && !r.q.closed) {
        const c = E.closeByTimeout(r, now); if (!c.ok) break;
        r = clone(c.room); afterClose(r, secret, now); changed = true; continue;
      }
      if (r.q && r.q.closed && r.nextAt !== null && now >= r.nextAt) {
        const next = secret.questions[r.qIndex + 1];
        if (next && next.round === r.round) { const o = openNext(r, secret, now); if (!o.ok) break; r = o.room; }
        else r = endRound(r, secret, now);
        changed = true; continue;
      }
      break;
    }
    if (r.status === 'ROUND_RESULT' && now >= r.nextAt) {
      const s = E.openSwap(r, now, r.timing.swapMs);
      if (s.ok) { r = clone(s.room); r.status = 'SWAP_TICKET'; r.nextAt = r.swap.deadlineAt; }
      else { const o = openNext(r, secret, now); if (!o.ok) break; r = o.room; }
      changed = true; continue;
    }
    if (r.status === 'SWAP_TICKET' && now >= r.nextAt) {
      const o = openNext(r, secret, now); if (!o.ok) break; r = o.room; changed = true; continue;
    }
    break;
  }
  return changed ? { ok: true, room: r, changed: true } : no(room, 'NOT_YET');
}

/** 캐릭터 획득권 사용 (1등만, 한 번, 시간 안에) */
function useSwap(room, uid, targetUid, now) {
  if (room.status !== 'SWAP_TICKET') return no(room, 'NO_TICKET');
  const u = E.useSwap(room, uid, targetUid, now);
  if (!u.ok) return u;
  const r = clone(u.room); r.nextAt = now + r.timing.swapAnimMs; // 바뀌는 모습을 잠깐 보여 준 뒤 다음 라운드
  return { ok: true, room: r, changed: true };
}

/** 경기가 끝났을 때 한 번만 저장할 기록 (성적·포인트). 이미 저장했으면 null */
function finalizeEffects(room) {
  if (room.status !== 'COMPLETED' || room.finalized || !room.result) return null;
  const winners = room.result.filter(x => x.rank === 1).map(x => x.uid);
  return room.result.map(x => ({
    uid: x.uid, branchId: room.players[x.uid].branchId, rank: x.rank, score: x.score, points: x.points,
    correct: x.correct, wrong: x.wrong, noAnswer: x.noAnswer, character: x.character, won: winners.includes(x.uid) && winners.length === 1
  }));
}

/** 학생에게 보여 줄 방 (정답·다른 사람의 오답 여부는 가린다) */
function publicView(room) {
  const r = clone(room);
  if (r.q && !r.q.closed) r.q.answered = Object.fromEntries(Object.keys(r.q.answered).map(u => [u, { done: true }]));
  return r;
}

module.exports = { CHARACTERS, ROOM_MAX, ROOM_MIN, DEFAULT_TIMING, makeCode, createRoom, joinRoom, chooseCharacter, setReady, leaveRoom, endRoom, startGame, submit, tick, useSwap, finalizeEffects, publicView };
