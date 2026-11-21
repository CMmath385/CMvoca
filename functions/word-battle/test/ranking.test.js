'use strict';
const assert = require('assert'); const { periodStart, buildRanking, KST } = require('../ranking');
let n = 0; const t = (m, f) => { f(); n++; console.log('  ✓', m); };
const kst = (y, mo, d, h = 12) => Date.UTC(y, mo - 1, d, h) - KST;
t('주간 시작은 월요일 0시(한국시간)', () => { const s = periodStart('week', kst(2026, 11, 21)); assert.strictEqual(new Date(s + KST).toISOString(), '2026-11-16T00:00:00.000Z'); });
t('월요일 새벽(한국 0시 직후)도 그날부터', () => { const s = periodStart('week', kst(2026, 11, 16, 0) + 1000); assert.strictEqual(new Date(s + KST).toISOString(), '2026-11-16T00:00:00.000Z'); });
t('월간 시작은 1일 0시', () => { assert.strictEqual(new Date(periodStart('month', kst(2026, 11, 21)) + KST).toISOString(), '2026-11-01T00:00:00.000Z'); });
t('학생별 합산·승수·정확도 순, 완전 동률만 같은 순위, 최근 캐릭터 표시', () => {
  const r = buildRanking([
    { uid: 'a', score: 50, correct: 10, wrong: 2, noAnswer: 0, won: true, character: '검은이', finishedAt: 1 },
    { uid: 'a', score: 30, correct: 6, wrong: 0, noAnswer: 2, won: false, character: '말티즈', finishedAt: 2 },
    { uid: 'b', score: 80, correct: 8, wrong: 0, noAnswer: 0, won: true, character: '다람쥐', finishedAt: 1 },
    { uid: 'c', score: 80, correct: 8, wrong: 0, noAnswer: 0, won: false, character: '핵잼이', finishedAt: 1 },
    { uid: 'd', score: 80, correct: 8, wrong: 0, noAnswer: 0, won: false, character: '검은이', finishedAt: 1 }]);
  assert.deepStrictEqual(r.map(x => [x.uid, x.rank]), [['b', 1], ['a', 2], ['c', 3], ['d', 3]]);
  const a = r.find(x => x.uid === 'a'); assert.strictEqual(a.total, 80); assert.strictEqual(a.character, '말티즈'); assert.strictEqual(a.plays, 2); assert.strictEqual(a.accuracy, 80);
});
t('기록이 없으면 빈 목록, limit 적용', () => { assert.deepStrictEqual(buildRanking([]), []); assert.strictEqual(buildRanking(Array.from({ length: 80 }, (_, i) => ({ uid: 'u' + i, score: i })), 50).length, 50); });
console.log(`\n통과 ${n}개`);
