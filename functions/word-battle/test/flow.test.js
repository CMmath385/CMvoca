'use strict';
/* 사용법: node test/flow.test.js — 방 진행 흐름 검사 (Firebase 필요 없음, 가짜 단어로 한 판을 끝까지 돌린다) */
const assert = require('assert');
const F = require('../flow');
const { buildMatch } = require('../questions');

let pass = 0; const t = (n, f) => { f(); pass++; console.log('  ✓', n); };

const letters = 'abcdefghijklmnopqrstuvwxyz';
const words = Array.from({ length: 90 }, (_, i) => ({ en: 'w' + letters[i % 26] + letters[Math.floor(i / 26)] + letters[(i * 7) % 26] + 'x', ko: '뜻' + (i + 1), pos: i % 2 ? 'n' : 'v' }));
const match = buildMatch(words, { seed: 'test' });
const W = { title: '시험 단어', count: 90, itemIds: ['i1'] };
const T0 = 1_000_000;

function newRoom(n = 4) {
  const c = F.createRoom({ id: 'R1', code: 'ABC234', hostUid: 'P0', hostBranchId: 'B0', character: F.CHARACTERS[0], words: W, match, now: T0 });
  assert(c.ok); let room = c.room;
  for (let i = 1; i < n; i++) { const j = F.joinRoom(room, 'P' + i, 'B' + (i % 2), F.CHARACTERS[i], T0 + i); assert(j.ok, j.reason); room = j.room; room = F.setReady(room, 'P' + i, true).room; }
  return { room, secret: c.secret };
}
const answerFor = (secret, idx, right) => { const s = secret.secrets[idx]; return s.kind === 'choice' ? (right ? s.answerIndex : (s.answerIndex + 1) % 4) : (right ? s.accept[0] : 'zzzzzz'); };

/* 한 판을 끝까지 돌린다. who(idx, uids) → { winner: uid|null, wrong: [uid], dt } */
function play(room, secret, who, opts = {}) {
  let now = T0 + 100, guard = 0, swaps = 0;
  const s = F.startGame(room, secret, 'P0', now); assert(s.ok, s.reason); room = s.room;
  while (!['COMPLETED', 'CANCELLED'].includes(room.status) && guard++ < 4000) {
    if (room.status === 'IN_PROGRESS' && room.q && !room.q.closed) {
      const plan = who(room.qIndex, room.playerUids);
      for (const u of plan.wrong || []) { now += 50; const r = F.submit(room, secret, u, room.cur.id, answerFor(secret, room.qIndex, false), now); if (r.changed) room = r.room; }
      if (plan.winner) { now += plan.dt || 800; const r = F.submit(room, secret, plan.winner, room.cur.id, answerFor(secret, room.qIndex, true), now); if (r.changed) room = r.room; }
    }
    if (room.status === 'SWAP_TICKET' && opts.useSwap && !room.swap.used) {
      const target = room.playerUids.find(u => u !== room.swap.holderUid), u = F.useSwap(room, room.swap.holderUid, target, now + 10);
      assert(u.ok, u.reason); room = u.room; swaps++;
      assert.notStrictEqual(room.players[room.swap.holderUid].character, room.players[room.swap.holderUid].baseCharacter);
    }
    const target = room.status === 'IN_PROGRESS' && room.q && !room.q.closed ? room.q.deadlineAt : room.nextAt;
    now = Math.max(now, target); const tk = F.tick(room, secret, now); if (tk.changed) room = tk.room;
  }
  return { room, swaps };
}

