'use strict';
/*
  WORD BATTLE 단어 목록 (학년 → 교재 → 과 → 단어 앱)
  - 범위: 영어(B) 폴더의 "CM내신" 중 중등부·고등부의 단어 자료만. (모의고사·CM초등·어휘·구문 등은 뺀다)
  - 단어 자료 찾기: 단어 앱은 대부분 "영상학습훈련" 탭에 올라가 있어 탭으로는 찾을 수 없다.
    파일 이름에 "단어"가 있는 것을 후보로 삼고, 실제로 단어 데이터가 있는지는 서버가 HTML 을 읽어 확인한다.
  - 정렬: 학년 순서(중1~중3, 고1~고3), 이름은 숫자 순(1과 < 2과 < 10과).
  - 읽기만 한다. items·pages 는 고치지 않는다.
*/

const SCOPE = { rootFolder: 'B', rootName: 'CM내신', sections: ['중등부', '고등부'] };
const GRADE_ORDER = ['중1', '중2', '중3', '고1', '고2', '고3'];
const GRADE_RE = /(중|고)\s*([1-3])/;
const PURE_GRADE_RE = /^\s*(중|고)\s*[1-3]\s*(\([^)]*\))?\s*$/;
const gradeKey = name => { const m = GRADE_RE.exec(String(name || '')); return m ? m[1] + m[2] : null; };
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.name, b.name);

/** 단어 자료 후보인가: 이름에 "단어"가 있고, 여러 자료를 묶은 것("+")은 제외 */
const isWordCandidate = name => /단어/.test(name) && !/[+＋]/.test(name);

/** 이 사용자가 볼 수 있는 자료인가 (Firestore 규칙 items 읽기 조건과 같은 기준) */
function canRead(user, it, byId) {
  if (!it || it.deleted) return false;
  if (user.role === 'super') return true;
  if (it.folder === 'E') return it.visible !== false;
  for (let a = it, n = 0; a && n < 20; a = a.parentId ? byId.get(a.parentId) : null, n++) {
    const sh = Array.isArray(a.shared) ? a.shared.filter(x => !(a.pathOnly || []).includes(x)) : [];
    if (sh.includes(user.branchId)) return it.visible !== false;
  }
  if (it.branchId && it.branchId === user.branchId) return user.role === 'sub' || (it.visible === true && it.folder !== 'F');
  return false;
}

/** 폴더 이름 사슬 (바깥 → 안) */
function pathOf(it, byId) {
  const names = [];
  for (let a = it.parentId ? byId.get(it.parentId) : null, n = 0; a && n < 20; a = a.parentId ? byId.get(a.parentId) : null, n++) names.unshift({ id: a.id, name: a.name, folder: a.folder, top: !a.parentId });
  return names;
}

/**
 * @param user  { role: 'super'|'sub'|'student', branchId }
 * @param items items 문서 배열 [{id,name,type,parentId,folder,visible,deleted,branchId,shared,pathOnly}]
 * @param scope 기본 SCOPE
 * @returns { grades:[{ grade:'중1', children:[노드] }], fileCount }
 *   노드 = { name, children:[노드], apps:[{itemId,name}] }  — apps 는 그 폴더(과)에 바로 들어 있는 단어 자료
 */
function buildWordCatalog(user, items, scope) {
  const sc = { ...SCOPE, ...(scope || {}) };
  const byId = new Map(items.map(i => [i.id, i]));
  const roots = new Map();
  let fileCount = 0;

  items.filter(i => i.type !== 'folder' && isWordCandidate(i.name) && canRead(user, i, byId)).forEach(file => {
    const chain = pathOf(file, byId);
    // CM내신 > 중등부|고등부 > … 안에 있는 것만
    if (chain.length < 3 || !chain[0].top || chain[0].folder !== sc.rootFolder || chain[0].name !== sc.rootName || !sc.sections.includes(chain[1].name)) return;
    const rest = chain.slice(2); // 중등부/고등부 아래 단계들 (학년 → 교재 → 과 …)
    const gi = rest.findIndex(p => gradeKey(p.name));
    if (gi < 0) return;
    const grade = gradeKey(rest[gi].name);
    let node = roots.get(grade); if (!node) roots.set(grade, node = { name: grade, children: new Map(), apps: [] });
    // 학년 폴더 이름에 교재 이름이 같이 있으면("중3 천재(소영순)") 그 이름을 교재 단계로 쓴다. ("중1", "중1 (개정)"은 학년만)
    const tail = rest.slice(gi + 1);
    if (!PURE_GRADE_RE.test(rest[gi].name)) tail.unshift({ name: rest[gi].name });
    for (const p of tail) {
      let c = node.children.get(p.name);
      if (!c) node.children.set(p.name, c = { name: p.name, children: new Map(), apps: [] });
      node = c;
    }
    node.apps.push({ itemId: file.id, name: file.name });
    fileCount++;
  });

  const finish = n => ({ name: n.name, children: [...n.children.values()].map(finish).sort(byName), apps: n.apps.slice().sort(byName) });
  return { grades: GRADE_ORDER.filter(g => roots.has(g)).map(g => ({ grade: g, children: finish(roots.get(g)).children, apps: roots.get(g).apps })), fileCount };
}

/** 고른 노드(과 폴더 등) 아래의 단어 자료 id 를 모두 모은다 */
function collectApps(node) { return node.apps.map(a => a.itemId).concat(...node.children.map(collectApps)); }

module.exports = { buildWordCatalog, collectApps, isWordCandidate, gradeKey, canRead, GRADE_ORDER, SCOPE };
