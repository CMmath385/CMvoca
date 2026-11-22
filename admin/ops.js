/* CM 학원관리 — 운영 화면 (예전 CMVOCA F 학원관리 화면을 옮겨 온 것. 데이터·기능은 그대로) */
(function () {
'use strict';
const $ = id => document.getElementById(id);
function h(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function btn(txt, cls, fn) { const b = h('button', cls, txt); b.type = 'button'; b.onclick = () => safe(fn); return b; }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = m => window.AM.toast(m);
const safe = async f => { try { await f(); } catch (e) { console.error(e); toast(''); alert('오류: ' + (e && e.code === 'permission-denied' ? '권한이 없습니다.' : (e.message || e))); } };
const B1 = 'bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2 rounded-xl font-bold shadow-sm transition';
const B2 = 'bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs px-2.5 py-2 rounded-xl font-bold transition';
const SKY = '#87ceeb';
const KEEP = 30 * 24 * 3600 * 1000;
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true });
const dayOf = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtD = s => Math.floor(s / 60) + '분 ' + (s % 60) + '초';
const db = firebase.firestore();
// CMVOCA 앱의 상태(S) 대신 학원관리 화면의 상태를 씀
const S = { get me() { return window.AM.me(); }, get branches() { return window.AM.branches(); }, get viewBranch() { return window.AM.bid(); }, set viewBranch(v) {}, hqLogo: '', hqName: '', fFiles: false, folderId: null };
const curBranch = () => window.AM.bid();
const branchName = id => id === 'main' ? '본원' : ((S.branches.find(b => b.id === id) || {}).academyName || id);
const nameBlank = () => false, meLogo = () => (S.me && S.me.logoUrl) || '', blankLogo = () => false, applyBrand = () => {};
const setLogo = async () => { throw new Error('학원 로고는 CMVOCA 앱의 학원 설정에서 바꿔 주세요.'); };
const setView = () => window.open('/', '_blank');
// 출퇴근 화면: 예전 강사 명단 + 학원관리 계정 강사(같은 이름이 없을 때). 계정 강사는 수업 보고서로 출퇴근이 기록됨
async function mgTeachersPlus() {
  const list = await mgGet('teacher');
  try {
    const u = await db.collection('users').where('branchId', '==', curBranch()).where('role', '==', 'teacher').get();
    u.docs.forEach(d => { const x = d.data(); if (!list.some(t => t.name === x.name)) list.push({ id: d.id, name: x.name || x.loginId, acct: true }); });
  } catch (_) {}
  return list;
}
/* MG-START */
const GROUPS = [
  ['dash', '📊 대시보드', [['dash', '대시보드']]],
  ['student', '🎓 학생 통합 관리', [['stu', '학생 목록 & 정보'], ['grade', '성적 관리'], ['counsel', '상담 관리'], ['progress', '진도 관리']]],
  ['teacher', '👔 강사 통합 관리', [['teacher', '강사 명단 & 정보'], ['tclk', '출퇴근 관리'], ['pay', '급여 관리']]],
  ['klass', '📖 수업/시간표 등록', [['klass', '수업 / 시간표']]],
  ['money', '💳 수입·지출 관리', [['sum', '종합 수입·지출 현황'], ['fee', '회비 관리 (수입)'], ['pay', '강사 급여 관리 (지출)']]],
  ['plan', '📅 학원 일정', [['plan', '학원 연간일정'], ['school', '학교별 일정']]],
  ['att', '👆 학생 출결 관리', [['att', '출결 & 터치']]],
  ['etc', '➕ 지점 추가 항목', [['etc', '자유 기록']]]
];
const DEF_GRADES = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
const MG = { group: 'dash', tab: 'dash', date: null, month: null, year: new Date().getFullYear(), pid: null, school: '', cfg: null, kGrade: null, attGrade: '' };
const won = n => (Number(n) || 0).toLocaleString('ko-KR') + '원';
const today = () => dayOf(Date.now());
const hm = ts => ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
const dur = (a, b) => { if (!a || !b) return '-'; let m = Math.floor((b - a) / 60000); const hh = Math.floor(m / 60); m %= 60; return hh ? hh + '시간 ' + m + '분' : m + '분'; };
const tsOf = (date, t) => /^\d{1,2}:\d{2}$/.test(t) ? new Date(date + 'T' + t.padStart(5, '0') + ':00').getTime() : null;
const mgRef = id => db.collection('mg').doc(id);
const newId = k => k + '_' + Date.now() + Math.random().toString(36).slice(2, 6);
const prevMonth = m => { const [y, mo] = m.split('-').map(Number), d = new Date(y, mo - 2, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const acadName = () => S.me.role === 'super' ? (curBranch() === 'main' ? (S.hqName || '최강수학메이드영어학원 본원') : branchName(curBranch())) : (nameBlank() ? '' : S.me.academyName);
function estPay(t, hrs, month) {
  const pay = Number(t.pay) || 0, [y, m] = month.split('-').map(Number);
  return t.payType === '시급' ? Math.round(pay * hrs) : t.payType === '주급' ? Math.round(pay * new Date(y, m, 0).getDate() / 7) : pay;
}
async function mgGet(kind, extra) {
  let q = db.collection('mg').where('branchId', '==', curBranch()).where('kind', '==', kind);
  if (extra) q = q.where(extra[0], '==', extra[1]);
  return (await q.get()).docs.map(d => ({ id: d.id, ...d.data() }));
}
const mgSave = (id, data) => mgRef(id).set({ branchId: curBranch(), ...data }, { merge: true });
async function loadRoster() {
  const u = await db.collection('users').where('branchId', '==', curBranch()).where('role', '==', 'student').get();
  return u.docs.map(d => ({ id: d.id, name: d.data().name, grade: d.data().grade || '', acct: true }))
    .concat((await mgGet('stu')).map(r => ({ ...r, acct: false }))).sort(byName);
}
async function loadCfg() {
  const bid = curBranch(); if (MG.cfg && MG.cfg.bid === bid) return MG.cfg;
  const r = (await mgGet('cfg'))[0];
  return (MG.cfg = { bid, grades: r && r.grades ? r.grades : DEF_GRADES.slice(), pin: r ? r.pin || '' : '', banner: r ? r.banner || '' : '' });
}
const saveCfg = () => mgSave('cfg_' + MG.cfg.bid, { kind: 'cfg', grades: MG.cfg.grades, pin: MG.cfg.pin, banner: MG.cfg.banner });
const inp = (type, cls) => { const e = h('input', 'p-2 border border-slate-300 rounded-xl text-sm font-bold ' + (cls || '')); e.type = type; return e; };

/* 인쇄 · CSV 저장 (모든 화면 공용) */
function printTable(title, headers, rows, sub) {
  const w = window.open('', '_blank'); if (!w) return alert('팝업 차단을 해제해 주세요.');
  w.document.write('<html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>body{font-family:sans-serif;padding:28px;color:#1e293b}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 10px;color:#64748b;font-size:12px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left}th{background:#f1f5f9}</style></head><body><h1>' + esc(acadName()) + ' · ' + esc(title) + '</h1><p>' + esc(sub || '') + ' (출력일 ' + today() + ')</p><table><tr>' + headers.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table></body></html>');
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
function csvSave(name, headers, rows) {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const txt = '\ufeff' + [headers].concat(rows).map(r => r.map(q).join(',')).join('\r\n');
  const a = h('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = name + '_' + today() + '.csv'; document.body.append(a); a.click(); a.remove();
}
function exportBar(title, headers, rows, sub, pre) {
  const d = h('div', 'flex gap-2');
  d.append(btn('🖨 ' + (pre || '') + '인쇄', B2, async () => printTable(title, headers, rows, sub)), btn('💾 ' + (pre || '') + 'CSV 저장', B2, async () => csvSave(title, headers, rows)));
  return d;
}

/* 입력 창 (모든 관리 화면 공용) */
function openForm(title, fields, vals, roster) {
  return new Promise(res => {
    const ov = h('div', 'fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-4 overflow-y-auto');
    const card = h('div', 'bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-2 max-h-full overflow-y-auto');
    card.append(h('h3', 'text-lg font-bold text-slate-800 mb-2', title));
    const ctl = {};
    fields.forEach(([k, label, type, opts0]) => {
      const opts = typeof opts0 === 'function' ? opts0() : opts0; let el;
      if (type === 'area') { el = h('textarea'); el.rows = 3; }
      else if (type === 'select' || type === 'stu') {
        el = h('select');
        (type === 'stu' ? [['', '(원생 선택)']].concat(roster.map(r => [r.id, r.name + (r.grade ? ' (' + r.grade + ')' : '')])) : opts.map(o => [o, o])).forEach(([v, t]) => { const o = h('option', '', t); o.value = v; el.append(o); });
      } else { el = h('input'); el.type = type; }
      el.className = 'w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800';
      const cur = vals ? vals[k] : null;
      el.value = cur != null ? cur : (type === 'date' && k === 'date') ? today() : type === 'select' ? opts[0] : '';
      ctl[k] = el; card.append(h('label', 'block text-xs font-bold text-slate-600 mt-2', label), el);
    });
    const done = v => { ov.remove(); res(v); };
    const row = h('div', 'flex gap-2 pt-3');
    row.append(btn('저장', 'flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl', async () => {
      const out = {}; fields.forEach(([k, , type]) => { const v = ctl[k].value.trim(); out[k] = type === 'number' ? Number(v) || 0 : v; });
      if (!out[fields[0][0]]) return alert('첫 번째 항목은 꼭 입력해 주세요.');
      if (fields.some(f => f[0] === 'date') && !out.date) return alert('날짜를 입력해 주세요.');
      done(out);
    }), btn('취소', 'flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl', async () => done(null)));
    card.append(row); ov.append(card); document.body.append(ov);
  });
}

/* 목록형 화면: 강사 · 원생 명단 · 상담 · 진도 · 수입지출 · 연간일정 · 학교별 일정 */
const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
const byDateAsc = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.school || '').localeCompare(b.school || '', 'ko');
const range2 = r => (r.date || '') + (r.end ? ' ~ ' + r.end : '');
const MG_CRUD = {
  teacher: { name: '강사목록', add: '+ 강사 등록', empty: '등록된 강사가 없습니다.', sort: byName,
    f: [['name', '강사 이름', 'text'], ['phone', '연락처', 'text'], ['subject', '담당 과목', 'text'], ['status', '재직 상태', 'select', ['재직 중', '휴직 중', '퇴사']], ['hire', '입사일', 'date'], ['end', '퇴사일 (재직 중이면 비워 두세요)', 'date'], ['payType', '급여 방식', 'select', ['시급', '주급', '월급']], ['pay', '금액(원) — 선택한 급여 방식의 금액', 'number'], ['payDay', '급여일 (매월 며칠)', 'number'], ['memo', '주요 경력 및 메모', 'text']],
    search: true, tcols: [['강사명 / 연락처', r => [r.name, r.phone]], ['담당 과목 / 상태', r => [r.subject, r.status || '재직 중']], ['급여 유형 / 금액', r => [won(r.pay), r.payType + (r.payDay ? ' · 매월 ' + r.payDay + '일' : '')]], ['입사일 / 퇴사일', r => [r.hire, r.end ? '퇴사 ' + r.end : '']], ['주요 경력 및 메모', r => r.memo]],
    title: r => r.name + (r.subject ? ' · ' + r.subject : '') + (r.status && r.status !== '재직 중' ? ' [' + r.status + ']' : ''), sub: r => [r.payType + ' ' + won(r.pay) + (r.payDay ? ' · 급여일 매월 ' + r.payDay + '일' : ''), r.phone, (r.hire ? '입사 ' + r.hire : ''), r.memo],
    cols: [['이름', r => r.name], ['담당 과목', r => r.subject], ['상태', r => r.status || '재직 중'], ['입사일', r => r.hire], ['연락처', r => r.phone], ['급여 방식', r => r.payType], ['금액', r => won(r.pay)], ['급여일', r => r.payDay ? '매월 ' + r.payDay + '일' : ''], ['메모', r => r.memo]] },
  klass: { cards: true, name: '수업시간표', add: '+ 수업 등록', empty: '등록된 수업이 없습니다.', sort: (a, b) => (a.name || '').localeCompare(b.name || '', 'ko'),
    f: [['name', '수업명 / 클래스명', 'text'], ['teacher', '담당 강사', 'text'], ['subject', '수업 과목', 'text'], ['days', '수업 요일 (예: 월·수·금)', 'text'], ['time', '시작 시간 (예: 14:30)', 'text'], ['minutes', '수업 시간(분)', 'number'], ['memo', '메모', 'text']],
    title: r => r.name + (r.subject ? ' · ' + r.subject : ''), sub: r => [[r.days, r.time ? r.time + ' 시작' : '', r.minutes ? r.minutes + '분' : ''].filter(Boolean).join(' · '), r.teacher ? '담당 ' + r.teacher : '', r.memo],
    cols: [['수업명', r => r.name], ['과목', r => r.subject], ['담당 강사', r => r.teacher], ['요일', r => r.days], ['시작', r => r.time], ['시간(분)', r => r.minutes], ['메모', r => r.memo]] },
  etc: { name: '지점추가항목', add: '+ 기록 추가', empty: '기록이 없습니다. 지점에서 필요한 내용을 자유롭게 적어 두세요.', sort: byDateDesc, note: '분류 칸에 "차량운행", "비품" 등 원하는 이름을 적어 자유롭게 사용하세요.',
    f: [['title', '제목', 'text'], ['date', '날짜', 'date'], ['category', '분류 (예: 차량운행, 비품, 행사)', 'text'], ['content', '내용', 'area']],
    title: r => r.date + ' · ' + (r.category ? '[' + r.category + '] ' : '') + r.title, sub: r => [r.content],
    cols: [['날짜', r => r.date], ['분류', r => r.category], ['제목', r => r.title], ['내용', r => r.content]] },
  stu: { name: '학생목록', add: '+ 신규 학생 등록', empty: '등록된 학생이 없습니다.', sort: byName, search: true, note: '학습 계정이 있는 학생은 자동으로 포함됩니다. 계정 없는 학생만 여기에 등록하세요.',
    f: [['name', '학생 이름', 'text'], ['grade', '학년 (학년 목록은 "학생 출결 관리"에서 설정)', 'select', () => MG.cfg.grades], ['className', '클래스 (예: 중2 A반)', 'text'], ['subject', '수업 과목 (예: 수학, 영어)', 'text'], ['days', '수업 요일 (예: 월·수·금)', 'text'], ['phone', '학부모 연락처', 'text'], ['reg', '등록일', 'date'], ['memo', '특이사항', 'text']],
    title: r => r.name, sub: r => [r.phone, r.memo],
    tcols: [['학생명', r => [r.name, acadName()]], ['학년', r => r.grade], ['클래스 / 수업과목', r => [r.className, r.subject ? '수업과목: ' + r.subject : '']], ['수업 요일', r => r.days], ['연락처 / 등록일', r => [r.phone, r.reg ? '등록: ' + r.reg : '']], ['특이사항', r => r.memo]],
    cols: [['이름', r => r.name], ['학년', r => r.grade], ['클래스', r => r.className], ['수업과목', r => r.subject], ['수업 요일', r => r.days], ['학부모 연락처', r => r.phone], ['등록일', r => r.reg], ['특이사항', r => r.memo]] },
  counsel: { name: '상담관리', add: '+ 상담 기록', empty: '상담 기록이 없습니다.', sort: byDateDesc,
    f: [['date', '상담일', 'date'], ['pid', '원생', 'stu'], ['who', '상담 대상', 'select', ['학부모', '학생']], ['content', '상담 내용', 'area'], ['follow', '후속 조치', 'area']],
    title: r => r.date + ' · ' + r.name + ' (' + r.who + ')', sub: r => [r.content, r.follow ? '후속 조치: ' + r.follow : ''],
    cols: [['상담일', r => r.date], ['원생', r => r.name], ['대상', r => r.who], ['상담 내용', r => r.content], ['후속 조치', r => r.follow]] },
  progress: { name: '진도관리', add: '+ 진도 기록', empty: '진도 기록이 없습니다.', sort: byDateDesc,
    f: [['date', '날짜', 'date'], ['pid', '원생', 'stu'], ['book', '교재 / 단원', 'text'], ['content', '진도 내용', 'area'], ['hw', '과제', 'text']],
    title: r => r.date + ' · ' + r.name + (r.book ? ' — ' + r.book : ''), sub: r => [r.content, r.hw ? '과제: ' + r.hw : ''],
    cols: [['날짜', r => r.date], ['원생', r => r.name], ['교재/단원', r => r.book], ['진도 내용', r => r.content], ['과제', r => r.hw]] },
  ledger: { name: '수입지출', add: '+ 수입·지출 기록', empty: '이 달의 기록이 없습니다.', sort: byDateDesc, monthly: true,
    f: [['date', '날짜', 'date'], ['type', '구분', 'select', ['수입', '지출']], ['category', '항목 (예: 수강료, 임대료, 교재비)', 'text'], ['amount', '금액(원)', 'number'], ['memo', '메모', 'text']],
    title: r => r.date + ' · ' + r.type + ' ' + won(r.amount) + (r.category ? ' · ' + r.category : ''), sub: r => [r.memo],
    summary: rows => { const i = rows.filter(r => r.type === '수입').reduce((a, r) => a + (r.amount || 0), 0), e = rows.filter(r => r.type === '지출').reduce((a, r) => a + (r.amount || 0), 0); return '수입 ' + won(i) + ' · 지출 ' + won(e) + ' · 잔액 ' + won(i - e); },
    cols: [['날짜', r => r.date], ['구분', r => r.type], ['항목', r => r.category], ['금액', r => won(r.amount)], ['메모', r => r.memo]] },
  plan: { name: '학원연간일정', add: '+ 일정 추가', empty: '이 해의 일정이 없습니다.', sort: byDateAsc, year: true, group: r => (r.date || '').slice(0, 7),
    f: [['date', '시작일', 'date'], ['end', '종료일 (하루면 비워 두세요)', 'date'], ['title', '일정 내용', 'text'], ['memo', '메모', 'text']],
    title: r => range2(r).slice(5) + ' · ' + r.title, sub: r => [r.memo],
    cols: [['시작일', r => r.date], ['종료일', r => r.end], ['일정', r => r.title], ['메모', r => r.memo]] },
  school: { name: '학교별일정', add: '+ 학교 일정 추가', empty: '등록된 학교 일정이 없습니다.', sort: byDateAsc, year: true, schoolFilter: true, group: r => (r.date || '').slice(0, 7),
    f: [['school', '학교 이름', 'text'], ['date', '시작일', 'date'], ['end', '종료일 (하루면 비워 두세요)', 'date'], ['title', '일정 내용 (예: 중간고사, 기말고사)', 'text'], ['memo', '메모', 'text']],
    title: r => '[' + r.school + '] ' + range2(r).slice(5) + ' · ' + r.title, sub: r => [r.memo],
    cols: [['학교', r => r.school], ['시작일', r => r.date], ['종료일', r => r.end], ['일정', r => r.title], ['메모', r => r.memo]] }
};
/* 화면 공용 부품: 표 · 페이지 머리말 */
const logoOf = () => { const bid = curBranch(), br = S.branches.find(b => b.id === bid); return S.me.role === 'super' ? (bid === 'main' ? S.hqLogo : ((br && br.logoUrl) || S.hqLogo)) : meLogo(); };
function mkTable(heads, rows, acts) {
  const card = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto mb-4'), t = h('table', 'w-full text-left text-sm'), th = h('tr', 'bg-slate-50 text-xs font-bold text-slate-500');
  heads.concat(acts ? ['관리'] : []).forEach((x, i) => th.append(h('th', 'px-4 py-3 whitespace-nowrap' + (acts && i === heads.length ? ' text-right' : ''), x))); t.append(th);
  rows.forEach((r, i) => {
    const tr = h('tr', 'border-t border-slate-100 hover:bg-slate-50');
    r.forEach(v => { const td = h('td', 'px-4 py-3 align-top'); if (v instanceof Node) td.append(v); else if (Array.isArray(v)) { td.append(h('div', 'font-semibold text-slate-800 break-all', v[0] || '-')); if (v[1]) td.append(h('div', 'text-xs text-slate-400 mt-0.5 break-all', v[1])); } else td.append(h('div', 'text-slate-700 break-all whitespace-pre-wrap', v == null || v === '' ? '-' : String(v))); tr.append(td); });
    if (acts) { const td = h('td', 'px-4 py-3 align-top text-right whitespace-nowrap'); td.append(acts(i)); tr.append(td); }
    t.append(tr);
  });
  if (!rows.length) { const tr = h('tr'), td = h('td', 'px-4 py-10 text-center text-slate-400 text-sm', '내용이 없습니다.'); td.colSpan = heads.length + (acts ? 1 : 0); tr.append(td); t.append(tr); }
  card.append(t); return card;
}
const lnk = (txt, cls, fn) => btn(txt, 'text-xs font-bold px-2 py-1 rounded-lg hover:bg-slate-100 ' + cls, fn);
const pill = (txt, cls) => h('span', 'inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ' + cls, txt);
const statCard = (icon, bg, label, val, sub, valCls, onclick) => { const b = h(onclick ? 'button' : 'div', 'text-left p-4 bg-white border border-slate-200 rounded-2xl shadow-sm flex items-center justify-between gap-3' + (onclick ? ' hover:border-indigo-400' : '')), l = h('div'); l.append(h('div', 'text-xs font-bold text-slate-500', label), h('div', 'text-2xl font-black mt-1 ' + (valCls || 'text-slate-800'), val)); if (sub) l.append(h('div', 'text-[11px] text-slate-400 mt-1', sub)); b.append(l, h('div', 'w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ' + bg, icon)); if (onclick) b.onclick = () => safe(onclick); return b; };
const goTab = (grp, tab) => { MG.group = grp; MG.tab = tab; return renderManage(); };
const FILTER_CLS = 'p-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white';

async function editRow(kind, row, roster) {
  const c = MG_CRUD[kind], out = await openForm(row ? '수정' : c.add.replace('+ ', ''), c.f, row, roster); if (!out) return;
  if (c.f.some(f => f[2] === 'stu')) { const r = roster.find(x => x.id === out.pid); if (!r) return alert('원생을 선택해 주세요.'); out.name = r.name; }
  await mgSave(row ? row.id : newId(kind), { kind, ...out }); await (kind === 'ledger' ? renderSum() : renderCrud(kind));
}
async function renderCrud(kind) {
  const c = MG_CRUD[kind]; if (kind === 'stu') await loadCfg();
  const roster = (c.f.some(f => f[2] === 'stu') || kind === 'stu') ? await loadRoster() : null;
  const all = kind === 'stu' ? roster.slice() : (await mgGet(kind)).sort(c.sort); let rows = all;
  const box = $('mg-body'), acts = $('mg-actions'); box.innerHTML = ''; acts.innerHTML = '';
  acts.append(btn(c.add, 'bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2.5 rounded-xl font-bold shadow-md', () => editRow(kind, null, roster)));
  const top = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm p-3 mb-4 flex flex-wrap items-center gap-2');
  MG.q = MG.q || {}; MG.f2 = MG.f2 || {};
  if (c.search) {
    const qi = inp('text', 'flex-grow min-w-[160px] bg-white'); qi.placeholder = '🔍 검색 (이름, 과목, 연락처, 메모...)'; qi.value = MG.q[kind] || '';
    qi.onchange = () => { MG.q[kind] = qi.value.trim(); safe(() => renderCrud(kind)); }; top.append(qi);
    const q = (MG.q[kind] || '').toLowerCase(); if (q) rows = rows.filter(r => Object.values(r).join(' ').toLowerCase().includes(q));
  }
  if (kind === 'stu') {
    const sel = h('select', FILTER_CLS), gl = [...new Set(all.map(r => r.grade).filter(Boolean))];
    ['전체 학년'].concat(gl).forEach(g => { const o = h('option', '', g); o.value = g === '전체 학년' ? '' : g; sel.append(o); }); sel.value = gl.includes(MG.f2.stu) ? MG.f2.stu : ''; sel.onchange = () => { MG.f2.stu = sel.value; safe(() => renderCrud(kind)); }; top.append(sel); if (sel.value) rows = rows.filter(r => r.grade === sel.value);
  }
  if (kind === 'teacher') {
    const sel = h('select', FILTER_CLS); [['', '전체 재직상태'], ['재직 중', '재직 중'], ['휴직 중', '휴직 중'], ['퇴사', '퇴사']].forEach(([v, t]) => { const o = h('option', '', t); o.value = v; sel.append(o); }); sel.value = MG.f2.teacher || ''; sel.onchange = () => { MG.f2.teacher = sel.value; safe(() => renderCrud(kind)); }; top.append(sel); if (sel.value) rows = rows.filter(r => (r.status || '재직 중') === sel.value);
  }
  if (c.monthly) { const mi = inp('month'); mi.value = MG.month || (MG.month = today().slice(0, 7)); mi.onchange = () => { if (mi.value) { MG.month = mi.value; safe(() => renderCrud(kind)); } }; top.append(mi); rows = rows.filter(r => (r.date || '').startsWith(MG.month)); }
  if (c.year) { const yi = inp('number', 'w-24'); yi.value = MG.year; yi.onchange = () => { if (yi.value) { MG.year = Number(yi.value); safe(() => renderCrud(kind)); } }; top.append(yi, h('span', 'text-xs font-bold text-slate-500', '년')); rows = rows.filter(r => (r.date || '').startsWith(String(MG.year))); }
  if (c.schoolFilter) {
    const sel = h('select', FILTER_CLS);
    [''].concat([...new Set(all.map(r => r.school).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))).forEach(n => { const o = h('option', '', n || '전체 학교'); o.value = n; sel.append(o); });
    sel.value = [...sel.options].some(o => o.value === MG.school) ? MG.school : ''; MG.school = sel.value; sel.onchange = () => { MG.school = sel.value; safe(() => renderCrud(kind)); };
    top.append(sel); if (MG.school) rows = rows.filter(r => r.school === MG.school);
  }
  top.append(h('span', 'flex-grow'), exportBar(c.name, c.cols.map(x => x[0]), rows.map(r => c.cols.map(x => x[1](r)))));
  box.append(top);
  if (c.note) box.append(h('div', 'text-xs font-bold text-slate-400 mb-3', c.note));
  if (c.summary) box.append(h('div', 'text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-100 rounded-xl px-3 py-2 mb-3', c.summary(rows)));
  const del = async r => { if (!confirm('삭제할까요?')) return; await mgRef(r.id).delete(); await renderCrud(kind); };
  const rowActs = r => { const d = h('div', 'inline-flex gap-1'); if (r.acct) d.append(pill('학습 계정', 'bg-indigo-50 text-indigo-600')); else d.append(lnk('✏️ 수정', 'text-indigo-600', () => editRow(kind, r, roster)), lnk('🗑 삭제', 'text-rose-500', () => del(r))); return d; };
  if (c.cards) {
    if (!rows.length) box.append(h('div', 'text-center py-10 text-slate-400 text-sm', c.empty));
    const g = h('div', 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'); box.append(g);
    rows.forEach(r => { const cd = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm p-4'), t = h('div', 'flex items-center justify-between mb-2'); t.append(pill(r.days || '요일 미정', 'bg-indigo-50 text-indigo-700'), h('span', 'text-xs text-slate-400 font-bold', [r.time, r.minutes ? r.minutes + '분' : ''].filter(Boolean).join(' · ')));
      cd.append(t, h('div', 'font-bold text-slate-800', r.name), h('div', 'text-xs text-slate-500 mt-1', [r.subject, r.teacher ? '담당: ' + r.teacher : ''].filter(Boolean).join(' · ') || ' '), r.memo ? h('div', 'text-xs text-slate-400 mt-1', r.memo) : h('span'));
      const a = h('div', 'flex justify-end gap-1 border-t border-slate-100 mt-3 pt-2'); a.append(lnk('✏️ 수정', 'text-indigo-600', () => editRow(kind, r, roster)), lnk('🗑 삭제', 'text-rose-500', () => del(r))); cd.append(a); g.append(cd); });
    return;
  }
  const heads = (c.tcols || c.cols).map(x => x[0]);
  const chunks = []; rows.forEach(r => { const g = c.group ? c.group(r) : ''; if (!chunks.length || chunks[chunks.length - 1].g !== g) chunks.push({ g, rows: [] }); chunks[chunks.length - 1].rows.push(r); });
  if (!chunks.length) chunks.push({ g: '', rows: [] });
  chunks.forEach(ch => { if (c.group) box.append(h('h3', 'text-sm font-bold text-indigo-700 mt-3 mb-2', ch.g ? ch.g.replace('-', '년 ') + '월' : '날짜 없음')); box.append(mkTable(heads, ch.rows.map(r => (c.tcols || c.cols).map(x => x[1](r))), i => rowActs(ch.rows[i]))); });
}

/* 강사 출퇴근관리 (버튼 한 번 = 출근 시간, 다시 한 번 = 퇴근 시간) */
async function renderTclk() {
  const teachers = (await mgTeachersPlus()).sort(byName), date = MG.date || (MG.date = today()), month = date.slice(0, 7), bid = curBranch(), box = $('mg-body');
  let docs = await mgGet('tclk', ['month', month]);
  const put = async (t, patch) => {
    const id = 'tclk_' + bid + '_' + date + '_' + t.id, rec = docs.find(d => d.id === id);
    const data = { kind: 'tclk', month, date, pid: t.id, name: t.name, arrival: rec ? rec.arrival : null, end: rec ? rec.end : null, ...patch };
    await mgSave(id, data); docs = docs.filter(d => d.id !== id).concat([{ id, branchId: bid, ...data }]); draw();
  };
  const hrsOf = d => d.arrival && d.end ? (d.end - d.arrival) / 3600000 : 0;
  const draw = () => {
    box.innerHTML = '';
    const bar = h('div', 'flex flex-wrap items-center gap-3 mb-3'), di = inp('date'); di.value = date;
    di.onchange = () => { if (di.value) { MG.date = di.value; safe(renderTclk); } };
    const mrows = docs.slice().sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko')).map(d => [d.date, d.name, hm(d.arrival), hm(d.end), d.end ? Math.round(hrsOf(d) * 10) / 10 + '시간' : '-']);
    bar.append(di, h('span', 'flex-grow text-xs text-slate-400 font-bold', '출근 버튼 → 퇴근 버튼 순서로 누르면 시간이 자동 기록·계산됩니다.'), exportBar('강사출퇴근_' + month, ['날짜', '강사', '출근', '퇴근', '근무시간'], mrows, month + ' 출퇴근', '월간 '));
    box.append(bar);
    if (!teachers.length) box.append(h('div', 'text-center py-10 text-slate-400 text-sm', '먼저 "강사 등록·수정·삭제"에서 강사를 등록해 주세요.'));
    teachers.forEach(t => {
      const rec = docs.find(d => d.date === date && d.pid === t.id) || {}, row = h('div', 'p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 mb-2'), r = h('div', 'flex flex-wrap items-center gap-2');
      row.append(h('span', 'font-bold text-slate-800 text-sm', t.name));
      r.append(h('span', 'text-xs text-slate-600 font-bold', '출근 ' + hm(rec.arrival) + ' · 퇴근 ' + hm(rec.end) + (rec.end ? ' · ' + dur(rec.arrival, rec.end) : '')));
      if (!rec.arrival) r.append(btn('출근', 'text-xs px-4 py-2 rounded-xl font-bold bg-emerald-500 text-white', async () => put(t, { arrival: Date.now() })));
      else if (!rec.end) r.append(btn('퇴근', 'text-xs px-4 py-2 rounded-xl font-bold bg-slate-700 text-white', async () => put(t, { end: Date.now() })));
      r.append(btn('✏️', B2, async () => {
        const a = prompt('출근 시간 (예: 09:30)', rec.arrival ? hm(rec.arrival) : ''); if (a === null) return;
        const e = prompt('퇴근 시간 (예: 18:00, 비우면 퇴근 전)', rec.end ? hm(rec.end) : ''); if (e === null) return;
        const A = tsOf(date, a.trim()), E = e.trim() ? tsOf(date, e.trim()) : null;
        if (!A || (e.trim() && !E) || (E && E <= A)) return alert('시간을 HH:MM 형식으로, 퇴근이 출근보다 늦게 입력하세요.');
        await put(t, { arrival: A, end: E });
      }));
      if (rec.arrival) r.append(btn('🗑', B2, async () => { if (!confirm('이 날의 출퇴근 기록을 지울까요?')) return; await mgRef('tclk_' + bid + '_' + date + '_' + t.id).delete(); docs = docs.filter(d => !(d.date === date && d.pid === t.id)); draw(); }));
      row.append(r); box.append(row);
    });
    if (teachers.length) {
      box.append(h('h3', 'text-sm font-bold text-indigo-700 mt-5 mb-2', month + ' 월 요약'));
      teachers.forEach(t => { const mine = docs.filter(d => d.pid === t.id && d.end), hrs = mine.reduce((a, d) => a + hrsOf(d), 0); box.append(h('div', 'text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2 mb-1.5', t.name + '  ·  출근 ' + mine.length + '일 · 총 ' + (Math.round(hrs * 10) / 10) + '시간')); });
    }
  };
  draw();
}

/* 강사 급여관리 */
async function renderPay() {
  const month = MG.month || (MG.month = today().slice(0, 7)), bid = curBranch(), box = $('mg-body');
  const teachers = (await mgGet('teacher')).sort(byName), clk = await mgGet('tclk', ['month', month]);
  let pays = await mgGet('pay', ['month', month]);
  const calc = t => { const mine = clk.filter(d => d.pid === t.id && d.arrival && d.end), hrs = mine.reduce((a, d) => a + (d.end - d.arrival) / 3600000, 0); return { days: mine.length, hrs: Math.round(hrs * 10) / 10, base: estPay(t, hrs, month) }; };
  const save = async (t, patch) => {
    const id = 'pay_' + bid + '_' + month + '_' + t.id, rec = pays.find(d => d.id === id), c = calc(t);
    const data = { kind: 'pay', month, pid: t.id, name: t.name, amount: rec && rec.amount != null ? rec.amount : c.base, paid: rec ? !!rec.paid : false, paidDate: rec ? rec.paidDate || '' : '', ...patch };
    await mgSave(id, data); pays = pays.filter(d => d.id !== id).concat([{ id, branchId: bid, ...data }]);
  };
  const draw = () => {
    box.innerHTML = '';
    const bar = h('div', 'flex flex-wrap items-center gap-3 mb-3'), mi = inp('month'); mi.value = month;
    mi.onchange = () => { if (mi.value) { MG.month = mi.value; safe(renderPay); } };
    const info = teachers.map(t => { const c = calc(t), rec = pays.find(d => d.pid === t.id), amt = rec && rec.amount != null ? rec.amount : c.base; return { t, c, rec, amt }; });
    bar.append(mi, h('span', 'flex-grow text-xs text-slate-400 font-bold', '계산 급여는 출퇴근 기록 기준 참고값입니다. 최종 금액은 직접 고칠 수 있습니다.'),
      exportBar('급여관리_' + month, ['강사', '급여 방식', '근무일수', '근무시간', '계산 급여', '최종 금액', '지급', '지급일'], info.map(x => [x.t.name, x.t.payType + ' ' + won(x.t.pay), x.c.days, x.c.hrs, won(x.c.base), won(x.amt), x.rec && x.rec.paid ? '지급 완료' : '미지급', x.rec ? x.rec.paidDate || '' : '']), month + ' 급여'));
    box.append(bar);
    const tot = info.reduce((a, x) => a + x.amt, 0), got = info.filter(x => x.rec && x.rec.paid).reduce((a, x) => a + x.amt, 0);
    box.append(h('div', 'text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-100 rounded-xl px-3 py-2 mb-3', '급여 합계 ' + won(tot) + ' · 지급 완료 ' + won(got) + ' · 미지급 ' + won(tot - got)));
    if (!teachers.length) box.append(h('div', 'text-center py-10 text-slate-400 text-sm', '먼저 "강사 등록·수정·삭제"에서 강사를 등록해 주세요.'));
    info.forEach(({ t, c, rec, amt }) => {
      const row = h('div', 'p-3 bg-slate-50 border border-slate-200 rounded-xl mb-2'), r = h('div', 'flex flex-wrap items-center justify-between gap-2 mt-2');
      row.append(h('div', 'font-bold text-slate-800 text-sm', t.name + ' · ' + t.payType + ' ' + won(t.pay) + (t.payDay ? ' · 급여일 매월 ' + t.payDay + '일' : '')), h('div', 'text-xs text-slate-500 mt-1', '근무 ' + c.days + '일 · ' + c.hrs + '시간 · 계산 급여 ' + won(c.base)));
      const ai = inp('number', 'w-32'); ai.value = amt; ai.onchange = () => safe(async () => { await save(t, { amount: Number(ai.value) || 0 }); draw(); });
      const paid = rec && rec.paid;
      r.append(h('span', 'text-xs font-bold text-slate-600', '최종 금액(원)'), ai, btn(paid ? '✔ 지급 완료 ' + (rec.paidDate || '').slice(5) : '미지급', 'text-xs px-3 py-2 rounded-xl font-bold border ' + (paid ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-rose-500 border-rose-200'), async () => { await save(t, { paid: !paid, paidDate: paid ? '' : today() }); draw(); }));
      row.append(r); box.append(row);
    });
  };
  draw();
}

async function renderFee() {
  const roster = await loadRoster(), month = MG.month || (MG.month = today().slice(0, 7)), bid = curBranch(), box = $('mg-body');
  let docs = await mgGet('fee', ['month', month]);
  const idOf = (m, p) => 'fee_' + bid + '_' + m + '_' + p.id;
  const save = async (p, patch) => {
    const rec = docs.find(d => d.pid === p.id), id = idOf(month, p), data = { kind: 'fee', month, pid: p.id, name: p.name, amount: rec ? rec.amount : 0, paid: rec ? !!rec.paid : false, paidDate: rec ? rec.paidDate || '' : '', ...patch };
    await mgSave(id, data); docs = docs.filter(d => d.id !== id).concat([{ id, branchId: bid, ...data }]);
  };
  const draw = () => {
    box.innerHTML = '';
    const bar = h('div', 'flex flex-wrap items-center gap-2 mb-3'), mi = inp('month'); mi.value = month;
    mi.onchange = () => { if (mi.value) { MG.month = mi.value; safe(renderFee); } };
    bar.append(mi, btn('지난달 금액 불러오기', B2, async () => {
      for (const d of await mgGet('fee', ['month', prevMonth(month)])) { const p = roster.find(x => x.id === d.pid); if (p && d.amount > 0 && !docs.some(x => x.pid === p.id && x.amount > 0)) await save(p, { amount: d.amount, paid: false, paidDate: '' }); }
      draw();
    }), btn('전체 금액 한 번에 입력', B2, async () => {
      const a = Number(prompt('모든 원생에게 적용할 월 회비(원)를 입력하세요. 이미 금액이 있는 원생은 그대로 둡니다.')); if (!(a > 0)) return;
      for (const p of roster) if (!docs.some(x => x.pid === p.id && x.amount > 0)) await save(p, { amount: a });
      draw();
    }));
    bar.append(exportBar('회비관리_' + month, ['원생', '월', '금액', '납부', '납부일'], roster.map(p => { const d = docs.find(x => x.pid === p.id) || {}; return [p.name, month, d.amount || 0, d.paid ? '납부' : '미납', d.paidDate || '']; }), month + ' 회비'));
    box.append(bar);
    const bill = docs.reduce((a, d) => a + (Number(d.amount) || 0), 0), got = docs.filter(d => d.paid).reduce((a, d) => a + (Number(d.amount) || 0), 0), un = docs.filter(d => !d.paid && d.amount > 0).length;
    box.append(h('div', 'text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-100 rounded-xl px-3 py-2 mb-3', '청구 ' + won(bill) + ' · 수납 ' + won(got) + ' · 미납 ' + un + '명 (' + won(bill - got) + ')'));
    if (!roster.length) box.append(h('div', 'text-center py-10 text-slate-400 text-sm', '등록된 원생이 없습니다.'));
    roster.forEach(p => {
      const rec = docs.find(d => d.pid === p.id), row = h('div', 'p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2 mb-2'), r = h('div', 'flex items-center gap-2');
      row.append(h('span', 'font-bold text-slate-800 text-sm', p.name + (p.grade ? ' (' + p.grade + ')' : '')));
      const ai = inp('number', 'w-28'); ai.placeholder = '회비(원)'; ai.value = rec && rec.amount ? rec.amount : '';
      ai.onchange = () => safe(async () => { await save(p, { amount: Number(ai.value) || 0 }); draw(); });
      const paid = rec && rec.paid;
      r.append(ai, btn(paid ? '✔ 납부 완료' + (rec.paidDate ? ' ' + rec.paidDate.slice(5) : '') : '미납', 'text-xs px-3 py-2 rounded-xl font-bold border ' + (paid ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-rose-500 border-rose-200'), async () => { await save(p, { paid: !paid, paidDate: paid ? '' : today() }); draw(); }));
      row.append(r); box.append(row);
    });
  };
  draw();
}

/* 학생 출결관리: 관리자 화면 + 학생 터치 화면 (30일 후 자동 삭제) */
async function loadAtt() {
  const all = await mgGet('att'), cut = dayOf(Date.now() - 30 * 864e5), old = all.filter(d => d.date < cut);
  for (let i = 0; i < old.length; i += 400) { const b = db.batch(); old.slice(i, i + 400).forEach(d => b.delete(mgRef(d.id))); await b.commit().catch(() => {}); }
  return all.filter(d => d.date >= cut);
}
function resizeToDataUrl(file, maxW, q) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { const k = Math.min(1, maxW / img.width), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', q)); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없습니다.')); };
    img.src = url;
  });
}
async function renderAtt() {
  const cfg = await loadCfg(), roster = await loadRoster(), bid = curBranch(), date = MG.date || (MG.date = today()), box = $('mg-body'), acts = $('mg-actions'), acad = acadName();
  let docs = await loadAtt(), showSet = false;
  const put = async (st, d, patch) => {
    const id = 'att_' + bid + '_' + d + '_' + st.id, rec = docs.find(x => x.id === id);
    const data = rec ? patch : { kind: 'att', month: d.slice(0, 7), date: d, pid: st.id, name: st.name, grade: st.grade || '', arrival: null, end: null, expireAt: firebase.firestore.Timestamp.fromMillis(Date.now() + KEEP), ...patch };
    await mgSave(id, data); docs = docs.filter(x => x.id !== id).concat([{ ...(rec || {}), id, branchId: bid, ...data }]); draw();
  };
  const ask = (st, rec) => {
    const ending = !!(rec && rec.arrival), m = h('div', 'fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-5'), bx = h('div', 'bg-white rounded-2xl w-full max-w-sm p-6 text-center'), row = h('div', 'flex gap-2');
    bx.append(h('h3', 'text-2xl font-bold mb-2', st.name), h('p', 'text-slate-500 text-sm mb-5', ending ? '수업이 끝났나요? 확인을 누르면 현재 시간이 수업 종료 시간으로 기록됩니다.' : '본인 이름이 맞나요? 확인을 누르면 현재 시간이 등원 시간으로 기록됩니다.'));
    row.append(btn('취소', 'flex-1 py-3 rounded-xl bg-slate-200 font-bold', async () => m.remove()), btn(ending ? '수업 종료' : '등원 확인', 'flex-1 py-3 rounded-xl bg-rose-600 text-white font-bold', async () => { m.remove(); await put(st, today(), ending ? { end: Date.now() } : { arrival: Date.now() }); }));
    bx.append(row); m.append(bx); document.body.append(m);
  };
  const draw = () => {
    box.innerHTML = ''; acts.innerHTML = '';
    const grades = cfg.grades.concat([...new Set(roster.map(r => r.grade).filter(g => g && !cfg.grades.includes(g)))]), flt = grades.includes(MG.attGrade) ? MG.attGrade : '', list = roster.filter(r => !flt || r.grade === flt), td = today();
    if (S.me.role === 'sub' || (S.me.role === 'super' && bid === 'main')) { const lf = h('input'); lf.type = 'file'; lf.accept = 'image/png,image/jpeg,image/webp,image/gif,application/pdf'; lf.className = 'hidden'; lf.onchange = () => { const f = lf.files[0]; lf.value = ''; if (f) safe(async () => { await setLogo(f); await renderAtt(); }); }; acts.append(lf, btn('🖼 학원 로고 변경', 'bg-slate-800 hover:bg-slate-900 text-white text-xs px-3 py-2.5 rounded-xl font-bold', async () => lf.click())); }
    acts.append(btn('✏️ 학원명 변경', 'bg-rose-700 hover:bg-rose-800 text-white text-xs px-3 py-2.5 rounded-xl font-bold', async () => {
      const n = (prompt('변경할 학원명을 입력하세요.', acad || '') || '').trim(); if (!n) return; if (n.length > 40) return alert('학원명은 40자 이내로 입력하세요.');
      if (S.me.role === 'sub') { const b = db.batch(); b.update(db.collection('branches').doc(S.me.uid), { academyName: n, nameSet: true }); b.update(db.collection('users').doc(S.me.uid), { academyName: n, name: n }); await b.commit(); S.me.academyName = n; S.me.nameBlank = false; applyBrand(); }
      else if (bid === 'main') { await db.collection('config').doc('main').set({ academyName: n }, { merge: true }); S.hqName = n; }
      else { const b = db.batch(); b.update(db.collection('branches').doc(bid), { academyName: n }); b.update(db.collection('users').doc(bid), { academyName: n, name: n }); await b.commit(); const br = S.branches.find(x => x.id === bid); if (br) br.academyName = n; }
      toast('학원명이 변경되었습니다.'); setTimeout(() => toast(''), 1500); await renderManage();
    }));
    acts.append(btn('⚙ 학년·배너·비밀번호', 'bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-2.5 rounded-xl font-bold', async () => { showSet = !showSet; draw(); }),
      btn('+ 학생 등록', 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-2.5 rounded-xl font-bold', async () => { const o = await openForm('학생 등록', MG_CRUD.stu.f, null, roster); if (!o) return; await mgSave(newId('stu'), { kind: 'stu', ...o }); roster.splice(0, roster.length, ...(await loadRoster())); draw(); }),
      btn('⛶ 전체화면 터치 모드', 'bg-rose-600 hover:bg-rose-700 text-white text-xs px-3 py-2.5 rounded-xl font-bold', async () => openKiosk(cfg, roster)));
    const logo = logoOf(), bn = h('div', 'rounded-2xl p-5 mb-4 text-white flex flex-wrap items-center justify-between gap-4 shadow-lg'); bn.style.background = nameBlank() ? SKY : 'linear-gradient(90deg,#9f1239,#e11d48)'; if (nameBlank()) bn.style.color = '#0c4a6e';
    const lb = h('div', 'flex items-center gap-4'), ic = h('div', 'w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl overflow-hidden flex-shrink-0'); if (logo) { const im = h('img', 'w-full h-full object-contain bg-white'); im.src = logo; ic.append(im); } else if (blankLogo()) ic.style.background = '#bae6fd'; else ic.textContent = '🎓';
    const tx = h('div'); tx.append(h('div', 'text-[10px] font-bold tracking-widest opacity-80', '태블릿 입·출결 모드 BANNER'), h('div', 'text-xl font-black min-h-[1.75rem]', acad), h('div', 'text-xs opacity-90 mt-1', '이름을 터치하여 등원시 [도착시간], 수업 완료 후 한번 더 터치시 [하원/수업시간]이 기록됩니다.')); lb.append(ic, tx);
    const cnt = h('div', 'bg-white/15 rounded-xl px-5 py-3 text-center'); cnt.append(h('div', 'text-[11px] opacity-90', '오늘 등원 완료'), h('div', 'text-2xl font-black', roster.filter(st => docs.some(d => d.date === td && d.pid === st.id && d.arrival)).length + '명'));
    bn.append(lb, cnt); box.append(bn);
    if (showSet) {
      const gm = h('div', 'mb-4 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm'), tags = h('div', 'flex flex-wrap gap-2 mb-3');
      gm.append(h('div', 'text-xs font-bold text-slate-600 mb-2', '학년 관리 (터치 화면의 학년 탭이 됩니다)'));
      cfg.grades.forEach((g, i) => { const t = h('span', 'inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-full pl-3 pr-1 py-1 text-xs font-bold', g); t.append(btn('✕', 'w-5 h-5 rounded-full bg-rose-600 text-white text-[10px]', async () => { if (!confirm('"' + g + '" 학년을 목록에서 뺄까요? (학생 정보는 지워지지 않습니다)')) return; cfg.grades.splice(i, 1); await saveCfg(); draw(); })); tags.append(t); });
      const gi = inp('text', 'w-40'); gi.placeholder = '학년 이름 (예: 고3)';
      const gr = h('div', 'flex flex-wrap items-center gap-2 mb-3'); gr.append(gi, btn('+ 학년 추가', B1, async () => { const g = gi.value.trim(); if (!g) return; if (cfg.grades.includes(g)) return alert('이미 있는 학년입니다.'); cfg.grades.push(g); await saveCfg(); draw(); }));
      const tool = h('div', 'flex flex-wrap gap-2 border-t border-slate-100 pt-3');
      const bf = h('input'); bf.type = 'file'; bf.accept = 'image/png,image/jpeg,image/webp'; bf.className = 'hidden';
      bf.onchange = () => { const f = bf.files[0]; bf.value = ''; if (f) safe(async () => { const d = await resizeToDataUrl(f, 1100, 0.82); if (d.length > 800000) throw new Error('배너 이미지가 너무 큽니다. 더 작은 이미지를 사용하세요.'); cfg.banner = d; toast('배너 저장 중...'); await saveCfg(); toast(''); draw(); }); };
      tool.append(bf, btn('🖼 터치 화면 배너 올리기', B2, async () => bf.click()));
      if (cfg.banner) tool.append(btn('배너 삭제', B2, async () => { cfg.banner = ''; await saveCfg(); draw(); }));
      tool.append(btn(cfg.pin ? '🔒 나가기 비밀번호 변경' : '🔒 나가기 비밀번호 설정', B2, async () => { const v = prompt('전체화면 터치 모드에서 나갈 때 입력할 비밀번호(숫자 4자리 이상)를 입력하세요. 비워 두면 해제됩니다.', cfg.pin); if (v === null) return; if (v.trim() && !/^\d{4,}$/.test(v.trim())) return alert('숫자 4자리 이상으로 입력하세요.'); cfg.pin = v.trim(); await saveCfg(); draw(); }));
      gm.append(tags, gr, tool); box.append(gm);
    }
    const tabs = h('div', 'flex flex-wrap gap-2 mb-4'); [''].concat(grades).forEach(g => tabs.append(btn(g || '전체 학년', 'px-4 py-2 rounded-full text-sm font-bold border ' + (g === flt ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'), async () => { MG.attGrade = g; draw(); }))); box.append(tabs);
    const tc = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-4'), th = h('div', 'flex flex-wrap items-center justify-between gap-2 mb-3');
    const lg = h('div', 'flex items-center gap-3 text-[11px] font-bold text-slate-500'); lg.append(h('span', '', '⚪ 미등원'), h('span', '', '🟡 1회 터치 (등원중)'), h('span', '', '🟢 2회 터치 (하원)')); th.append(h('h3', 'font-bold text-slate-800', '👆 학생 이름을 터치하세요'), lg); tc.append(th);
    if (!list.length) tc.append(h('div', 'text-center py-8 text-slate-400 text-sm', '등록된 학생이 없습니다. "+ 학생 등록"으로 추가하세요.'));
    const grid = h('div', 'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3');
    list.forEach(st => {
      const rec = docs.find(d => d.date === td && d.pid === st.id), state = !rec || !rec.arrival ? 0 : !rec.end ? 1 : 2;
      const b = h('button', 'text-left rounded-2xl border-2 p-4 transition active:scale-95 ' + ['bg-white border-slate-200', 'bg-amber-50 border-amber-400', 'bg-emerald-50 border-emerald-400'][state]), t = h('div', 'flex items-center justify-between');
      t.append(h('span', 'text-xs font-bold text-slate-500', st.grade || '미분류'), pill(['미등원', '등원중', '하원'][state], ['bg-slate-100 text-slate-500', 'bg-amber-200 text-amber-800', 'bg-emerald-200 text-emerald-800'][state]));
      b.append(t, h('div', 'text-xl font-black text-slate-800 mt-1', st.name), h('div', 'text-[11px] text-slate-400', acad), h('div', 'text-xs font-bold mt-2 pt-2 border-t border-slate-200 ' + ['text-indigo-600', 'text-amber-700', 'text-emerald-700'][state], state === 0 ? '⏱ 이름을 터치하여 등원' : state === 1 ? '등원 ' + hm(rec.arrival) + ' · 끝나면 다시 터치' : hm(rec.arrival) + ' → ' + hm(rec.end) + ' · ' + dur(rec.arrival, rec.end)));
      b.disabled = state === 2; if (!b.disabled) b.onclick = () => ask(st, rec); grid.append(b);
    });
    tc.append(grid); box.append(tc);
    const day = docs.filter(d => d.date === date && (!flt || d.grade === flt)).sort((a, b) => (a.arrival || 0) - (b.arrival || 0));
    const mon = docs.filter(d => d.month === date.slice(0, 7) && (!flt || d.grade === flt)).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'));
    const hd = h('div', 'flex flex-wrap items-center justify-between gap-2 mb-2'), di = inp('date'); di.value = date; di.onchange = () => { if (di.value) { MG.date = di.value; safe(renderAtt); } };
    const hl = h('div', 'flex flex-wrap items-center gap-2'); hl.append(h('h3', 'font-bold text-slate-800', '📋 실시간 출결 현황'), di);
    const hr = h('div', 'flex flex-wrap items-center gap-2'); hr.append(exportBar('학생출결_' + date, ['학년', '이름', '등원', '종료', '수업 시간'], day.map(d => [d.grade || '', d.name, hm(d.arrival), hm(d.end), dur(d.arrival, d.end)]), date + ' 출결', '일별 '), exportBar('학생출결_' + date.slice(0, 7), ['날짜', '학년', '이름', '등원', '종료', '수업 시간'], mon.map(d => [d.date, d.grade || '', d.name, hm(d.arrival), hm(d.end), dur(d.arrival, d.end)]), date.slice(0, 7) + ' 출결', '월간 '),
      btn('기록 초기화', 'text-xs font-bold px-3 py-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100', async () => { if (!day.length || !confirm(date + ' 출결 기록 ' + day.length + '건을 모두 지울까요?')) return; const b = db.batch(); day.forEach(d => b.delete(mgRef(d.id))); await b.commit(); docs = docs.filter(x => !day.includes(x)); draw(); })); hd.append(hl, hr); box.append(hd);
    const stOf = id => roster.find(r => r.id === id) || { id, name: '' };
    box.append(mkTable(['학생명', '학년', '도착 시간 (등원)', '수업 끝난 시각 (하원)', '총 수업한 시간', '상태'], day.map(d => [[d.name], d.grade || '', hm(d.arrival), hm(d.end), dur(d.arrival, d.end), d.end ? pill('하원', 'bg-emerald-100 text-emerald-700') : pill('등원중', 'bg-amber-100 text-amber-700')]), i => {
      const d = day[i], w = h('div', 'inline-flex gap-1');
      w.append(lnk('✏️', 'text-indigo-600', async () => {
        const a = prompt('등원 시간 (예: 14:30)', d.arrival ? hm(d.arrival) : ''); if (a === null) return;
        const e = prompt('수업 종료 시간 (예: 16:00, 비우면 종료 전)', d.end ? hm(d.end) : ''); if (e === null) return;
        const A = tsOf(d.date, a.trim()), E = e.trim() ? tsOf(d.date, e.trim()) : null;
        if (!A || (e.trim() && !E) || (E && E <= A)) return alert('시간을 HH:MM 형식으로, 종료가 등원보다 늦게 입력하세요.');
        await put({ id: d.pid, name: d.name, grade: d.grade }, d.date, { arrival: A, end: E });
      }), lnk('🗑', 'text-rose-500', async () => { if (!confirm('이 출결 기록을 지울까요?')) return; await mgRef(d.id).delete(); docs = docs.filter(x => x.id !== d.id); draw(); })); return w;
    }));
    box.append(h('p', 'text-[11px] text-slate-400', '※ 출결 기록은 30일 뒤 자동 삭제됩니다. 보관이 필요하면 삭제되기 전에 월간 인쇄 또는 CSV 저장을 해 두세요.'));
  };
  draw();
  if (MG.openReg) { MG.openReg = false; const o = await openForm('학생 등록', MG_CRUD.stu.f, null, roster); if (o) { await mgSave(newId('stu'), { kind: 'stu', ...o }); roster.splice(0, roster.length, ...(await loadRoster())); draw(); } }
}
function openKiosk(cfg, roster) {
  const bid = curBranch(), acad = acadName(), br = S.branches.find(b => b.id === bid);
  const logo = S.me.role === 'super' ? (bid === 'main' ? S.hqLogo : ((br && br.logoUrl) || S.hqLogo)) : meLogo();
  let kdate = today(), docs = [], iv = null;
  const ov = h('div', 'fixed inset-0 z-40 bg-slate-100 overflow-y-auto'); document.body.append(ov);
  const glist = cfg.grades.concat([...new Set(roster.map(r => r.grade || '미분류').filter(g => !cfg.grades.includes(g)))]).filter(g => roster.some(r => (r.grade || '미분류') === g));
  let kg = glist.includes(MG.kGrade) ? MG.kGrade : glist[0];
  const load = async () => { kdate = today(); docs = await mgGet('att', ['date', kdate]); draw(); };
  const tap = async st => {
    if (today() !== kdate) { await load(); return alert('날짜가 바뀌었습니다. 다시 눌러 주세요.'); }
    const id = 'att_' + bid + '_' + kdate + '_' + st.id, rec = docs.find(d => d.id === id), now = Date.now();
    const data = rec && rec.arrival ? { end: now } : { kind: 'att', month: kdate.slice(0, 7), date: kdate, pid: st.id, name: st.name, grade: st.grade || '', arrival: now, end: null, expireAt: firebase.firestore.Timestamp.fromMillis(now + KEEP) };
    await mgSave(id, data); docs = docs.filter(d => d.id !== id).concat([{ ...(rec || {}), id, branchId: bid, ...data }]); draw();
  };
  const ask = (st, rec) => {
    const ending = !!(rec && rec.arrival), m = h('div', 'fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-5'), bx = h('div', 'bg-white rounded-2xl w-full max-w-sm p-6 text-center'), row = h('div', 'flex gap-2');
    bx.append(h('h3', 'text-2xl font-bold mb-2', st.name), h('p', 'text-slate-500 text-sm mb-5', ending ? '수업이 끝났나요? 확인을 누르면 현재 시간이 수업 종료 시간으로 기록됩니다.' : '본인 이름이 맞나요? 확인을 누르면 현재 시간이 등원 시간으로 기록됩니다.'));
    row.append(btn('취소', 'flex-1 py-3 rounded-xl bg-slate-200 font-bold', async () => m.remove()), btn(ending ? '수업 종료' : '등원 확인', 'flex-1 py-3 rounded-xl bg-rose-600 text-white font-bold', async () => { m.remove(); await tap(st); }));
    bx.append(row); m.append(bx); document.body.append(m);
  };
  const exitK = () => { if (cfg.pin && prompt('관리자 비밀번호를 입력하세요.') !== cfg.pin) return alert('비밀번호가 다릅니다.'); clearInterval(iv); ov.remove(); safe(renderManage); };
  const draw = () => {
    ov.innerHTML = '';
    const hd = h('div', 'bg-rose-700 text-white px-5 py-3 flex items-center justify-between gap-3'), lf = h('div', 'flex items-center gap-3');
    if (nameBlank()) { hd.className = 'text-sky-950 px-5 py-3 flex items-center justify-between gap-3'; hd.style.background = SKY; }
    if (logo) { const im = h('img', 'h-11 w-11 rounded-xl bg-white object-contain'); im.src = logo; lf.append(im); } else if (blankLogo()) { const e = h('div', 'h-11 w-11 rounded-xl'); e.style.background = '#bae6fd'; lf.append(e); }
    lf.append(h('div', 'font-bold text-lg', (acad ? acad + ' ' : '') + '출결'), h('div', 'text-xs opacity-80', kdate));
    hd.append(lf, btn('관리자 화면', 'bg-white text-rose-700 font-bold text-xs px-3 py-2 rounded-lg', async () => exitK())); ov.append(hd);
    if (cfg.banner) { const bn = h('img', 'w-full max-w-5xl mx-auto block'); bn.src = cfg.banner; ov.append(bn); }
    const bd = h('div', 'max-w-5xl mx-auto p-4'); ov.append(bd);
    bd.append(h('h2', 'text-2xl font-bold text-center mt-2', '내 이름을 눌러주세요'), h('p', 'text-center text-slate-500 text-sm mb-4', '등원할 때 한 번, 수업이 끝나면 한 번 더 눌러주세요.'));
    if (!glist.length) { bd.append(h('div', 'text-center py-10 text-slate-400', '관리자 화면에서 학생을 먼저 등록해 주세요.')); return; }
    const tabs = h('div', 'flex flex-wrap gap-2 mb-4'); glist.forEach(g => tabs.append(btn(g, 'px-5 py-3 rounded-xl font-bold text-lg ' + (g === kg ? 'bg-rose-700 text-white' : 'bg-slate-200 text-slate-700'), async () => { kg = MG.kGrade = g; draw(); }))); bd.append(tabs);
    const grid = h('div', 'grid grid-cols-2 sm:grid-cols-3 gap-3');
    roster.filter(r => (r.grade || '미분류') === kg).forEach(st => {
      const rec = docs.find(d => d.pid === st.id), state = !rec || !rec.arrival ? 0 : !rec.end ? 1 : 2;
      const b = h('button', 'min-h-[96px] rounded-2xl border-2 font-bold text-2xl p-3 ' + ['bg-white border-slate-200 text-slate-800', 'bg-amber-50 border-amber-400 text-amber-800', 'bg-emerald-50 border-emerald-400 text-emerald-800'][state]);
      b.append(document.createTextNode(st.name), h('div', 'text-xs font-semibold mt-1 opacity-80', state === 0 ? '등원하려면 눌러주세요' : state === 1 ? '등원 ' + hm(rec.arrival) + ' · 수업이 끝나면 다시 눌러주세요' : '등원 ' + hm(rec.arrival) + ' → 종료 ' + hm(rec.end) + ' · 수업 ' + dur(rec.arrival, rec.end)));
      b.disabled = state === 2; if (!b.disabled) b.onclick = () => ask(st, rec);
      grid.append(b);
    });
    bd.append(grid);
  };
  iv = setInterval(() => { if (today() !== kdate) load().catch(() => {}); }, 60000);
  safe(load);
}

function printReport(p, month, rows, st2, note) {
  const w = window.open('', '_blank'); if (!w) return alert('팝업 차단을 해제해 주세요.');
  const acad = S.me.role === 'super' ? branchName(curBranch()) : (nameBlank() ? '' : S.me.academyName);
  const tr = rows.map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + (r[2] != null ? esc(r[2]) + '점' : '-') + '</td><td>' + (r[3] ? esc(fmtD(r[3])) : '-') + '</td></tr>').join('');
  w.document.write('<html><head><meta charset="utf-8"><title>' + esc(p.name) + ' 성적표</title><style>body{font-family:sans-serif;padding:32px;color:#1e293b}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:13px;text-align:left}th{background:#f1f5f9}.box{border:1px solid #cbd5e1;border-radius:8px;padding:10px;margin:8px 0;white-space:pre-wrap;font-size:13px}</style></head><body><h1>' + esc(acad) + ' 학습 성적표</h1><div>' + esc(p.name) + (p.grade ? ' (' + esc(p.grade) + ')' : '') + ' · ' + esc(month) + '</div><p>학습 ' + st2.n + '건 · 완료 ' + st2.done + '건 · 평균 점수 ' + esc(st2.avg) + ' · 총 학습시간 ' + esc(fmtD(st2.secs)) + '</p><table><tr><th>날짜</th><th>학습 항목</th><th>점수</th><th>소요 시간</th></tr>' + tr + '</table>' + (note.extra ? '<b>추가 학습 내용</b><div class="box">' + esc(note.extra) + '</div>' : '') + (note.comment ? '<b>선생님 코멘트</b><div class="box">' + esc(note.comment) + '</div>' : '') + '</body></html>');
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
async function renderGrade() {
  const roster = await loadRoster(), month = MG.month || (MG.month = today().slice(0, 7)), box = $('mg-body'); box.innerHTML = '';
  const bar = h('div', 'flex flex-wrap items-center gap-3 mb-4'), mi = inp('month'), sel = h('select', 'p-2 border border-slate-300 rounded-xl text-sm font-bold'); mi.value = month;
  mi.onchange = () => { if (mi.value) { MG.month = mi.value; safe(renderGrade); } };
  [['', '(원생 선택)']].concat(roster.map(r => [r.id, r.name + (r.grade ? ' (' + r.grade + ')' : '')])).forEach(([v, t]) => { const o = h('option', '', t); o.value = v; sel.append(o); });
  sel.value = roster.some(r => r.id === MG.pid) ? MG.pid : ''; sel.onchange = () => { MG.pid = sel.value; safe(renderGrade); };
  bar.append(mi, sel); box.append(bar);
  const p = roster.find(r => r.id === MG.pid);
  if (!p) return box.append(h('div', 'text-center py-10 text-slate-400 text-sm', '원생을 선택하면 학습 기록 기반 성적표가 나타납니다.'));
  const hs = await db.collection('history').where('branchId', '==', curBranch()).get();
  const live = hs.docs.map(d => d.data()).filter(r => (r.day || dayOf(r.ts)).startsWith(month) && (r.studentUid === p.id || r.studentName === p.name)).sort((a, b) => a.ts - b.ts);
  const note = (await mgGet('gradenote', ['month', month])).find(n => n.pid === p.id) || {};
  const rows = live.length ? live.map(r => [r.day || dayOf(r.ts), r.title, r.kind === 'study' && r.status !== 'done' ? null : (r.score != null ? r.score : null), r.durationSec || 0, r.kind === 'study' && r.status !== 'done' ? 0 : 1]) : (note.rows || []);
  const sc = rows.filter(r => r[2] != null), st2 = { n: rows.length, done: rows.filter(r => r[4]).length, avg: sc.length ? Math.round(sc.reduce((a, r) => a + r[2], 0) / sc.length) + '점' : '-', secs: rows.reduce((a, r) => a + (r[3] || 0), 0) };
  box.append(h('div', 'text-xs font-bold bg-indigo-50 text-indigo-900 border border-indigo-100 rounded-xl px-3 py-2 mb-3', '학습 ' + st2.n + '건 · 완료 ' + st2.done + '건 · 평균 점수 ' + st2.avg + ' · 총 학습시간 ' + fmtD(st2.secs) + (live.length ? '' : (rows.length ? ' (보관된 성적표)' : ''))));
  if (!rows.length) box.append(h('div', 'text-center py-6 text-slate-400 text-sm', '이 달의 학습 기록이 없습니다.'));
  rows.forEach(r => box.append(h('div', 'text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-1.5', r[0] + ' · ' + r[1] + ' · ' + (r[2] != null ? r[2] + '점' : '점수 없음') + (r[3] ? ' · ' + fmtD(r[3]) : ''))));
  const mk = (label, val, ph) => { box.append(h('label', 'block text-xs font-bold text-slate-600 mt-4 mb-1', label)); const t = h('textarea', 'w-full p-3 bg-white border border-slate-300 rounded-xl text-sm font-bold'); t.rows = 3; t.placeholder = ph; t.value = val || ''; box.append(t); return t; };
  const extra = mk('추가 학습 내용 (학원에서 따로 진행한 학습)', note.extra, '예) 영작 숙제 5회, 문법 보충 수업 2시간'), comment = mk('선생님 코멘트 (성적표에 함께 인쇄됩니다)', note.comment, '예) 단어 암기가 꾸준히 좋아지고 있어요.');
  const act = h('div', 'flex flex-wrap gap-2 mt-3');
  const saved = () => ({ kind: 'gradenote', month, pid: p.id, name: p.name, extra: extra.value.trim(), comment: comment.value.trim(), rows: rows.slice(-200) });
  act.append(btn('💾 저장 (성적표 보관)', B1, async () => { await mgSave('gn_' + curBranch() + '_' + month + '_' + p.id, saved()); toast('저장되었습니다.'); setTimeout(() => toast(''), 1500); }),
    btn('➕ 점수 직접 추가', B2, async () => {
      const title = (prompt('시험/학습 제목:') || '').trim(); if (!title) return;
      const total = parseInt(prompt('전체 문항 수:', '20'), 10), correct = parseInt(prompt('맞힌 문항 수:'), 10);
      if (!(total > 0) || !(correct >= 0) || correct > total) return alert('문항 수를 올바르게 입력하세요.');
      const now = Date.now();
      await db.collection('history').add({ branchId: curBranch(), studentUid: p.acct ? p.id : null, studentName: p.name, title, kind: 'score', correct, total, score: Math.round(correct / total * 100), ts: now, day: dayOf(now), expireAt: firebase.firestore.Timestamp.fromMillis(now + KEEP) });
      await renderGrade();
    }), btn('🖨 성적표 인쇄', B2, async () => printReport(p, month, rows, st2, saved())));
  box.append(act, h('p', 'text-[11px] text-slate-400 mt-3', '※ 학습 기록은 30일 뒤 자동 삭제됩니다. 오래 보관하려면 달이 끝나기 전에 "저장 (성적표 보관)"을 눌러 두세요. 저장한 성적표는 계속 남습니다.'));
}

/* 대시보드 · 수입지출 종합 */
async function renderDash() {
  const box = $('mg-body'); $('mg-actions').innerHTML = ''; $('mg-actions').append(btn('+ 신규 학생 등록', 'bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2.5 rounded-xl font-bold shadow-md', async () => { MG.group = 'att'; MG.tab = 'att'; MG.openReg = true; await renderManage(); }));
  const [roster, att, counsel, hs, teachers] = await Promise.all([loadRoster(), loadAtt(), mgGet('counsel'), db.collection('history').where('branchId', '==', curBranch()).get(), mgGet('teacher')]);
  const tod = att.filter(d => d.date === today() && d.arrival).length, sc = hs.docs.filter(d => d.data().kind === 'score').length;
  const g = h('div', 'grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4');
  g.append(statCard('🎓', 'bg-blue-50', '재원 학생 수', roster.length + '명', '', 'text-slate-800', () => goTab('student', 'stu')), statCard('✅', 'bg-emerald-50', '오늘 등원한 학생', tod + '명', '', 'text-emerald-600', () => goTab('att', 'att')),
    statCard('📊', 'bg-indigo-50', '등록된 성적 기록', sc + '건', '', 'text-indigo-600', () => goTab('student', 'grade')), statCard('💬', 'bg-amber-50', '누적 상담 일지', counsel.length + '건', '', 'text-amber-600', () => goTab('student', 'counsel')));
  box.append(g);
  const two = h('div', 'grid grid-cols-1 lg:grid-cols-2 gap-4'), p1 = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm p-5'), p2 = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm p-5');
  const hd = (t, l, fn) => { const d = h('div', 'flex items-center justify-between mb-3'); d.append(h('h3', 'font-bold text-slate-800', t), btn(l, 'text-xs font-bold text-indigo-600 hover:underline', fn)); return d; };
  p1.append(hd('최근 등록된 학원생', '전체보기', () => goTab('student', 'stu')));
  if (!roster.length) p1.append(h('p', 'text-xs text-slate-400 py-6 text-center', '등록된 학원생이 없습니다.'));
  roster.slice().sort((a, b) => (b.reg || '').localeCompare(a.reg || '')).slice(0, 5).forEach(s => { const r = h('div', 'py-3 border-t border-slate-100 flex items-center justify-between gap-2'), l = h('div'); l.append(h('div', 'font-semibold text-slate-800 text-sm', s.name + (s.grade ? ' (' + s.grade + (s.className ? ' / ' + s.className : '') + ')' : '')), h('div', 'text-xs text-indigo-600', acadName())); r.append(l); if (s.subject) r.append(pill('과목: ' + s.subject, 'bg-blue-50 text-blue-600')); p1.append(r); });
  p2.append(hd('최근 학생 상담 기록', '상담 관리로 이동', () => goTab('student', 'counsel')));
  if (!counsel.length) p2.append(h('p', 'text-xs text-slate-400 py-6 text-center', '최근 상담 기록이 없습니다.'));
  counsel.sort(byDateDesc).slice(0, 5).forEach(r => { const d = h('div', 'py-3 border-t border-slate-100 flex items-center justify-between gap-2'), l = h('div', 'min-w-0'); l.append(h('div', 'font-semibold text-slate-800 text-sm', r.name + ' (' + r.date + ')'), h('div', 'text-xs text-slate-500 truncate', r.content || '')); d.append(l, pill(r.who || '상담', 'bg-amber-50 text-amber-700')); p2.append(d); });
  two.append(p1, p2); box.append(two);
  const month = today().slice(0, 7), pl = (await mgGet('plan')).filter(r => (r.date || '').startsWith(month)).sort(byDateAsc);
  const p3 = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mt-4'); p3.append(hd('이번 달 학원 일정 · 강사 ' + teachers.filter(t => t.status !== '퇴사').length + '명', '일정 보기', () => goTab('plan', 'plan')));
  if (!pl.length) p3.append(h('p', 'text-xs text-slate-400 py-4 text-center', '등록된 일정이 없습니다.'));
  pl.forEach(r => p3.append(h('div', 'py-2 border-t border-slate-100 text-sm text-slate-700', range2(r).slice(5) + ' · ' + r.title))); box.append(p3);
}
async function renderSum() {
  const box = $('mg-body'), acts = $('mg-actions'), month = MG.month || (MG.month = today().slice(0, 7)); box.innerHTML = ''; acts.innerHTML = '';
  acts.append(btn('+ 기타 수입/지출 내역 추가', 'bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2.5 rounded-xl font-bold shadow-md', async () => editRow('ledger', null, null)));
  const [led, fee, pay] = await Promise.all([mgGet('ledger'), mgGet('fee', ['month', month]), mgGet('pay', ['month', month])]);
  const lm = led.filter(r => (r.date || '').startsWith(month)).sort(byDateDesc), sm = (a, f) => a.filter(f).reduce((x, r) => x + (Number(r.amount) || 0), 0);
  const rows = [['회비 수입 (납부 완료)', sm(fee, d => d.paid)], ['기타 수입', sm(lm, r => r.type === '수입')], ['강사 급여 (지급 완료)', sm(pay, d => d.paid)], ['기타 지출', sm(lm, r => r.type === '지출')]];
  const inc = rows[0][1] + rows[1][1], exp = rows[2][1] + rows[3][1], net = inc - exp;
  const g = h('div', 'grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4');
  g.append(statCard('📈', 'bg-indigo-50', '총 수입', won(inc), '회비 수입 + 기타 수입', 'text-indigo-700'), statCard('📉', 'bg-rose-50', '총 지출', won(exp), '강사 급여 + 기타 경비', 'text-rose-600'), statCard('💰', 'bg-emerald-50', '당기 순이익', won(net), '총 수입 - 총 지출', net >= 0 ? 'text-emerald-600' : 'text-rose-600'));
  box.append(g);
  const bar = h('div', 'bg-white border border-slate-200 rounded-2xl shadow-sm p-3 mb-4 flex flex-wrap items-center gap-3'), mi = inp('month'); mi.value = month; mi.onchange = () => { if (mi.value) { MG.month = mi.value; safe(renderSum); } };
  const all = rows.map(r => [r[0], won(r[1])]).concat([['총 수입', won(inc)], ['총 지출', won(exp)], ['당기 순이익', won(net)]]).concat([['', '']]).concat(lm.map(r => [r.date + ' ' + r.type + ' ' + (r.category || ''), won(r.amount)]));
  bar.append(h('span', 'text-xs font-bold text-slate-600', '조회 월:'), mi, h('span', 'flex-grow text-xs text-slate-400 font-bold', '회비 미납·급여 미지급 금액은 합계에 넣지 않습니다.'), exportBar('수입지출종합_' + month, ['항목', '금액'], all, month + ' 종합'));
  box.append(bar);
  rows.forEach(r => { const d = h('div', 'text-sm font-bold text-slate-700 bg-white border border-slate-200 rounded-xl px-4 py-2.5 mb-2 flex justify-between'); d.append(h('span', '', r[0]), h('span', '', won(r[1]))); box.append(d); });
  box.append(h('h3', 'text-sm font-bold text-indigo-700 mt-4 mb-2', '기타 수입/지출 내역'));
  box.append(mkTable(['날짜', '구분', '항목 / 메모', '금액'], lm.map(r => [r.date, pill(r.type, r.type === '수입' ? 'bg-indigo-50 text-indigo-700' : 'bg-rose-50 text-rose-600'), [r.category, r.memo], won(r.amount)]), i => { const d = h('div', 'inline-flex gap-1'); d.append(lnk('✏️ 수정', 'text-indigo-600', () => editRow('ledger', lm[i], null)), lnk('🗑 삭제', 'text-rose-500', async () => { if (!confirm('삭제할까요?')) return; await mgRef(lm[i].id).delete(); await renderSum(); })); return d; }));
}

/* 학원관리 메인 (F 페이지) */
const GSUB = { dash: '학원생 현황 및 강사, 수업 통계를 한눈에 확인하세요.', student: '학생 정보, 성적, 상담 내용을 통합 관리합니다.', teacher: '강사 인적사항, 급여 정보와 출퇴근 기록을 관리합니다.', klass: '강사별 담당 수업 정보 및 시간표를 관리합니다.', money: '학원의 회비 수납, 강사 급여 정산, 기타 수입/지출 내역을 종합 관리합니다.', plan: '학원 연간 일정과 학교별 시험·방학 일정을 관리합니다.', att: '학원 로고 설정, 학년/학생 등록 및 학생 터치 등원/하원 현황을 관리합니다.', etc: '지점에서 필요한 내용을 자유롭게 기록하세요.' };
async function renderManage() {
  const v = $('view-manage'); v.innerHTML = '';
  if (false) { // 지점 선택은 학원관리 머리글에서
    const bp = h('div', 'mb-4'), sel = h('select', 'p-2 border border-slate-300 rounded-xl text-xs font-bold');
    [{ id: 'main', academyName: '본원' }, ...S.branches].forEach(b => { const o = h('option', '', b.academyName); o.value = b.id; sel.append(o); });
    sel.value = S.viewBranch; sel.onchange = () => { S.viewBranch = sel.value; S.folderId = null; MG.pid = null; MG.cfg = null; safe(renderManage); };
    bp.append(h('span', 'text-xs font-bold text-slate-600 mr-2', '지점 선택'), sel); v.append(bp);
  }
  const g = GROUPS.find(x => x[0] === MG.group) || GROUPS[0]; MG.group = g[0];
  if (!g[2].some(t => t[0] === MG.tab)) MG.tab = g[2][0][0];
  const wrap = h('div', 'flex flex-col lg:flex-row gap-4 items-start'), side = h('aside', 'w-full lg:w-60 flex-shrink-0 bg-white border border-slate-200 text-slate-800 rounded-2xl p-3 shadow-sm');
  const hd = h('div', 'flex items-center gap-3 p-2 pb-3 mb-2 border-b border-slate-100'), lg = h('div', 'w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center text-lg overflow-hidden flex-shrink-0'), logo = logoOf();
  if (logo) { const im = h('img', 'w-full h-full object-cover'); im.src = logo; lg.append(im); } else if (blankLogo()) lg.style.background = SKY; else lg.textContent = '🎓';
  const nm = h('div', 'overflow-hidden'); const nmT = h('div', 'font-bold text-sm leading-tight truncate min-h-[1rem]', acadName()); if (nameBlank()) { nmT.style.background = SKY; nmT.style.borderRadius = '6px'; nmT.style.width = '7rem'; } nm.append(nmT, h('div', 'text-[11px] text-slate-400', '학원통합관리 시스템')); hd.append(lg, nm); side.append(hd);
  GROUPS.forEach(x => { const on = x[0] === MG.group, att = x[0] === 'att'; side.append(btn(x[1], 'w-full text-left px-4 py-3 rounded-xl text-sm mb-1 transition ' + (on ? 'bg-indigo-600 text-white font-bold shadow-md' : att ? 'text-amber-800 font-semibold bg-amber-50 border border-amber-200 mt-3 hover:bg-amber-100' : 'text-slate-700 font-medium hover:bg-slate-100'), () => { MG.group = x[0]; MG.tab = x[2][0][0]; return renderManage(); })); });
  side.append(btn('📎 자료 파일 (CMVOCA F 폴더)', 'w-full text-left px-4 py-3 rounded-xl text-sm font-semibold mt-3 bg-emerald-600 text-white hover:bg-emerald-700', async () => { window.open('/', '_blank'); }));
  const main = h('div', 'flex-grow min-w-0 w-full'), top = h('div', 'flex flex-wrap items-start justify-between gap-3 mb-4'), tl = h('div');
  tl.append(h('h2', 'text-2xl font-black text-slate-800', g[1].replace(/^\S+\s/, '')), h('p', 'text-sm text-slate-500 mt-1', GSUB[g[0]] || '')); const ac = h('div', 'flex flex-wrap items-center gap-2'); ac.id = 'mg-actions'; top.append(tl, ac); main.append(top);
  if (g[2].length > 1) { const tb = h('div', 'flex flex-wrap border-b border-slate-200 mb-4'); g[2].forEach(([id, label]) => tb.append(btn(label, 'px-5 py-3 text-sm whitespace-nowrap transition ' + (MG.tab === id ? 'font-bold text-indigo-600 border-b-2 border-indigo-600' : 'font-medium text-slate-500 hover:text-slate-800'), () => { MG.tab = id; return renderManage(); }))); main.append(tb); }
  const body = h('div'); body.id = 'mg-body'; main.append(body); wrap.append(side, main); v.append(wrap);
  toast('불러오는 중...');
  try {
    if (MG.tab === 'dash') await renderDash(); else if (MG.tab === 'sum') await renderSum(); else if (MG_CRUD[MG.tab]) await renderCrud(MG.tab); else if (MG.tab === 'tclk') await renderTclk(); else if (MG.tab === 'pay') await renderPay();
    else if (MG.tab === 'fee') await renderFee(); else if (MG.tab === 'att') await renderAtt(); else await renderGrade();
  } finally { toast(''); }
}
/* MG-END */
window.AMOPS = {
  MG, GROUPS, ALL: GROUPS.map(g => [g[0], g[1], g[2].slice()]),
  // allow(tab) 이 true 인 탭만 남김 (행정 담당자 권한)
  async render(allow) {
    GROUPS.splice(0, GROUPS.length, ...this.ALL.map(g => [g[0], g[1], g[2].filter(t => !allow || allow(t[0]))]).filter(g => g[2].length));
    MG.cfg = null; await renderManage();
  },
  mgGet, loadRoster
};
})();