t('방 만들기·참가: 정원 4명, 같은 캐릭터 불가, 준비 전에는 시작 불가', () => {
  const { room, secret } = newRoom(2);
  assert.strictEqual(F.joinRoom(room, 'PX', 'B1', F.CHARACTERS[0], T0 + 5).reason, 'CHARACTER_TAKEN');
  assert.strictEqual(F.joinRoom(room, 'P1', 'B1', F.CHARACTERS[2], T0 + 5).reason, 'ALREADY_IN');
  assert.strictEqual(F.joinRoom(room, 'PX', 'B1', '없는캐릭터', T0 + 5).reason, 'BAD_CHARACTER');
  let r = F.joinRoom(room, 'P2', 'B1', F.CHARACTERS[2], T0 + 5).room; r = F.joinRoom(r, 'P3', 'B1', F.CHARACTERS[3], T0 + 6).room;
  assert.strictEqual(F.joinRoom(r, 'P4', 'B1', F.CHARACTERS[1], T0 + 7).reason, 'FULL');
  assert.strictEqual(F.startGame(r, secret, 'P0', T0 + 8).reason, 'NOT_READY');
  assert.strictEqual(F.startGame(room, secret, 'P1', T0 + 8).reason, 'NOT_HOST');
  assert.strictEqual(F.startGame(F.createRoom({ id: 'R', code: 'X', hostUid: 'H', hostBranchId: 'B', character: F.CHARACTERS[0], words: W, match, now: T0 }).room, secret, 'H', T0).reason, 'NEED_MORE_PLAYERS');
});
t('다른 지점 학생이 한 방에 들어오면 지점 목록에 모두 기록', () => { const { room } = newRoom(4); assert.deepStrictEqual([...room.branchIds].sort(), ['B0', 'B1']); });
t('방 코드는 6자리, 헷갈리는 글자(0 O 1 I L) 없음', () => { for (let i = 0; i < 200; i++) assert(/^[A-HJKMNP-Z2-9]{6}$/.test(F.makeCode(Math.random))); });
t('캐릭터 바꾸기: 비어 있는 캐릭터만, 바꾸면 준비 해제', () => {
  const { room } = newRoom(2);
  assert.strictEqual(F.chooseCharacter(room, 'P1', F.CHARACTERS[0]).reason, 'CHARACTER_TAKEN');
  const r = F.chooseCharacter(room, 'P1', F.CHARACTERS[3]); assert(r.ok && r.room.players.P1.character === F.CHARACTERS[3] && !r.room.players.P1.ready);
});

