'use strict';
/* 사용법: node test/engine.test.js — 점수 판정 엔진 검사 (Firebase 필요 없음) */
const assert = require('assert');
const E = require('../engine');

let pass = 0; const t = (n, f) => { f(); pass++; console.log('  ✓', n); };
const mk = (n = 4) => E.createRoom(['A', 'B', 'C', 'D'].slice(0, n).map((u, i) => ({ uid: u, character: ['검은이', '말티즈', '다람쥐', '핵잼이'][i] })));
const open = (room, round = 1, id = 'q', now = 1000, lim = 10000) => E.openQuestion(room, id, round, now, lim).room;
const sc = room => Object.fromEntries(Object.entries(room.players).map(([u, p]) => [u, p.score]));

t('첫 정답자만 +10, 아직 안 낸 나머지는 −2', () => {
  const r = E.submitAnswer(open(mk()), 'B', true, 2000);
  assert(r.ok && r.correct); assert.deepStrictEqual(sc(r.room), { A: -2, B: 10, C: -2, D: -2 }); assert(r.room.q.closed);
});
t('정답 전에 오답을 낸 학생은 −5 그대로 (추가 감점 없음)', () => {
  let r = E.submitAnswer(open(mk()), 'A', false, 1500).room;
  r = E.submitAnswer(r, 'C', true, 2000).room;
  assert.deepStrictEqual(sc(r), { A: -5, B: -2, C: 10, D: -2 });
});
t('정답이 닫힌 뒤 늦게 온 정답은 점수 없음 (동시 제출 → 한 명만)', () => {
  const a = E.submitAnswer(open(mk()), 'A', true, 2000);
  const b = E.submitAnswer(a.room, 'B', true, 2000); // 같은 시각에 처리된 두 번째 요청
  assert(!b.ok && b.reason === 'CLOSED'); assert.strictEqual(sc(b.room).A, 10); assert.strictEqual(sc(b.room).B, -2);
});
t('같은 학생 중복 제출은 점수가 두 번 바뀌지 않음', () => {
  let r = E.submitAnswer(open(mk()), 'A', false, 1500);
  const again = E.submitAnswer(r.room, 'A', false, 1600); assert(!again.ok && again.reason === 'DUPLICATE');
  const again2 = E.submitAnswer(r.room, 'A', true, 1600); assert(!again2.ok); assert.strictEqual(sc(again2.room).A, -5);
});
t('시간 종료: 오답 −5(이미 반영), 미응답 −2, 두 번 불러도 한 번만', () => {
  let r = E.submitAnswer(open(mk()), 'A', false, 1500).room;
  const t1 = E.closeByTimeout(r, 12000); assert(t1.ok); assert.deepStrictEqual(sc(t1.room), { A: -5, B: -2, C: -2, D: -2 });
  const t2 = E.closeByTimeout(t1.room, 13000); assert(!t2.ok); assert.deepStrictEqual(sc(t2.room), sc(t1.room));
  assert(!E.closeByTimeout(r, 5000).ok, '시간 전에는 닫히지 않음');
});
t('전원 오답이면 시간을 기다리지 않고 종료', () => {
  let r = open(mk(3));
  ['A', 'B', 'C'].forEach((u, i) => { r = E.submitAnswer(r, u, false, 1500 + i).room; });
  assert(r.q.closed && r.q.closeReason === 'ALL_ANSWERED'); assert.deepStrictEqual(sc(r), { A: -5, B: -5, C: -5 });
});
t('제한시간이 지난 뒤 제출은 거부되고 미응답으로 정리됨', () => {
  const r = E.submitAnswer(open(mk()), 'A', true, 12000);
  assert(!r.ok && r.reason === 'LATE'); assert(r.room.q.closed); assert.deepStrictEqual(sc(r.room), { A: -2, B: -2, C: -2, D: -2 });
});
t('참가자가 아니면 거부 / 문제가 없으면 거부', () => {
  assert.strictEqual(E.submitAnswer(open(mk()), 'Z', true, 2000).reason, 'NOT_PLAYER');
  assert.strictEqual(E.submitAnswer(mk(), 'A', true, 2000).reason, 'NO_QUESTION');
});
t('라운드별 정답 점수 (R1 +10, R2 +10, R3 +20) · 오답 감점은 R3도 −5', () => {
  [[1, 10], [2, 10], [3, 20]].forEach(([rd, pts]) => assert.strictEqual(E.submitAnswer(open(mk(), rd), 'A', true, 2000).room.players.A.score, pts));
  assert.strictEqual(E.submitAnswer(open(mk(), 3), 'A', false, 2000).room.players.A.score, -5);
});
t('점수는 라운드를 넘어 계속 누적됨', () => {
  let r = mk();
  r = E.submitAnswer(open(r, 1, 'r1-1'), 'A', true, 2000).room;     // A +10
  r = E.submitAnswer(open(r, 2, 'r2-1'), 'A', true, 2000).room;     // A +10
  r = E.submitAnswer(open(r, 3, 'r3-1'), 'B', true, 2000).room;     // B +20, A −2
  assert.strictEqual(r.players.A.score, 18); assert.deepStrictEqual(r.players.A.roundScore, [10, 10, -2]);
  assert.strictEqual(r.players.B.score, -4 + 20);
});
t('원래 문제를 닫기 전에 다음 문제를 열 수 없음', () => assert.strictEqual(E.openQuestion(open(mk()), 'q2', 1, 3000, 1000).reason, 'PREVIOUS_OPEN'));
t('엔진은 받은 상태를 고치지 않음', () => { const r0 = open(mk()), snap = JSON.stringify(r0); E.submitAnswer(r0, 'A', true, 2000); assert.strictEqual(JSON.stringify(r0), snap); });

