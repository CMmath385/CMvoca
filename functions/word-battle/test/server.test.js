'use strict';
/* 서버 함수 전체 흐름 시험 (가짜 Firestore): 방 만들기 → 참가 → 준비 → 시작 → 답 제출 → 다음 문제 ...
   사용법: node test/server.test.js  (functions 폴더에서 npm install 이 되어 있어야 함) */
const assert = require('assert'); const path = require('path');
const { admin, store } = require('./fakeAdmin');
const adminPath = require.resolve('firebase-admin', { paths: [path.join(__dirname, '..', '..')] });
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: admin };
const fns = require('../../index.js');
const run = (name, uid, data) => fns[name].run({ auth: { uid }, data, rawRequest: {} });
let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('  ✓', n); };

/* ----- 가짜 데이터: 학생 2명, 단어 자료(80개) ----- */
const L = 'abcdefghijklmnopqrstuvwxyz', words = Array.from({ length: 80 }, (_, i) => ({ en: 'w' + L[i % 26] + L[Math.floor(i / 26)] + L[(i * 7) % 26] + 'x', ko: '뜻' + (i + 1), pos: i % 2 ? 'n' : 'v' }));
const put = (p, d) => store.set(p, JSON.parse(JSON.stringify(d)));
put('users/A', { role: 'student', branchId: 'T1', name: '학생A' }); put('users/B', { role: 'student', branchId: 'T2', name: '학생B' });
const F = (id, name, parentId) => ({ type: 'folder', name, parentId: parentId || null, folder: 'B', visible: true, shared: ['T1', 'T2'] });
put('items/cm', F('cm', 'CM내신')); put('items/mid', F('mid', '중등부', 'cm')); put('items/m1', F('m1', '중1', 'mid')); put('items/bk', F('bk', '중1 천재 이상기', 'm1')); put('items/l1', F('l1', '01과', 'bk'));
put('items/w1', { type: 'file', name: '단어', parentId: 'l1', folder: 'B', visible: true, tabId: 'video', shared: ['T1', 'T2'] });
put('pages/w1', { html: '<script>const DATA = ' + JSON.stringify({ title: '테스트 단어', words }) + ';</script>' });

(async () => {
  let roomId, room;
  const sec = () => store.get('wb_secrets/' + roomId), pub = () => store.get('wb_rooms/' + roomId);
  const ans = (idx, right) => { const s = sec().secret.secrets[idx]; return s.kind === 'choice' ? (right ? s.answerIndex : (s.answerIndex + 1) % 4) : (right ? s.accept[0] : 'zzzzzz'); };

  await t('단어 목록 → 방 만들기 → 참가 → 준비 → 시작', async () => {
    const cat = await run('wbListWords', 'A'); assert(cat.grades.length, '단어 목록이 비어 있음');
    const c = await run('wbCreateRoom', 'A', { itemIds: ['w1'], character: '검은이' }); roomId = c.roomId; assert(/^[A-Z0-9]{6}$/.test(c.code));
    const j = await run('wbJoinRoom', 'B', { code: c.code, character: '말티즈' }); assert.strictEqual(j.roomId, roomId);
    await run('wbReady', 'B', { roomId, ready: true });
    const s = await run('wbStart', 'A', { roomId }); assert.strictEqual(s.room.status, 'IN_PROGRESS'); assert.strictEqual(pub().cur.id, 'r1-1');
  });
  await t('첫 문제: 한 명이 정답을 내면 바로 닫히고 정답이 공개됨', async () => {
    const r = await run('wbSubmit', 'A', { roomId, qid: 'r1-1', answer: ans(0, true) });
    assert(r.accepted && r.correct, JSON.stringify(r)); assert.strictEqual(pub().q.closed, true); assert.strictEqual(pub().q.winnerUid, 'A'); assert(pub().reveal);
  });
  await t('다음 문제로 넘어가면 지난 문제의 "답했음" 기록이 남아 있지 않음 (병합 저장 함정)', async () => {
    const q1 = pub(); const at = q1.nextAt; const realNow = Date.now; Date.now = () => at + 10;
    try { await run('wbTick', 'B', { roomId }); } finally { Date.now = realNow; }
    assert.strictEqual(pub().cur.id, 'r1-2', '다음 문제로 넘어가야 함');
    assert.deepStrictEqual(Object.keys(pub().q.answered), [], '새 문제에 이전 답 기록이 남아 있음: ' + JSON.stringify(pub().q.answered));
    assert.deepStrictEqual(Object.keys(sec().room.q.answered), [], '서버 저장본에도 남아 있음');
  });
  await t('두 번째 문제: 오답이면 계속 기다리고, 다른 친구가 정답이면 바로 닫힘', async () => {
    const w = await run('wbSubmit', 'A', { roomId, qid: 'r1-2', answer: ans(1, false) }); assert(w.accepted && !w.correct); assert.strictEqual(pub().q.closed, false);
    const r = await run('wbSubmit', 'B', { roomId, qid: 'r1-2', answer: ans(1, true) }); assert(r.accepted && r.correct); assert.strictEqual(pub().q.closed, true); assert.strictEqual(pub().q.winnerUid, 'B');
  });
  await t('끝까지 한 판: 60문제 (매 문제 정답자 한 명이 나오면 바로 다음으로)', async () => {
    const realNow = Date.now; let clock = pub().nextAt;
    try {
      Date.now = () => clock;
      for (let g = 0; g < 300 && pub().status !== 'COMPLETED'; g++) {
        const p = pub();
        if (p.status === 'IN_PROGRESS' && !p.q.closed) { await run('wbSubmit', p.qIndex % 2 ? 'A' : 'B', { roomId, qid: p.cur.id, answer: ans(p.qIndex, true) }); }
        const n = pub(); clock = Math.max(clock + 1, n.nextAt || (n.q && n.q.deadlineAt) || clock + 1); Date.now = () => clock;
        if (n.status === 'SWAP_TICKET' && !n.swap.used) { /* 안 쓰고 시간 경과 */ }
        await run('wbTick', 'A', { roomId });
      }
    } finally { Date.now = realNow; }
    assert.strictEqual(pub().status, 'COMPLETED'); assert.strictEqual(pub().result.length, 2);
    assert(store.get('wb_stats/' + roomId + '_A') && store.get('wb_stats/' + roomId + '_B'), '성적 기록');
  });
  await t('방장 전체 종료: 참가자 화면(방)이 모두 종료 상태가 되고, 방장이 아니면 거부', async () => {
    const c = await run('wbCreateRoom', 'A', { itemIds: ['w1'], character: '검은이' }); const j = await run('wbJoinRoom', 'B', { code: c.code, character: '말티즈' });
    await run('wbReady', 'B', { roomId: c.roomId, ready: true }); await run('wbStart', 'A', { roomId: c.roomId });
    await assert.rejects(() => run('wbEnd', 'B', { roomId: c.roomId }), /NOT_HOST/);
    const e = await run('wbEnd', 'A', { roomId: c.roomId }); assert.strictEqual(e.room.status, 'CANCELLED');
    assert.strictEqual(store.get('wb_rooms/' + c.roomId).status, 'CANCELLED'); assert.strictEqual(store.get('wb_rooms/' + c.roomId).endedBy, 'host');
    assert(!store.get('wb_stats/' + c.roomId + '_A'), '종료한 경기는 성적을 기록하지 않음');
  });
  console.log(`\n통과 ${pass}개`);
})().catch(e => { console.error('\n실패:', e.message); process.exit(1); });
