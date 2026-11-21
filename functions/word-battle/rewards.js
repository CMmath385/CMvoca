'use strict';
/* WORD BATTLE 보상·미션 규칙 (순수 함수) */
const KST = 9 * 3600 * 1000;
const monthKey = now => { const k = new Date(now + KST); return k.getUTCFullYear() + '-' + String(k.getUTCMonth() + 1).padStart(2, '0'); };

/** 교환 신청 가능 여부: 상품이 켜져 있고 포인트가 충분해야 한다 */
function canRequest(product, balance) {
  if (!product || product.active === false) return { ok: false, reason: '지금은 교환할 수 없는 상품이에요' };
  const cost = Number(product.points);
  if (!Number.isFinite(cost) || cost <= 0) return { ok: false, reason: '상품 설정이 올바르지 않아요' };
  if ((balance || 0) < cost) return { ok: false, reason: '포인트가 부족해요' };
  return { ok: true, cost };
}
/** 지점 월 예산 안에서 승인 가능한가. limit 이 없으면(null) 제한 없음 */
function canApprove(budget, won) {
  if (!budget || budget.limit == null) return { ok: true };
  if ((budget.used || 0) + won > budget.limit) return { ok: false, reason: '이번 달 지급 예산을 넘어요' };
  return { ok: true };
}
const DEFAULT_MISSIONS = ['선생님께 오늘 배운 단어 5개 소리 내어 말하기', '틀린 단어 3개를 노트에 3번씩 쓰기', '친구에게 단어 퀴즈 3문제 내기', '교실 책상 정리 도와주기', '오늘 단어 암기 10개 더 하기'];
/** 꼴찌 미션 고르기: 지난번과 같은 미션은 연속으로 주지 않는다 */
function pickMission(list, lastText, rand) {
  const pool = (list && list.length ? list : DEFAULT_MISSIONS).filter(m => m !== lastText);
  const use = pool.length ? pool : (list && list.length ? list : DEFAULT_MISSIONS);
  return use[Math.floor(rand() * use.length)];
}
/** 경기 결과에서 미션 대상(단독 꼴찌, 3명 이상은 아니어도 2명이면 2등)을 찾는다. 동률 꼴찌는 없음 */
function lastPlace(result) {
  if (!result || result.length < 2) return null;
  const max = Math.max(...result.map(x => x.rank)), last = result.filter(x => x.rank === max);
  return max > 1 && last.length === 1 ? last[0].uid : null;
}
module.exports = { monthKey, canRequest, canApprove, pickMission, lastPlace, DEFAULT_MISSIONS };
