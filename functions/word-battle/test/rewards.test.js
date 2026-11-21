'use strict';
const assert = require('assert'); const R = require('../rewards'); let n = 0; const t = (m, f) => { f(); n++; console.log('  ✓', m); };
t('교환: 포인트 부족·꺼진 상품·잘못된 설정 거부', () => {
  assert(R.canRequest({ points: 100 }, 100).ok); assert(!R.canRequest({ points: 100 }, 99).ok); assert(!R.canRequest({ points: 100, active: false }, 999).ok);
  assert(!R.canRequest({ points: 0 }, 5).ok); assert(!R.canRequest(null, 5).ok);
});
t('예산: 한도 안이면 승인, 넘으면 거부, 한도 없으면 제한 없음', () => {
  assert(R.canApprove({ limit: 10000, used: 8000 }, 2000).ok); assert(!R.canApprove({ limit: 10000, used: 8000 }, 2001).ok); assert(R.canApprove(null, 5e6).ok); assert(R.canApprove({ limit: null, used: 9 }, 5e6).ok);
});
t('미션: 지난번과 같은 미션은 연속 금지 (1000번)', () => { for (let i = 0; i < 1000; i++) assert.notStrictEqual(R.pickMission(['a', 'b', 'c'], 'b', Math.random), 'b'); });
t('미션 목록이 1개뿐이면 어쩔 수 없이 같은 것 허용, 비면 기본 목록', () => { assert.strictEqual(R.pickMission(['a'], 'a', Math.random), 'a'); assert(R.DEFAULT_MISSIONS.includes(R.pickMission([], null, Math.random))); });
t('꼴찌: 단독 꼴찌만 대상, 동률 꼴찌·전원 동률·1명은 없음', () => {
  assert.strictEqual(R.lastPlace([{ uid: 'a', rank: 1 }, { uid: 'b', rank: 2 }, { uid: 'c', rank: 3 }]), 'c');
  assert.strictEqual(R.lastPlace([{ uid: 'a', rank: 1 }, { uid: 'b', rank: 2 }, { uid: 'c', rank: 2 }]), null);
  assert.strictEqual(R.lastPlace([{ uid: 'a', rank: 1 }, { uid: 'b', rank: 1 }]), null); assert.strictEqual(R.lastPlace([{ uid: 'a', rank: 1 }]), null);
});
t('월 키는 한국시간 기준', () => { assert.strictEqual(R.monthKey(Date.UTC(2026, 10, 30, 16)), '2026-12'); assert.strictEqual(R.monthKey(Date.UTC(2026, 10, 30, 14)), '2026-11'); });
console.log(`\n통과 ${n}개`);
