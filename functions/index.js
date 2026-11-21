'use strict';
/*
  CMVOCA WORD BATTLE — 서버 함수 (호출형)
  - 모든 쓰기는 여기서만 한다 (Admin SDK). 학생 화면은 wb_rooms 를 읽기만 한다.
  - wb_rooms/{id}   : 학생에게 보이는 방 (정답·남의 오답 여부 가림)
  - wb_secrets/{id} : 서버 전용 { room(전체 상태), secret(정답) } — 규칙이 없어 학생은 읽을 수 없다.
  - wb_codes/{code} : 방 코드 → 방 번호
  기존 users·items·pages 는 읽기만 하고 고치지 않는다.
*/
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const F = require('./word-battle/flow');
const { buildMatch } = require('./word-battle/questions');
const { extractWordData } = require('./word-battle/extract');
const { buildWordCatalog, collectApps, SCOPE } = require('./word-battle/catalog');

const OPTS = { region: 'asia-northeast3', maxInstances: 20 };
const call = fn => onCall(OPTS, async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const me = await loadMe(req.auth.uid);
  try { return await fn(req.data || {}, me); }
  catch (e) { if (e instanceof HttpsError) throw e; console.error(e); throw new HttpsError('internal', '처리 중 오류가 났습니다.'); }
});

async function loadMe(uid) {
  const s = await db.doc('users/' + uid).get();
  if (!s.exists) throw new HttpsError('permission-denied', '등록된 사용자가 아닙니다.');
  const u = s.data();
  if (u.role === 'student' && u.active === false) throw new HttpsError('permission-denied', '사용할 수 없는 계정입니다.');
  return { uid, role: u.role, branchId: u.role === 'sub' ? uid : (u.branchId || null) };
}
const needPlayer = me => { if (me.role === 'sub') throw new HttpsError('permission-denied', '학생 계정(또는 관리자 시험용)만 참여할 수 있습니다.'); };
const fail = r => { throw new HttpsError('failed-precondition', r || 'FAILED'); };

/* ----- 단어 목록 ----- */
async function loadCatalog(me) {
  const snap = await db.collection('items').where('folder', '==', SCOPE.rootFolder).get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return buildWordCatalog({ role: me.role, branchId: me.branchId }, items, SCOPE);
}
exports.wbListWords = call(async (_d, me) => { needPlayer(me); return await loadCatalog(me); });

/* ----- 방 저장 도구 ----- */
const roomRef = id => db.doc('wb_rooms/' + id), secRef = id => db.doc('wb_secrets/' + id);
function writeRoom(tx, id, room, secret) {
  tx.set(roomRef(id), F.publicView(room));
  tx.set(secRef(id), secret ? { room, secret } : { room }, { merge: true });
}
/** 방 하나를 트랜잭션으로 읽어 fn 으로 바꾸고 저장한다. fn → {room?, changed, ret?} 또는 {error} */
async function mutate(roomId, fn) {
  if (!roomId || typeof roomId !== 'string') throw new HttpsError('invalid-argument', '방 번호가 없습니다.');
  return db.runTransaction(async tx => {
    const s = await tx.get(secRef(roomId));
    if (!s.exists) throw new HttpsError('not-found', '방을 찾을 수 없습니다.');
    const { room, secret } = s.data();
    const out = await fn(room, secret, tx);
    if (out.error) throw new HttpsError('failed-precondition', out.error);
    if (out.changed) {
      let r = out.room;
      const eff = F.finalizeEffects(r);
      if (eff) {
        r = { ...r, finalized: true };
        for (const e of eff) {
          tx.set(db.doc(`wb_stats/${roomId}_${e.uid}`), { ...e, roomId, at: FV.serverTimestamp(), finishedAt: Date.now() });
          if (e.points > 0) tx.set(db.doc('wb_points/' + e.uid), { uid: e.uid, branchId: e.branchId, balance: FV.increment(e.points), earned: FV.increment(e.points), updatedAt: FV.serverTimestamp() }, { merge: true });
        }
      }
      writeRoom(tx, roomId, r);
      return { ok: true, room: F.publicView(r), ...(out.ret || {}) };
    }
    return { ok: true, room: F.publicView(room), ...(out.ret || {}) };
  });
}
const lift = (res, ret) => res.ok ? { room: res.room, changed: res.changed !== false, ret } : { error: res.reason };
const inRoom = (room, uid) => { if (!room.players[uid] || room.players[uid].left) throw new HttpsError('permission-denied', '이 방의 참가자가 아닙니다.'); };

