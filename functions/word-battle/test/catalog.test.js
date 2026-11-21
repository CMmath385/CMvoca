'use strict';
/* 사용법: node test/catalog.test.js [백업 JSON 경로]
   - 가짜 데이터로 학년·과 목록 만들기를 검사한다 (Firebase 필요 없음)
   - 백업 JSON 경로를 주면, 실제 폴더 구조로 학년별 개수만 요약해 보여 준다 (학생·학부모 정보는 읽지 않음) */
const assert = require('assert'), fs = require('fs');
const { buildWordCatalog, collectApps, isWordCandidate, gradeKey } = require('../catalog');

let pass = 0; const t = (n, f) => { f(); pass++; console.log('  ✓', n); };
let seq = 0;
const F = (name, parentId, extra) => ({ id: 'f' + (++seq), type: 'folder', name, parentId: parentId || null, folder: 'B', visible: true, ...extra });
const W = (name, parentId, extra) => ({ id: 'w' + (++seq), type: 'file', name, parentId, folder: 'B', visible: true, tabId: 'video', ...extra });

const cm = F('CM내신'), mid = F('중등부', cm.id), hi = F('고등부', cm.id), mock = F('모의고사', cm.id);
const m1 = F('중1', mid.id), book = F('중1 천재 이상기', m1.id);
const l10 = F('10과', book.id), l2 = F('02과', book.id), l1 = F('01과', book.id);
const m2 = F('중2', mid.id), book2 = F('중2 천재 소영순', m2.id), b2l1 = F('01과', book2.id);
const h1 = F('고1', hi.id), sub = F('공통영어1', h1.id), sub2 = F('공통영어1', sub.id), pub = F('능률민', sub2.id), h1l1 = F('1과', pub.id);
const m10 = F('26년 10모 고1', mock.id);
const el = F('CM초등'), elL = F('Unit 1', el.id);
const items = [cm, mid, hi, mock, m1, book, l10, l2, l1, m2, book2, b2l1, h1, sub, sub2, pub, h1l1, m10, el, elL,
  W('단어', l10.id), W('01 단어', l2.id), W('단어', l1.id), W('본문 분석', l1.id), W('문법 6단계', l1.id),
  W('단어', b2l1.id), W('단어', h1l1.id), W('단어', m10.id), W('단어', elL.id),
  W('단어', l1.id, { deleted: true }), W('단어 한글/영어', l1.id), W('지문분석 + 단어 + 문법 워크북', l1.id)];
const sup = { role: 'super' }, stu = { role: 'student', branchId: 'B1' };

t('학년 이름·단어 후보 이름 판별', () => {
  assert.strictEqual(gradeKey('중1 천재 이상기'), '중1'); assert.strictEqual(gradeKey('CM초등'), null);
  assert(isWordCandidate('단어') && isWordCandidate('01 단어') && isWordCandidate('3,4과 10모단어') && isWordCandidate('단어 한글/영어'));
  assert(!isWordCandidate('본문 분석') && !isWordCandidate('지문분석 + 단어 + 문법 워크북'));
});
t('탭이 영상학습훈련이어도 이름으로 단어를 찾음 / 본문·문법은 제외', () => {
  const c = buildWordCatalog(sup, items), s = JSON.stringify(c);
  assert(!s.includes('본문 분석') && !s.includes('문법 6단계') && !s.includes('+'));
});
t('범위: CM내신 중등부·고등부만 (모의고사·CM초등·삭제된 자료 제외)', () => {
  const c = buildWordCatalog(sup, items); assert.deepStrictEqual(c.grades.map(g => g.grade), ['중1', '중2', '고1']);
  const ids = c.grades.flatMap(g => g.children.flatMap(collectApps)); assert.strictEqual(new Set(ids).size, ids.length);
  assert(!ids.includes(items.find(i => i.parentId === m10.id).id) && !ids.includes(items.find(i => i.parentId === elL.id).id));
});
t('과 이름이 숫자 순서: 01과 < 02과 < 10과', () => {
  const g = buildWordCatalog(sup, items).grades[0]; assert.deepStrictEqual(g.children[0].children.map(x => x.name), ['01과', '02과', '10과']);
});
t('학년 > 교재 > 과 > 단어 앱 (apps 는 과 폴더에 달림)', () => {
  const g = buildWordCatalog(sup, items).grades[0]; assert.strictEqual(g.children[0].name, '중1 천재 이상기');
  const l = g.children[0].children[0]; assert.strictEqual(l.name, '01과'); assert(l.apps.length >= 1 && l.apps[0].itemId);
});
t('고등부처럼 폴더 단계가 달라도 폴더 이름 그대로', () => {
  const h = buildWordCatalog(sup, items).grades.find(g => g.grade === '고1'); assert.strictEqual(h.children[0].name, '공통영어1'); assert.strictEqual(h.children[0].children[0].name, '공통영어1');
});
t('고른 과 아래의 단어 앱을 모두 모음', () => {
  const g = buildWordCatalog(sup, items).grades[0]; assert.strictEqual(collectApps(g.children[0]).length, 4 /* 01과 2개(단어, 단어 한글/영어) + 02과 + 10과 */);
});
t('학생: 자기 지점에 공유되지 않았으면 안 보임, 공유되면 보임(pathOnly 제외)', () => {
  assert.strictEqual(buildWordCatalog(stu, items).fileCount, 0);
  const shared = items.map(i => i.id === cm.id ? { ...i, shared: ['B1'] } : i);
  assert(buildWordCatalog(stu, shared).fileCount > 0);
  assert.strictEqual(buildWordCatalog(stu, items.map(i => i.id === cm.id ? { ...i, shared: ['B1'], pathOnly: ['B1'] } : i)).fileCount, 0);
  assert.strictEqual(buildWordCatalog(stu, items.map(i => ({ ...i, shared: ['B1'], visible: false }))).fileCount, 0);
});

t('학년 폴더가 교재 이름을 겸하면(중3 천재(소영순)) 교재 단계로 보여 줌', () => {
  const m3 = F('중3 천재(소영순)', mid.id), l = F('01과', m3.id), plain = F('중1 (개정)', mid.id), pl = F('01과', plain.id);
  const c = buildWordCatalog(sup, [...items, m3, l, W('단어', l.id), plain, pl, W('단어', pl.id)]);
  const g3 = c.grades.find(g => g.grade === '중3'); assert.strictEqual(g3.children[0].name, '중3 천재(소영순)'); assert.strictEqual(g3.children[0].children[0].name, '01과');
  const g1 = c.grades.find(g => g.grade === '중1'); assert(g1.children.some(x => x.name === '01과'), '"중1 (개정)"은 학년으로만 취급');
});

/* 실제 백업이 있으면 요약만 보여 준다 */
const bk = process.argv[2];
if (bk) {
  const d = JSON.parse(fs.readFileSync(bk, 'utf8'));
  const c = buildWordCatalog(sup, d.items);
  console.log(`\n[실제 구조] 단어 자료 ${c.fileCount}개`);
  c.grades.forEach(g => console.log(`  ${g.grade}: 교재 ${g.children.map(b => `${b.name}(${b.children.length}과/${collectApps(b).length}개)`).join(', ')}`));
  const stuView = buildWordCatalog({ role: 'student', branchId: d.branches[0].id }, d.items);
  console.log(`  → 지점 "${(d.branches[0].academyName || '').slice(0, 14)}" 학생이 볼 수 있는 단어 자료: ${stuView.fileCount}개`);
}
console.log(`\n통과 ${pass}개`);