t('한 판 끝까지: 60문제 · 3라운드 · 획득권 2번 · 최종 순위·포인트', () => {
  const { room, secret } = newRoom(4);
  const { room: end, swaps } = play(room, secret, (idx, uids) => { const w = idx % 7 === 0 ? uids[0] : uids[idx % 4]; return { winner: w, wrong: idx % 5 === 0 ? [uids[(idx + 1) % 4]].filter(u => u !== w) : [] }; }, { useSwap: true });
  assert.strictEqual(end.status, 'COMPLETED'); assert.strictEqual(end.qIndex, 59); assert.strictEqual(swaps, 2, '획득권은 라운드 1·2 뒤에만');
  assert.strictEqual(end.result.length, 4); assert(end.result.every((x, i, a) => i === 0 || a[i - 1].score >= x.score));
  const sumCorrect = end.result.reduce((a, x) => a + x.correct, 0); assert.strictEqual(sumCorrect, 60, '문제마다 정답자 1명');
  assert(end.result.every(x => x.points === Math.max(0, x.score)));
  Object.values(end.players).forEach(p => assert.strictEqual(p.character, p.baseCharacter, '끝나면 원래 캐릭터'));
  const r3 = end.result.reduce((a, x) => a + x.roundScore[2], 0); assert(r3 > 0);
});
t('획득권을 안 써도 시간이 지나면 다음 라운드로 넘어감', () => {
  const { room, secret } = newRoom(3); const { room: end, swaps } = play(room, secret, (idx, uids) => ({ winner: uids[0] }), { useSwap: false });
  assert.strictEqual(end.status, 'COMPLETED'); assert.strictEqual(swaps, 0); assert.strictEqual(end.players.P0.correct, 60);
});
t('아무도 안 풀면: 문제마다 전원 −2, 끝까지 진행, 포인트 0', () => {
  const { room, secret } = newRoom(2); const { room: end } = play(room, secret, () => ({}));
  assert.strictEqual(end.status, 'COMPLETED'); end.result.forEach(x => { assert.strictEqual(x.score, -120); assert.strictEqual(x.points, 0); });
});
t('전원 오답이면 시간을 기다리지 않고 정답 공개', () => {
  const { room, secret } = newRoom(2); let r = F.startGame(room, secret, 'P0', T0 + 100).room;
  r = F.submit(r, secret, 'P0', r.cur.id, answerFor(secret, 0, false), T0 + 200).room;
  const x = F.submit(r, secret, 'P1', r.cur.id, answerFor(secret, 0, false), T0 + 300); assert(x.ok && x.room.q.closed && x.room.reveal.kind === 'choice' && x.room.nextAt === T0 + 300 + 3000);
});
t('동시에 같은 시각 정답 2명: 먼저 처리된 1명만 득점, 두 번째는 CLOSED', () => {
  const { room, secret } = newRoom(3); const r = F.startGame(room, secret, 'P0', T0 + 100).room;
  const a = F.submit(r, secret, 'P1', r.cur.id, answerFor(secret, 0, true), T0 + 500); const b = F.submit(a.room, secret, 'P2', r.cur.id, answerFor(secret, 0, true), T0 + 500);
  assert(a.ok && a.correct && !b.ok && b.reason === 'CLOSED'); assert.strictEqual(a.room.players.P1.score, 10); assert.strictEqual(a.room.players.P2.score, -2);
});
t('지난 문제 번호로 낸 답은 거부 (STALE_QUESTION)', () => {
  const { room, secret } = newRoom(2); const r = F.startGame(room, secret, 'P0', T0 + 100).room;
  assert.strictEqual(F.submit(r, secret, 'P0', 'r1-99', 0, T0 + 200).reason, 'STALE_QUESTION'); assert.strictEqual(F.submit(room, secret, 'P0', 'r1-1', 0, T0 + 200).reason, 'NOT_IN_PROGRESS');
});
t('tick 은 여러 번(여러 명이) 불러도 한 단계만 반영 — 같은 시각 두 번째는 NOT_YET', () => {
  const { room, secret } = newRoom(2); const r = F.startGame(room, secret, 'P0', T0 + 100).room;
  const t1 = F.tick(r, secret, r.q.deadlineAt); assert(t1.ok && t1.room.q.closed); const t2 = F.tick(t1.room, secret, r.q.deadlineAt); assert(!t2.ok && t2.reason === 'NOT_YET');
  assert.deepStrictEqual(Object.values(t1.room.players).map(p => p.score), [-2, -2]);
});
t('오래 멈춰 있다가 tick 이 와도 정답 공개 시간은 그때부터 보장 → 그다음 tick 에서 다음 문제', () => {
  const { room, secret } = newRoom(2); const r = F.startGame(room, secret, 'P0', T0 + 100).room;
  const late = T0 + 100 + 60000, t1 = F.tick(r, secret, late); assert(t1.ok && t1.room.q.closed && t1.room.qIndex === 0 && t1.room.nextAt === late + 3000);
  const t2 = F.tick(t1.room, secret, late + 3000); assert(t2.ok && t2.room.qIndex === 1 && !t2.room.q.closed);
});
t('학생 화면용 방 정보: 문제가 열려 있는 동안 남의 정답·오답 여부가 안 보임', () => {
  const { room, secret } = newRoom(3); let r = F.startGame(room, secret, 'P0', T0 + 100).room;
  r = F.submit(r, secret, 'P1', r.cur.id, answerFor(secret, 0, false), T0 + 200).room; const v = F.publicView(r);
  assert.deepStrictEqual(v.q.answered, { P1: { done: true } }); assert(!JSON.stringify(F.publicView(r)).includes('"answerIndex"'));
});
t('진행 중 나가면 "나감" 표시(미응답 처리), 2명 미만이 되면 경기 취소', () => {
  const { room, secret } = newRoom(3); const r = F.startGame(room, secret, 'P0', T0 + 100).room;
  const a = F.leaveRoom(r, 'P2', T0 + 200); assert(a.ok && a.room.players.P2.left && a.room.status === 'IN_PROGRESS');
  assert.strictEqual(F.submit(a.room, secret, 'P2', a.room.cur.id, 0, T0 + 250).reason, 'NOT_PLAYER');
  const b = F.leaveRoom(a.room, 'P1', T0 + 300); assert.strictEqual(b.room.status, 'CANCELLED');
});
t('대기 중 방장이 나가면 다음 사람이 방장 / 모두 나가면 취소', () => {
  const { room } = newRoom(2); const a = F.leaveRoom(room, 'P0', T0 + 10); assert.strictEqual(a.room.hostUid, 'P1'); assert(a.room.players.P1.ready);
  assert.strictEqual(F.leaveRoom(a.room, 'P1', T0 + 20).room.status, 'CANCELLED');
});
t('대기실을 오래 두면 만료 (참가·시작 불가, tick 으로 취소)', () => {
  const { room, secret } = newRoom(2); const late = room.expiresAt + 1;
  assert.strictEqual(F.joinRoom(room, 'PX', 'B1', F.CHARACTERS[2], late).reason, 'EXPIRED'); assert.strictEqual(F.startGame(room, secret, 'P0', late).reason, 'EXPIRED');
  assert.strictEqual(F.tick(room, secret, late).room.status, 'CANCELLED');
});
t('획득권: 1등만, 한 번만, 시간 안에, 경기 상태가 SWAP_TICKET 일 때만', () => {
  const { room, secret } = newRoom(3);
  let r = F.startGame(room, secret, 'P0', T0 + 100).room, now = T0 + 100;
  for (let i = 0; i < 20; i++) { r = F.submit(r, secret, 'P1', r.cur.id, answerFor(secret, r.qIndex, true), now + 10).room; now = r.nextAt; r = F.tick(r, secret, now).room; }
  now = r.nextAt; r = F.tick(r, secret, now).room; assert.strictEqual(r.status, 'SWAP_TICKET'); assert.strictEqual(r.swap.holderUid, 'P1');
  assert.strictEqual(F.useSwap(r, 'P2', 'P0', now + 1).reason, 'NOT_HOLDER');
  const u = F.useSwap(r, 'P1', 'P2', now + 1); assert(u.ok); assert.strictEqual(u.room.players.P1.character, F.CHARACTERS[2]); assert.strictEqual(F.useSwap(u.room, 'P1', 'P0', now + 2).reason, 'ALREADY_USED');
  assert.strictEqual(F.tick(u.room, secret, now + 5).reason, 'NOT_YET', '바뀌는 모습을 보여 주는 동안은 대기');
  const n = F.tick(u.room, secret, now + 1 + 1500); assert.strictEqual(n.room.status, 'IN_PROGRESS'); assert.strictEqual(n.room.round, 2); assert.strictEqual(n.room.players.P1.character, F.CHARACTERS[2]);
});
t('경기가 끝나면 성적·포인트 기록 목록은 한 번만 만들어짐', () => {
  const { room, secret } = newRoom(2); const { room: end } = play(room, secret, (idx, uids) => ({ winner: uids[idx % 2] }));
  const e = F.finalizeEffects(end); assert.strictEqual(e.length, 2); assert(e.every(x => x.branchId && typeof x.points === 'number'));
  assert.strictEqual(F.finalizeEffects({ ...end, finalized: true }), null); assert.strictEqual(F.finalizeEffects({ ...end, status: 'IN_PROGRESS' }), null);
});