/* ----- 방 만들기 ----- */
exports.wbCreateRoom = call(async (d, me) => {
  needPlayer(me);
  const ids = Array.isArray(d.itemIds) ? [...new Set(d.itemIds.map(String))].slice(0, 60) : [];
  if (!ids.length) throw new HttpsError('invalid-argument', '단어를 고르세요.');
  const cat = await loadCatalog(me);
  const allowed = new Set(cat.grades.flatMap(collectApps));
  if (ids.some(i => !allowed.has(i))) throw new HttpsError('permission-denied', '고를 수 없는 단어가 있습니다.');
  const pages = await Promise.all(ids.map(i => db.doc('pages/' + i).get()));
  let words = [], used = [], title = '';
  pages.forEach((p, k) => {
    const x = p.exists ? extractWordData(String((p.data() || {}).html || '')) : { ok: false };
    if (x.ok && x.words.length) { words = words.concat(x.words); used.push(ids[k]); if (!title) title = x.title || ''; }
  });
  if (words.length < 12) throw new HttpsError('failed-precondition', '고른 범위에 단어가 너무 적습니다. 과를 더 골라 주세요.');
  const id = db.collection('wb_rooms').doc().id;
  const match = buildMatch(words, { seed: id });
  let code = null;
  for (let i = 0; i < 8 && !code; i++) {
    const c = F.makeCode(Math.random);
    const ok = await db.runTransaction(async tx => { const s = await tx.get(db.doc('wb_codes/' + c)); if (s.exists && s.data().expiresAt > Date.now()) return false; tx.set(db.doc('wb_codes/' + c), { roomId: id, expiresAt: Date.now() + 2 * 3600 * 1000 }); return true; });
    if (ok) code = c;
  }
  if (!code) throw new HttpsError('resource-exhausted', '잠시 후 다시 시도하세요.');
  const made = F.createRoom({ id, code, hostUid: me.uid, hostBranchId: me.branchId || 'HQ', character: d.character, words: { title: title || '단어 배틀', count: words.length, itemIds: used }, match, now: Date.now() });
  if (!made.ok) fail(made.reason);
  await db.runTransaction(async tx => { writeRoom(tx, id, made.room, made.secret); });
  return { roomId: id, code, room: F.publicView(made.room) };
});

/* ----- 참가·준비·시작·나가기 ----- */
exports.wbJoinRoom = call(async (d, me) => {
  needPlayer(me);
  const code = String(d.code || '').trim().toUpperCase();
  const c = await db.doc('wb_codes/' + code).get();
  if (!c.exists) throw new HttpsError('not-found', '방 코드를 찾을 수 없습니다.');
  const roomId = c.data().roomId;
  const res = await mutate(roomId, (room) => lift(F.joinRoom(room, me.uid, me.branchId || 'HQ', d.character, Date.now())));
  return { roomId, ...res };
});
exports.wbSetCharacter = call(async (d, me) => mutate(d.roomId, room => { inRoom(room, me.uid); return lift(F.chooseCharacter(room, me.uid, d.character)); }));
exports.wbReady = call(async (d, me) => mutate(d.roomId, room => { inRoom(room, me.uid); return lift({ ok: true, room: F.setReady(room, me.uid, !!d.ready).room }); }));
exports.wbLeave = call(async (d, me) => mutate(d.roomId, room => { if (!room.players[me.uid]) return { changed: false }; return lift(F.leaveRoom(room, me.uid, Date.now())); }));
exports.wbStart = call(async (d, me) => mutate(d.roomId, (room, secret) => lift(F.startGame(room, secret, me.uid, Date.now()))));

/* ----- 경기 중 ----- */
exports.wbSubmit = call(async (d, me) => mutate(d.roomId, (room, secret) => {
  inRoom(room, me.uid);
  const r = F.submit(room, secret, me.uid, String(d.qid || ''), d.answer, Date.now());
  // 거부(이미 닫힘 등)여도 시간 종료 정리가 일어났다면 저장한다
  if (!r.ok) return r.changed ? { room: r.room, changed: true, ret: { accepted: false, reason: r.reason } } : { changed: false, ret: { accepted: false, reason: r.reason } };
  return { room: r.room, changed: true, ret: { accepted: true, correct: r.correct } };
}));
/** 화면 시간이 되면 아무나 호출 — 한 번만 반영되고 나머지는 변화 없음 */
exports.wbTick = call(async (d, me) => mutate(d.roomId, (room, secret) => {
  inRoom(room, me.uid);
  const r = F.tick(room, secret, Date.now());
  return r.ok ? { room: r.room, changed: true } : { changed: false };
}));
exports.wbUseSwap = call(async (d, me) => mutate(d.roomId, room => { inRoom(room, me.uid); return lift(F.useSwap(room, me.uid, String(d.targetUid || ''), Date.now())); }));