t('순위: 점수 → 정답 수 → 평균 반응시간, 완전 동점이면 같은 순위', () => {
  let r = mk(3);
  r = E.submitAnswer(open(r, 1, 'a', 0), 'A', true, 3000).room;   // A +10, B −2, C −2
  r = E.submitAnswer(open(r, 1, 'b', 0), 'B', true, 1000).room;   // B +10, A −2, C −2  → A 8 B 8 C −4
  const rk = E.ranking(r); assert.deepStrictEqual(rk.map(x => x.uid), ['B', 'A', 'C']); assert.deepStrictEqual(rk.map(x => x.rank), [1, 2, 3]);
  const tie = E.ranking(mk()); assert(tie.every(x => x.rank === 1));
});
t('획득권: 그 시점 누적 1등만 받음 / 동점이면 없음', () => {
  let r = E.submitAnswer(open(mk()), 'C', true, 2000).room;
  const s = E.openSwap(r, 5000, 10000); assert(s.ok && s.holderUid === 'C');
  assert(!E.openSwap(mk(), 5000, 10000).ok);
});
t('획득권: 서로 바꾸기, 점수는 그대로, 라운드가 끝나면 원래대로', () => {
  let r = E.submitAnswer(open(mk()), 'C', true, 2000).room;
  r = E.openSwap(r, 5000, 10000).room; const before = sc(r);
  const u = E.useSwap(r, 'C', 'A', 6000); assert(u.ok);
  assert.strictEqual(u.room.players.C.character, '검은이'); assert.strictEqual(u.room.players.A.character, '다람쥐');
  assert.deepStrictEqual(sc(u.room), before);
  const back = E.revertCharacters(u.room); assert.strictEqual(back.players.C.character, '다람쥐'); assert.strictEqual(back.players.A.character, '검은이'); assert.strictEqual(back.swap, null);
});
t('획득권: 1등이 아니면 / 자기 자신 / 두 번째 사용 / 시간 초과는 거부', () => {
  let r = E.openSwap(E.submitAnswer(open(mk()), 'C', true, 2000).room, 5000, 10000).room;
  assert.strictEqual(E.useSwap(r, 'A', 'B', 6000).reason, 'NOT_HOLDER');
  assert.strictEqual(E.useSwap(r, 'C', 'C', 6000).reason, 'BAD_TARGET');
  assert.strictEqual(E.useSwap(r, 'C', 'Z', 6000).reason, 'BAD_TARGET');
  assert.strictEqual(E.useSwap(r, 'C', 'A', 16000).reason, 'EXPIRED');
  const u = E.useSwap(r, 'C', 'A', 6000).room; assert.strictEqual(E.useSwap(u, 'C', 'B', 6500).reason, 'ALREADY_USED');
});
t('포인트: 최종 점수 → 교환 포인트 (0 이하는 적립 없음, 비율 적용)', () => {
  assert.strictEqual(E.pointsFor(137), 137); assert.strictEqual(E.pointsFor(-20), 0); assert.strictEqual(E.pointsFor(0), 0); assert.strictEqual(E.pointsFor(137, 0.5), 68);
});

/* 무작위 경기 1000판: 어떤 순서·중복·지연이 와도 문제당 정답자는 최대 1명, 합계가 맞음 */
t('무작위 1000판: 정답자 최대 1명 · 점수 합계가 규칙과 일치', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let g = 0; g < 1000; g++) {
    let r = mk(2 + Math.floor(rnd() * 3)); const uids = Object.keys(r.players); let expected = 0;
    for (let q = 0; q < 12; q++) {
      const round = 1 + (q % 3); r = E.openQuestion(r, 'q' + q, round, q * 100000, 10000).room;
      let winners = 0, now = q * 100000;
      for (let k = 0; k < 8; k++) {
        now += Math.floor(rnd() * 3000); const u = uids[Math.floor(rnd() * uids.length)], ok = rnd() < 0.4;
        const res = E.submitAnswer(r, u, ok, now); r = res.room; if (res.ok && res.correct) winners++;
      }
      r = E.closeByTimeout(r, q * 100000 + 20000).room;
      assert(winners <= 1 && r.q.closed);
      const w = r.q.winnerUid; assert.strictEqual(!!w, winners === 1);
    }
    // 학생별: 점수 = 정답 득점 − 오답×5 − 미응답×2
    Object.values(r.players).forEach(p => assert.strictEqual(p.score, p.roundScore.reduce((a, b) => a + b, 0)));
  }
});

console.log(`\n통과 ${pass}개`);
