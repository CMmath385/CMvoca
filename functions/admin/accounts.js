'use strict';
/*
  학원관리 — 계정 아이디 다시 쓰기
  CMVOCA·학원관리 화면에서 계정을 삭제하면 users 문서만 지워지고 로그인 기록(Firebase Authentication)은 남는다.
  그래서 같은 아이디를 새 비밀번호로 다시 만들 수 없었다.
  amFreeLoginId: 지운 계정(users 문서가 없는 로그인 기록)만 지워서 같은 아이디를 다시 쓸 수 있게 한다.
  - 부를 수 있는 사람: 본원(admin@cmacademy.com)·지점 원장(sub)
  - 지금 쓰는 계정(users 문서가 있는 아이디)과 본원 아이디는 절대 지우지 않는다.
*/
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const DOMAIN = '@cmacademy.com', ADMIN_EMAIL = 'admin' + DOMAIN;
const OPTS = { region: 'asia-northeast3', maxInstances: 5 };

async function isManager(auth) {
  if (!auth) return false;
  if (auth.token && auth.token.email === ADMIN_EMAIL) return true;
  const me = await admin.firestore().doc('users/' + auth.uid).get();
  return me.exists && me.data().role === 'sub';
}

/** 순수 판단: 이 로그인 기록을 지워도 되는가 */
function canFree({ loginId, email, profileExists }) {
  if (!/^[a-z0-9._-]{3,30}$/.test(loginId || '')) return { ok: false, why: 'BAD_ID' };
  if (email === ADMIN_EMAIL) return { ok: false, why: 'PROTECTED' };
  if (profileExists) return { ok: false, why: 'IN_USE' };
  return { ok: true };
}

exports.amFreeLoginId = onCall(OPTS, async req => {
  if (!(await isManager(req.auth))) throw new HttpsError('permission-denied', '원장 계정만 할 수 있습니다.');
  const loginId = String((req.data || {}).loginId || '').trim().toLowerCase(), email = loginId + DOMAIN;
  let user;
  try { user = await admin.auth().getUserByEmail(email); }
  catch (e) { if (e.code === 'auth/user-not-found') return { freed: false, reason: 'NONE' }; throw new HttpsError('internal', '확인하지 못했습니다.'); }
  const prof = await admin.firestore().doc('users/' + user.uid).get();
  const r = canFree({ loginId, email, profileExists: prof.exists });
  if (!r.ok) throw new HttpsError(r.why === 'IN_USE' ? 'already-exists' : 'invalid-argument', r.why);
  await admin.auth().deleteUser(user.uid);
  console.log('amFreeLoginId', loginId, 'by', req.auth.uid);
  return { freed: true };
});

exports._canFree = canFree; // 시험용
