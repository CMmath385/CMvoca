'use strict';
/* WORD BATTLE 주간·월간 랭킹 (순수 함수) — 경기 기록(wb_stats)을 학생별로 모아 순위를 만든다. 실명은 다루지 않는다. */
const KST = 9 * 3600 * 1000;

/** 기간 시작 시각(ms, 한국시간 기준). week=월요일 0시, month=1일 0시 */
function periodStart(period, now) {
  const k = new Date(now + KST);
  if (period === 'month') return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KST;
  const dow = (k.getUTCDay() + 6) % 7; // 월=0
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - dow) - KST;
}

/** stats: [{uid, score, correct, wrong, noAnswer, won, character, finishedAt}] → 순위 목록 */
function buildRanking(stats, limit = 50) {
  const m = new Map();
  for (const s of stats) {
    let a = m.get(s.uid);
    if (!a) m.set(s.uid, a = { uid: s.uid, total: 0, plays: 0, wins: 0, correct: 0, answered: 0, character: s.character, lastAt: -1 });
    a.total += s.score || 0; a.plays++; if (s.won) a.wins++;
    a.correct += s.correct || 0; a.answered += (s.correct || 0) + (s.wrong || 0) + (s.noAnswer || 0);
    if ((s.finishedAt || 0) >= a.lastAt) { a.lastAt = s.finishedAt || 0; a.character = s.character; }
  }
  const list = [...m.values()].map(a => ({ ...a, accuracy: a.answered ? Math.round(a.correct / a.answered * 100) : 0 }));
  list.sort((x, y) => y.total - x.total || y.wins - x.wins || y.accuracy - x.accuracy || x.uid.localeCompare(y.uid));
  let rank = 0;
  list.forEach((x, i) => { const p = list[i - 1]; if (i === 0 || x.total !== p.total || x.wins !== p.wins || x.accuracy !== p.accuracy) rank = i + 1; x.rank = rank; });
  return list.slice(0, limit);
}
module.exports = { periodStart, buildRanking, KST };
