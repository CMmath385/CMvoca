'use strict';
/*
  Firestore 규칙 시험 (원장님 컴퓨터에서 실행; 에뮬레이터 필요)
  사용법:  cd functions && npm i -D @firebase/rules-unit-testing firebase
           firebase emulators:exec --only firestore "node word-battle/test/rules.test.js"
  firestore.rules 에는 "기존 규칙 + firestore.wb.rules.txt 추가분"이 합쳐진 전체 규칙이 있어야 한다.
  (이 파일은 규칙에 쓰인 isSuper·isSub·registered 등이 기존 규칙에 이미 있다고 가정한다)
*/
const fs = require('fs'); const assert = require('assert');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
(async () => {
  const env = await initializeTestEnvironment({ projectId: 'wb-rules-test', firestore: { rules: fs.readFileSync(process.env.RULES || '../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
  await env.withSecurityRulesDisabled(async c => {
    const d = c.firestore();
    await d.doc('users/admin').set({ role: 'super' }); await d.doc('users/T1').set({ role: 'sub' }); await d.doc('users/T2').set({ role: 'sub' });
    await d.doc('users/S1').set({ role: 'student', branchId: 'T1' }); await d.doc('users/S2').set({ role: 'student', branchId: 'T2' }); await d.doc('users/S3').set({ role: 'student', branchId: 'T1' });
    await d.doc('wb_rooms/R1').set({ playerUids: ['S1', 'S2'], branchIds: ['T1', 'T2'] });
    await d.doc('wb_secrets/R1').set({ secret: { x: 1 } });
    await d.doc('wb_points/S1').set({ uid: 'S1', branchId: 'T1', balance: 10 });
    await d.doc('wb_stats/R1_S1').set({ uid: 'S1', score: 5 });
  });
  const as = (uid, email) => env.authenticatedContext(uid, email ? { email } : {}).firestore();
  let n = 0; const ok = async (name, p) => { await p; n++; console.log('  ✓', name); };
  await ok('참가자는 방을 읽는다', assertSucceeds(as('S1').doc('wb_rooms/R1').get()));
  await ok('다른 지점 참가자도 같은 방을 읽는다', assertSucceeds(as('S2').doc('wb_rooms/R1').get()));
  await ok('참가하지 않은 학생은 못 읽는다', assertFails(as('S3').doc('wb_rooms/R1').get()));
  await ok('참가 학생의 지점 선생님은 읽는다 (T1,T2)', Promise.all([assertSucceeds(as('T1').doc('wb_rooms/R1').get()), assertSucceeds(as('T2').doc('wb_rooms/R1').get())]));
  await ok('로그아웃 상태는 못 읽는다', assertFails(env.unauthenticatedContext().firestore().doc('wb_rooms/R1').get()));
  await ok('학생은 방을 쓸 수 없다', assertFails(as('S1').doc('wb_rooms/R1').update({ status: 'X' })));
  await ok('학생은 정답(wb_secrets)을 읽을 수 없다', assertFails(as('S1').doc('wb_secrets/R1').get()));
  await ok('본원도 wb_secrets 는 화면에서 못 읽는다', assertFails(as('admin', 'admin@cmacademy.com').doc('wb_secrets/R1').get()));
  await ok('학생은 포인트를 올릴 수 없다', assertFails(as('S1').doc('wb_points/S1').update({ balance: 9999 })));
  await ok('본인 포인트는 읽는다', assertSucceeds(as('S1').doc('wb_points/S1').get()));
  await ok('남의 포인트는 못 읽는다', assertFails(as('S2').doc('wb_points/S1').get()));
  await ok('같은 지점 선생님은 읽고 다른 지점 선생님은 못 읽는다', Promise.all([assertSucceeds(as('T1').doc('wb_points/S1').get()), assertFails(as('T2').doc('wb_points/S1').get())]));
  await ok('등록된 사용자는 누적 성적(랭킹)을 읽는다', assertSucceeds(as('S3').doc('wb_stats/R1_S1').get()));
  await ok('누적 성적은 쓸 수 없다', assertFails(as('S1').doc('wb_stats/R1_S1').set({ score: 999 })));
  await env.cleanup(); console.log(`\n통과 ${n}개`);
})().catch(e => { console.error(e); process.exit(1); });
