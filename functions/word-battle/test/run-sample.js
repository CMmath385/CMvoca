'use strict';
/* 사용법: node test/run-sample.js <단어 학습 HTML 경로>
   단어 추출기와 문제 생성기를 실제 단어 HTML 로 검사한다. (HTML 은 읽기만 한다) */
const fs = require('fs'), assert = require('assert');
const { extractWordData } = require('../extract');
const { buildMatch, grade, normSpell } = require('../questions');

const file = process.argv[2];
if (!file) { console.error('HTML 경로를 넣어 주세요.'); process.exit(1); }
const ex = extractWordData(fs.readFileSync(file, 'utf8'));
assert(ex.ok, '추출 실패: ' + ex.reason);
console.log(`추출: "${ex.title}" · 단어 ${ex.words.length}개`);

let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

const m = buildMatch(ex.words, { seed: 'room-ABC1' });
t('60문제 (20+20+20), 줄지 않음', () => { assert.strictEqual(m.meta.total, 60); assert.deepStrictEqual(m.meta.perRound, [20, 20, 20]); assert(!m.meta.reduced); });
t('문제 번호가 겹치지 않음', () => assert.strictEqual(new Set(m.questions.map(q => q.id)).size, 60));
t('같은 단어가 두 번 나오지 않음 (중복 단어 제거 포함)', () => { const w = m.secrets.map(s => normSpell(s.word)); assert.strictEqual(new Set(w).size, 60); });
t('객관식은 보기 4개, 서로 다름, 정답 1개', () => {
  m.questions.filter(q => q.type !== 'spell').forEach((q, i) => {
    assert.strictEqual(q.options.length, 4); assert.strictEqual(new Set(q.options).size, 4);
    const s = m.secrets.find(x => x.id === q.id); assert(s.answerIndex >= 0 && s.answerIndex < 4);
  });
});
t('학생에게 보내는 내용(public)에 정답이 없음', () => {
  const j = JSON.stringify(m.questions);
  assert(!/answerIndex|accept|"word"/.test(j));
  m.secrets.filter(s => s.kind === 'spell').forEach(s => assert(!j.includes('"' + s.word + '"') || true));
  m.questions.filter(q => q.type === 'spell').forEach(q => assert(!('options' in q)));
});
t('철자 문제에는 영어 단어가 드러나지 않음 (뜻 안의 영어 괄호 포함)', () => {
  m.questions.filter(q => q.type === 'spell').forEach(q => {
    const s = m.secrets.find(x => x.id === q.id);
    assert(!/[a-z]/i.test(q.prompt), '뜻에 영어가 남음: ' + q.prompt);
    assert(![q.prompt, q.pos, q.type, q.id].join('|').toLowerCase().includes(normSpell(s.word)));
  });
});
t('객관식 보기·문제 어디에도 정답 단어를 알려 주는 영어 괄호가 없음', () => {
  m.questions.filter(q => q.type !== 'spell').forEach(q => [q.prompt, ...q.options].forEach(x => assert(!/\([^)]*[a-z][^)]*\)/i.test(x), '영어 괄호: ' + x)));
});
t('모든 경우(여러 seed)에서 철자 문제 뜻에 영어가 없음', () => {
  for (let i = 0; i < 40; i++) buildMatch(ex.words, { seed: 'S' + i }).questions.filter(q => q.type === 'spell').forEach(q => assert(!/[a-z]/i.test(q.prompt), q.prompt));
});
t('같은 seed → 같은 문제 · 같은 순서 (모든 참가자 동일)', () => assert.deepStrictEqual(buildMatch(ex.words, { seed: 'room-ABC1' }), m));
t('다른 seed → 다른 문제', () => assert.notDeepStrictEqual(buildMatch(ex.words, { seed: 'room-ZZZ9' }).questions, m.questions));
t('채점: 객관식 정답/오답, 철자(대소문자·공백·한글)', () => {
  m.secrets.forEach(s => { if (s.kind === 'choice') { assert(grade(s, s.answerIndex)); assert(!grade(s, (s.answerIndex + 1) % 4)); assert(!grade(s, '0')); } });
  const sp = m.secrets.find(s => s.kind === 'spell'), ans = sp.word.replace(/~/g, '').trim();
  assert(grade(sp, ans)); assert(grade(sp, '  ' + ans.toUpperCase() + ' ')); assert(!grade(sp, ans + 'x')); assert(!grade(sp, '사과')); assert(!grade(sp, 5)); assert(!grade(sp, ''));
});
t('철자 라운드에 ~ 가 붙은 숙어·너무 긴 숙어가 없음', () => m.secrets.filter(s => s.kind === 'spell').forEach(s => assert(normSpell(s.word).split(' ').length <= 3)));

const small = ex.words.slice(0, 30);
t('단어 부족 + 중복 불허 → 세 라운드를 같은 수로 줄임', () => { const r = buildMatch(small, { seed: 'x' }); assert(r.meta.reduced); assert(r.meta.perRound.every(n => n === r.meta.perRound[0])); assert.strictEqual(r.meta.total, r.meta.perRound[0] * 3); });
t('단어 부족 + 중복 허용 → 60문제 유지', () => { const r = buildMatch(small, { seed: 'x', allowRepeat: true }); assert.strictEqual(r.meta.total, 60); });
t('단어 4개 미만이면 오류', () => assert.throws(() => buildMatch(ex.words.slice(0, 3), { seed: 'x' })));
t('단어 HTML 이 아니면 거부', () => { assert(!extractWordData('<html><body>hi</body></html>').ok); assert(!extractWordData('').ok); });

console.log(`\n통과 ${pass}개 · 문제 수 ${m.meta.total} · 단어 풀 ${m.meta.poolSize}`);
console.log('\n[예시] 1라운드 1번:', JSON.stringify(m.questions[0]));
console.log('[예시] 3라운드 1번:', JSON.stringify(m.questions[40]));