t('방장 전체 종료: 방장만, 대기·진행 중 모두, 종료 후 제출·tick 불가, 포인트 기록 없음', () => {
  const { room, secret } = newRoom(3);
  assert.strictEqual(F.endRoom(room, 'P1', T0 + 5).reason, 'NOT_HOST');
  const w = F.endRoom(room, 'P0', T0 + 5); assert(w.ok && w.room.status === 'CANCELLED' && w.room.endedBy === 'host');
  let r = F.startGame(room, secret, 'P0', T0 + 100).room; r = F.submit(r, secret, 'P1', r.cur.id, answerFor(secret, 0, true), T0 + 200).room;
  const e = F.endRoom(r, 'P0', T0 + 300); assert(e.ok && e.room.status === 'CANCELLED' && e.room.cur === null);
  assert.strictEqual(F.submit(e.room, secret, 'P2', 'r1-1', 0, T0 + 400).reason, 'NOT_IN_PROGRESS'); assert.strictEqual(F.tick(e.room, secret, T0 + 99999).reason, 'ENDED');
  assert.strictEqual(F.finalizeEffects(e.room), null); assert.strictEqual(F.endRoom(e.room, 'P0', T0 + 500).reason, 'ENDED');
});
console.log(`\n통과 ${pass}개`);
