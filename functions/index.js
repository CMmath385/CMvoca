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
const RK = require('./word-battle/ranking');
const RW = require('./word-battle/rewards');

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
      let mission = null;
      if (eff) {
        const lastUid = RW.lastPlace(r.result);
        if (lastUid) { // 읽기는 모든 쓰기보다 먼저
          const [st, lm] = await Promise.all([tx.get(db.doc('wb_settings/main')), tx.get(db.doc('wb_missionlast/' + lastUid))]);
          mission = { uid: lastUid, text: RW.pickMission((st.data() || {}).missions, (lm.data() || {}).text, Math.random) };
        }
        r = { ...r, finalized: true };
        if (mission) {
          tx.set(db.doc(`wb_missions/${roomId}_${mission.uid}`), { uid: mission.uid, branchId: r.players[mission.uid].branchId, roomId, text: mission.text, status: 'PROPOSED', createdAt: FV.serverTimestamp() });
          tx.set(db.doc('wb_missionlast/' + mission.uid), { text: mission.text });
        }
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

/* ================= 랭킹·포인트·상품·미션 ================= */
const isStaff = me => me.role === 'sub' || me.role === 'super';
const needStaff = me => { if (!isStaff(me)) throw new HttpsError('permission-denied', '선생님만 쓸 수 있어요.'); };
const needSuper = me => { if (me.role !== 'super') throw new HttpsError('permission-denied', '본원만 쓸 수 있어요.'); };
const ts = v => (v && v.toMillis ? v.toMillis() : null);
const pack = d => { const x = d.data(); Object.keys(x).forEach(k => { if (x[k] && x[k].toMillis) x[k] = x[k].toMillis(); }); return { id: d.id, ...x }; };
const newest = (a, n) => a.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).slice(0, n);
const branchOk = (me, branchId) => me.role === 'super' || branchId === me.branchId;

/** 주간·월간 랭킹: 순위·캐릭터·성적만. 실명은 선생님·본원에게만 */
exports.wbRanking = call(async (d, me) => {
  const period = d.period === 'month' ? 'month' : 'week';
  const from = RK.periodStart(period, Date.now());
  const snap = await db.collection('wb_stats').where('finishedAt', '>=', from).limit(5000).get();
  const list = RK.buildRanking(snap.docs.map(x => x.data()), 50);
  let names = {};
  if (isStaff(me)) {
    const us = await Promise.all(list.map(x => db.doc('users/' + x.uid).get()));
    us.forEach((u, i) => { const v = u.data() || {}; if (me.role === 'super' || v.branchId === me.branchId) names[list[i].uid] = v.name || ''; });
  }
  return { period, from, list: list.map(x => ({ rank: x.rank, character: x.character, total: x.total, wins: x.wins, accuracy: x.accuracy, plays: x.plays, me: x.uid === me.uid, name: names[x.uid] || undefined })) };
});

exports.wbMe = call(async (_d, me) => {
  const [p, r, m] = await Promise.all([
    db.doc('wb_points/' + me.uid).get(),
    db.collection('wb_redeems').where('uid', '==', me.uid).limit(60).get(),
    db.collection('wb_missions').where('uid', '==', me.uid).limit(30).get()]);
  return { balance: (p.data() || {}).balance || 0, redeems: newest(r.docs.map(pack), 20), missions: newest(m.docs.map(pack).filter(x => x.status !== 'PROPOSED' && x.status !== 'REJECTED'), 10) };
});

exports.wbProducts = call(async (_d, me) => {
  const s = await db.collection('wb_products').get();
  return { products: s.docs.map(pack).filter(p => me.role === 'super' || p.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.points || 0) - (b.points || 0)) };
});

/** 교환 신청: 포인트를 먼저 묶어 두고(차감) 지점 선생님이 승인·지급한다. 거절하면 돌려준다 */
exports.wbRedeem = call(async (d, me) => {
  needPlayer(me); if (me.role === 'super') throw new HttpsError('permission-denied', '학생만 교환할 수 있어요.');
  return db.runTransaction(async tx => {
    const [ps, pr] = await Promise.all([tx.get(db.doc('wb_points/' + me.uid)), tx.get(db.doc('wb_products/' + String(d.productId || '_')))]);
    const prod = pr.exists ? pr.data() : null, chk = RW.canRequest(prod, (ps.data() || {}).balance);
    if (!chk.ok) throw new HttpsError('failed-precondition', chk.reason);
    const ref = db.collection('wb_redeems').doc();
    tx.set(ref, { uid: me.uid, branchId: me.branchId, productId: pr.id, name: prod.name, points: chk.cost, won: prod.won || 0, status: 'REQUESTED', month: RW.monthKey(Date.now()), createdAt: FV.serverTimestamp() });
    tx.set(db.doc('wb_points/' + me.uid), { balance: FV.increment(-chk.cost), spent: FV.increment(chk.cost), updatedAt: FV.serverTimestamp() }, { merge: true });
    return { ok: true, id: ref.id };
  });
});

