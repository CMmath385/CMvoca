'use strict';
/*
  WORD BATTLE 점수 판정 엔진 (순수 함수 — Firebase 를 모른다)
  - Cloud Functions 가 Firestore 트랜잭션 안에서 방 상태를 읽어 이 함수에 넣고,
    돌려받은 새 상태를 같은 트랜잭션에서 저장한다. 트랜잭션이 요청을 한 줄로 세워 주므로
    동시에 여러 학생이 정답을 내도 "먼저 처리된 한 명"만 정답자가 된다.
  - 모든 함수는 받은 상태를 고치지 않고 새 상태를 돌려준다.
*/

const DEFAULT_CONFIG = {
  correct: [10, 10, 20], // 라운드별 정답 점수
  wrong: 5,              // 오답 감점
  timeout: 2,            // 미응답 감점
  pointRate: 1,          // 최종 점수 → 교환 포인트 비율
  tieBreak: ['correct', 'avgMs']
};

const clone = o => JSON.parse(JSON.stringify(o));
const fail = (room, reason) => ({ room, ok: false, reason });

/** 새 방 상태. players: [{uid, character}] */
function createRoom(players, config) {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const p = {};
  players.forEach(x => {
    p[x.uid] = { score: 0, roundScore: [0, 0, 0], correct: 0, wrong: 0, noAnswer: 0, correctMs: 0, character: x.character, baseCharacter: x.character };
  });
  return { cfg, players: p, q: null, swap: null };
}

function addScore(pl, round, delta) { pl.score += delta; pl.roundScore[round - 1] += delta; }

/** 문제 열기 (이전 문제가 열려 있으면 먼저 정리해야 한다) */
function openQuestion(room, id, round, now, limitMs) {
  if (room.q && !room.q.closed) return fail(room, 'PREVIOUS_OPEN');
  const r = clone(room);
  r.q = { id, round, openedAt: now, deadlineAt: now + limitMs, closed: false, closeReason: null, winnerUid: null, answered: {} };
  return { room: r, ok: true };
}

function closeWith(r, reason) {
  const q = r.q, c = r.cfg;
  Object.keys(r.players).forEach(uid => {
    if (q.answered[uid]) return;
    addScore(r.players[uid], q.round, -c.timeout);
    r.players[uid].noAnswer++;
    q.answered[uid] = { none: true };
  });
  q.closed = true; q.closeReason = reason;
}

/**
 * 답 제출. ok = 서버가 채점한 정답 여부.
 * 한 학생은 한 문제에 한 번만 제출할 수 있다 (중복 제출은 점수에 영향 없음).
 */
function submitAnswer(room, uid, ok, now) {
  if (!room.players[uid]) return fail(room, 'NOT_PLAYER');
  if (!room.q) return fail(room, 'NO_QUESTION');
  if (room.q.closed) return fail(room, 'CLOSED');
  if (now >= room.q.deadlineAt) { const t = closeByTimeout(room, now); return { room: t.room, ok: false, reason: 'LATE' }; }
  if (room.q.answered[uid]) return fail(room, 'DUPLICATE');

  const r = clone(room), q = r.q, c = r.cfg, pl = r.players[uid];
  q.answered[uid] = { ok: !!ok, at: now };
  if (ok) {
    addScore(pl, q.round, c.correct[q.round - 1]);
    pl.correct++; pl.correctMs += now - q.openedAt;
    q.winnerUid = uid;
    closeWith(r, 'WINNER'); // 아직 안 낸 학생만 −2, 이미 오답을 낸 학생은 그대로
    return { room: r, ok: true, correct: true, winnerUid: uid };
  }
  addScore(pl, q.round, -c.wrong); pl.wrong++;
  if (Object.keys(r.players).every(u => q.answered[u])) { q.closed = true; q.closeReason = 'ALL_ANSWERED'; }
  return { room: r, ok: true, correct: false };
}

/** 제한시간이 지났으면 문제를 닫는다. 여러 번 불러도 한 번만 반영된다. */
function closeByTimeout(room, now) {
  if (!room.q || room.q.closed || now < room.q.deadlineAt) return { room, ok: false, reason: 'NOT_YET' };
  const r = clone(room); closeWith(r, 'TIMEOUT');
  return { room: r, ok: true };
}

/* ---------- 순위 ---------- */
function avgMs(p) { return p.correct ? p.correctMs / p.correct : Infinity; }
function compare(a, b, tieBreak) {
  if (b.p.score !== a.p.score) return b.p.score - a.p.score;
  for (const k of tieBreak) {
    if (k === 'correct' && b.p.correct !== a.p.correct) return b.p.correct - a.p.correct;
    if (k === 'avgMs' && avgMs(a.p) !== avgMs(b.p)) return avgMs(a.p) - avgMs(b.p);
  }
  return 0;
}
/** 점수 순 정렬. 모든 기준이 같으면 같은 순위. */
function ranking(room) {
  const list = Object.entries(room.players).map(([uid, p]) => ({ uid, p }));
  list.sort((a, b) => compare(a, b, room.cfg.tieBreak) || (a.uid < b.uid ? -1 : 1));
  let rank = 0;
  return list.map((x, i) => {
    if (i === 0 || compare(list[i - 1], x, room.cfg.tieBreak) !== 0) rank = i + 1;
    return { uid: x.uid, rank, score: x.p.score, correct: x.p.correct, wrong: x.p.wrong, noAnswer: x.p.noAnswer, roundScore: x.p.roundScore };
  });
}

/* ---------- 캐릭터 획득권 ---------- */
/** 라운드 종료 후: 지금까지 누적 점수 1등이 획득권을 받는다. 완전 동점이면 없음. */
function openSwap(room, now, limitMs) {
  const rk = ranking(room);
  if (rk.length < 2 || (rk[1].rank === 1)) return { room, ok: false, reason: 'NO_HOLDER' };
  const r = clone(room);
  r.swap = { holderUid: rk[0].uid, deadlineAt: now + limitMs, used: false, targetUid: null };
  return { room: r, ok: true, holderUid: rk[0].uid };
}
function useSwap(room, uid, targetUid, now) {
  const s = room.swap;
  if (!s) return fail(room, 'NO_TICKET');
  if (s.holderUid !== uid) return fail(room, 'NOT_HOLDER');
  if (s.used) return fail(room, 'ALREADY_USED');
  if (now >= s.deadlineAt) return fail(room, 'EXPIRED');
  if (targetUid === uid || !room.players[targetUid]) return fail(room, 'BAD_TARGET');
  const r = clone(room), a = r.players[uid], b = r.players[targetUid];
  [a.character, b.character] = [b.character, a.character];
  r.swap.used = true; r.swap.targetUid = targetUid;
  return { room: r, ok: true };
}
/** 라운드가 끝나면 원래 캐릭터로 돌려놓고 획득권을 정리한다 */
function revertCharacters(room) {
  const r = clone(room);
  Object.values(r.players).forEach(p => { p.character = p.baseCharacter; });
  r.swap = null;
  return r;
}

/** 경기 최종 점수 → 교환 가능 포인트 (0 이하면 적립 없음) */
function pointsFor(score, rate) { return Math.max(0, Math.floor(score * (rate === undefined ? 1 : rate))); }

module.exports = { DEFAULT_CONFIG, createRoom, openQuestion, submitAnswer, closeByTimeout, ranking, openSwap, useSwap, revertCharacters, pointsFor };
