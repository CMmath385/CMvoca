'use strict';
/*
  WORD BATTLE 문제 만들기 (서버 전용 로직)
  - 같은 경기(seed)에서는 모든 참가자가 같은 문제를 같은 순서로 받는다.
  - 정답은 secret 으로만 돌려준다. public 은 학생 화면으로 보내도 되는 내용만 담는다.
  ROUND 1: 영어 → 한글 뜻 (4지선다)
  ROUND 2: 한글 뜻 → 영어 (4지선다)
  ROUND 3: 한글 뜻 → 영어 철자 직접 입력
*/

/* ---------- 같은 seed → 같은 결과 ---------- */
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
}
function makeRng(seed) {
  let a = hashSeed(String(seed));
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------- 글자 다루기 ---------- */
/** 철자 비교용: ~ 제거, 따옴표 통일, 소문자, 공백 정리 */
function normSpell(s) {
  return String(s).replace(/~/g, ' ').replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
}
/** 마침표까지 뺀 느슨한 비교 (p.m. = pm) */
const looseSpell = s => normSpell(s).replace(/\./g, '');
const wordKey = en => normSpell(en);

function isSpellable(w, maxSpellWords) {
  if (w.nospell) return false;
  const t = normSpell(w.en);
  if (!/^[a-z][a-z' .-]*$/.test(t)) return false;
  return t.split(' ').length <= maxSpellWords;
}

/** 뜻 안의 영어 괄호는 정답을 알려 주므로 문제에 쓰지 않는다. 예: "의미하다 (mean-meant-meant)" → "의미하다" */
function cleanKo(ko) {
  const c = ko.replace(/\s*\([^)]*[A-Za-z][^)]*\)/g, '').replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
  return c || ko;
}

/** 같은 영어 단어(대소문자·~ 무시)는 한 번만 남긴다. 먼저 나온 것을 사용. */
function dedupe(words) {
  const seen = new Set(), out = [];
  for (const w of words) {
    const key = wordKey(w.en);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push({ ...w, ko: cleanKo(w.ko), key });
  }
  return out;
}

/** 후보에서 n 개 뽑는다. 안 쓴 단어 먼저, 부족하면 allowRepeat 일 때만 다시 쓴다. */
function take(n, cands, used, allowRepeat, rand) {
  const out = cands.filter(w => !used.has(w.key)).slice(0, n);
  if (out.length < n && allowRepeat && cands.length) {
    const again = shuffle(cands, rand);
    for (let i = 0; out.length < n && i < again.length; i++) if (!out.includes(again[i])) out.push(again[i]);
  }
  out.forEach(w => used.add(w.key));
  return out;
}

/* ---------- 보기 만들기 ---------- */
function pickDistractors(w, pool, field, n, rand) {
  const ok = pool.filter(x => x.key !== w.key && x.ko !== w.ko && x[field] !== w[field]);
  const seen = new Set([w[field]]), res = [];
  const ordered = shuffle(ok.filter(x => x.pos === w.pos), rand).concat(shuffle(ok.filter(x => x.pos !== w.pos), rand));
  for (const x of ordered) { if (res.length >= n) break; if (!seen.has(x[field])) { seen.add(x[field]); res.push(x[field]); } }
  return res;
}
function choiceQuestion(round, no, w, pool, rand) {
  const toKo = round === 1;
  const field = toKo ? 'ko' : 'en';
  const opts = shuffle([w[field], ...pickDistractors(w, pool, field, 3, rand)], rand);
  return {
    pub: { id: `r${round}-${no}`, round, no, type: toKo ? 'en2ko' : 'ko2en', prompt: toKo ? w.en : w.ko, pos: w.pos, options: opts },
    secret: { id: `r${round}-${no}`, kind: 'choice', answerIndex: opts.indexOf(w[field]), word: w.en }
  };
}
function spellQuestion(no, w, pool, rand) {
  // 뜻이 같은 다른 영어 단어도 정답으로 인정 (헷갈리는 문제 방지)
  const accept = [...new Set(pool.filter(x => x.ko === w.ko).map(x => normSpell(x.en)))];
  return {
    pub: { id: `r3-${no}`, round: 3, no, type: 'spell', prompt: w.ko, pos: w.pos, letters: normSpell(w.en).split(' ').map(t => t.replace(/[^a-z]/g, '').length) },
    secret: { id: `r3-${no}`, kind: 'spell', accept, word: w.en }
  };
}

/**
 * 경기 한 판의 문제를 만든다.
 * @param rawWords extractWordData().words
 * @param opts { seed, perRound=20, allowRepeat=false, maxSpellWords=3 }
 * @returns { questions:[pub...], secrets:[secret...], meta:{ total, perRound:[], reduced, poolSize } }
 */
function buildMatch(rawWords, opts) {
  const o = { perRound: 20, allowRepeat: false, maxSpellWords: 3, ...opts };
  if (o.seed === undefined) throw new Error('seed 가 필요합니다.');
  const rand = makeRng(o.seed);
  const pool = dedupe(rawWords);
  if (pool.length < 4) throw new Error('보기를 만들려면 서로 다른 단어가 4개 이상 필요합니다.');

  const used = new Set();
  const shuffled = shuffle(pool, rand);
  // 철자 라운드(3)에 쓸 수 있는 단어를 먼저 정한다.
  const spellable = shuffled.filter(w => isSpellable(w, o.maxSpellWords));
  // 중복 출제를 허용하지 않아 단어가 모자라면, 세 라운드 문제 수를 같게 줄인다.
  let n = o.perRound, reduced = false;
  if (!o.allowRepeat && pool.length < n * 3) {
    n = Math.min(Math.floor(pool.length / 3), spellable.length);
    reduced = true;
  }
  if (n < 1) throw new Error('이 단어장으로는 3라운드 문제를 만들 수 없습니다. (철자 입력에 쓸 단어가 없거나 단어 수 부족)');
  const r3 = take(n, spellable, used, o.allowRepeat, rand);
  const r1 = take(n, shuffled, used, o.allowRepeat, rand);
  const r2 = take(n, shuffled, used, o.allowRepeat, rand);
  if (!r3.length) throw new Error('철자 입력(3라운드)에 쓸 수 있는 단어가 없습니다.');

  const built = [];
  r1.forEach((w, i) => built.push(choiceQuestion(1, i + 1, w, pool, rand)));
  r2.forEach((w, i) => built.push(choiceQuestion(2, i + 1, w, pool, rand)));
  r3.forEach((w, i) => built.push(spellQuestion(i + 1, w, pool, rand)));
  return {
    questions: built.map(b => b.pub),
    secrets: built.map(b => b.secret),
    meta: { total: built.length, perRound: [r1.length, r2.length, r3.length], reduced, poolSize: pool.length }
  };
}

/** 학생 답안 채점 (서버에서만 호출). answer: 보기 번호(0~3) 또는 입력한 철자 */
function grade(secret, answer) {
  if (!secret) return false;
  if (secret.kind === 'choice') return Number.isInteger(answer) && answer === secret.answerIndex;
  if (secret.kind === 'spell') {
    if (typeof answer !== 'string') return false;
    if (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(answer)) return false; // 한글 입력은 오답 처리 (화면에서 안내)
    const a = normSpell(answer), l = looseSpell(answer);
    return a.length > 0 && secret.accept.some(x => x === a || looseSpell(x) === l);
  }
  return false;
}

module.exports = { buildMatch, grade, normSpell, dedupe, makeRng };