/** 선생님·본원 관리 화면 자료: 교환 신청, 미션 제안, 이번 달 예산 */
exports.wbAdminData = call(async (_d, me) => {
  needStaff(me);
  const month = RW.monthKey(Date.now()), bid = me.role === 'sub' ? me.uid : null;
  let rq = db.collection('wb_redeems').orderBy('createdAt', 'desc').limit(100), mq = db.collection('wb_missions').orderBy('createdAt', 'desc').limit(60);
  if (bid) { rq = db.collection('wb_redeems').where('branchId', '==', bid).limit(200); mq = db.collection('wb_missions').where('branchId', '==', bid).limit(100); }
  const [r, m, b, st] = await Promise.all([rq.get(), mq.get(), bid ? db.doc(`wb_budgets/${bid}_${month}`).get() : db.collection('wb_budgets').where('month', '==', month).get(), db.doc('wb_settings/main').get()]);
  const reds = newest(r.docs.map(pack), 100), miss = newest(m.docs.map(pack), 60);
  const uids = [...new Set([...reds, ...miss].map(x => x.uid))], us = await Promise.all(uids.map(u => db.doc('users/' + u).get())), nm = {};
  us.forEach(u => { nm[u.id] = (u.data() || {}).name || ''; });
  const withName = x => ({ ...x, studentName: nm[x.uid] || '' });
  return { month, redeems: reds.map(withName), missions: miss.map(withName), budgets: bid ? [b.exists ? b.data() : { limit: null, used: 0 }] : b.docs.map(pack), missionList: (st.data() || {}).missions || RW.DEFAULT_MISSIONS };
});

/** 교환 처리: approve(예산 확인) → paid(지급 완료) / reject(포인트 돌려줌) */
exports.wbRedeemDecide = call(async (d, me) => {
  needStaff(me);
  return db.runTransaction(async tx => {
    const ref = db.doc('wb_redeems/' + String(d.id || '_')), s = await tx.get(ref);
    if (!s.exists) throw new HttpsError('not-found', '신청을 찾을 수 없어요.');
    const x = s.data(); if (!branchOk(me, x.branchId)) throw new HttpsError('permission-denied', '다른 지점 학생이에요.');
    const bref = db.doc(`wb_budgets/${x.branchId}_${x.month}`), b = await tx.get(bref);
    if (d.action === 'approve') {
      if (x.status !== 'REQUESTED') throw new HttpsError('failed-precondition', '이미 처리했어요.');
      const c = RW.canApprove(b.data(), x.won || 0); if (!c.ok) throw new HttpsError('failed-precondition', c.reason);
      tx.set(bref, { branchId: x.branchId, month: x.month, used: FV.increment(x.won || 0) }, { merge: true });
      tx.update(ref, { status: 'APPROVED', decidedBy: me.uid, decidedAt: FV.serverTimestamp() });
    } else if (d.action === 'paid') {
      if (x.status !== 'APPROVED') throw new HttpsError('failed-precondition', '먼저 승인해 주세요.');
      tx.update(ref, { status: 'PAID', paidAt: FV.serverTimestamp() });
    } else if (d.action === 'reject') {
      if (!['REQUESTED', 'APPROVED'].includes(x.status)) throw new HttpsError('failed-precondition', '이미 처리했어요.');
      if (x.status === 'APPROVED') tx.set(bref, { used: FV.increment(-(x.won || 0)) }, { merge: true });
      tx.set(db.doc('wb_points/' + x.uid), { balance: FV.increment(x.points), spent: FV.increment(-x.points), updatedAt: FV.serverTimestamp() }, { merge: true });
      tx.update(ref, { status: 'REJECTED', decidedBy: me.uid, decidedAt: FV.serverTimestamp(), note: String(d.note || '').slice(0, 100) });
    } else throw new HttpsError('invalid-argument', '알 수 없는 처리예요.');
    return { ok: true };
  });
});

/** 꼴찌 미션: 선생님이 승인해야 학생에게 보이고, 하고 나면 완료 처리 */
exports.wbMissionDecide = call(async (d, me) => {
  needStaff(me);
  const ref = db.doc('wb_missions/' + String(d.id || '_')), s = await ref.get();
  if (!s.exists) throw new HttpsError('not-found', '미션을 찾을 수 없어요.');
  const x = s.data(); if (!branchOk(me, x.branchId)) throw new HttpsError('permission-denied', '다른 지점 학생이에요.');
  const next = { approve: 'ISSUED', reject: 'REJECTED', done: 'DONE' }[d.action]; if (!next) throw new HttpsError('invalid-argument', '알 수 없는 처리예요.');
  if (next === 'DONE' ? x.status !== 'ISSUED' : x.status !== 'PROPOSED') throw new HttpsError('failed-precondition', '이미 처리했어요.');
  await ref.update({ status: next, decidedBy: me.uid, decidedAt: FV.serverTimestamp(), ...(d.text && next === 'ISSUED' ? { text: String(d.text).slice(0, 120) } : {}) });
  return { ok: true };
});

/* 본원 설정 */
exports.wbSaveProduct = call(async (d, me) => {
  needSuper(me);
  const name = String(d.name || '').trim().slice(0, 40), points = Math.floor(Number(d.points)), won = Math.floor(Number(d.won) || 0);
  if (!name || !(points > 0)) throw new HttpsError('invalid-argument', '이름과 포인트를 확인해 주세요.');
  const ref = d.id ? db.doc('wb_products/' + String(d.id)) : db.collection('wb_products').doc();
  await ref.set({ name, points, won, active: d.active !== false, order: Math.floor(Number(d.order) || 0) }, { merge: true });
  return { ok: true, id: ref.id };
});
exports.wbSetBudget = call(async (d, me) => {
  needSuper(me);
  const month = /^\d{4}-\d{2}$/.test(d.month) ? d.month : RW.monthKey(Date.now()), limit = d.limit === null || d.limit === '' ? null : Math.floor(Number(d.limit));
  if (!d.branchId || (limit !== null && !(limit >= 0))) throw new HttpsError('invalid-argument', '지점과 금액을 확인해 주세요.');
  await db.doc(`wb_budgets/${d.branchId}_${month}`).set({ branchId: String(d.branchId), month, limit }, { merge: true });
  return { ok: true };
});
exports.wbSetMissions = call(async (d, me) => {
  needSuper(me);
  const list = (Array.isArray(d.list) ? d.list : []).map(x => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 40);
  await db.doc('wb_settings/main').set({ missions: list }, { merge: true });
  return { ok: true };
});
