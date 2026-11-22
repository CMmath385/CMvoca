'use strict';
/* 시험용 가짜 Firestore (메모리). 실제 Firestore 처럼 동작하도록 주요 규칙을 흉내 낸다:
   - set(data, {merge:true}) 는 지도(map)를 깊게 합친다 (사라진 키는 남는다)  ← 실제와 같은 함정
   - update({field}) 는 그 필드 값을 통째로 바꾼다
   - undefined 값은 오류 (실제 Firestore 도 거부)
   - 트랜잭션: 읽기 후 쓰기 순서를 지켜야 한다 */
const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const store = new Map();
const INC = '__inc__', TS = '__ts__';
const isMap = v => v && typeof v === 'object' && !Array.isArray(v) && !v.__sentinel;
function check(v, path) { if (v === undefined) throw new Error('Cannot use "undefined" as a Firestore value (at ' + path + ')'); if (v && typeof v === 'object' && !v.__sentinel) Object.entries(v).forEach(([k, x]) => check(x, path + '.' + k)); }
function resolve(old, v) { if (v && v.__sentinel === INC) return (old || 0) + v.n; if (v && v.__sentinel === TS) return Date.now(); return v; }
function deepMerge(base, add) { const out = { ...(base || {}) }; for (const [k, v] of Object.entries(add)) out[k] = isMap(v) ? deepMerge(isMap(out[k]) ? out[k] : {}, v) : resolve(out[k], v); return out; }
function applyIncs(data, old) { const o = {}; for (const [k, v] of Object.entries(data)) o[k] = isMap(v) ? applyIncs(v, (old || {})[k]) : resolve((old || {})[k], v); return o; }
class Doc { constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  _snap() { const d = store.get(this.path); return { id: this.id, exists: d !== undefined, data: () => clone(d), ref: this }; }
  async get() { return this._snap(); }
  _set(data, opt) { check(data, this.path); const old = store.get(this.path); store.set(this.path, clone(opt && opt.merge ? deepMerge(old, data) : applyIncs(data, undefined))); }
  _update(data) { const old = store.get(this.path); if (old === undefined) throw new Error('NOT_FOUND ' + this.path); check(data, this.path); const nw = { ...old }; for (const [k, v] of Object.entries(data)) nw[k] = resolve(old[k], v); store.set(this.path, clone(nw)); }
  async set(d, o) { this._set(d, o); } async update(d) { this._update(d); } }
let auto = 0;
class Col { constructor(p) { this.p = p; this.f = []; this.n = null; }
  doc(id) { return new Doc(this.p + '/' + (id || 'auto' + (++auto))); }
  where(a, op, b) { const c = new Col(this.p); c.f = [...this.f, [a, op, b]]; c.n = this.n; return c; }
  limit(n) { const c = new Col(this.p); c.f = this.f; c.n = n; return c; }
  orderBy() { return this; }
  async get() { const docs = []; for (const [path, d] of store) { if (!path.startsWith(this.p + '/') || path.slice(this.p.length + 1).includes('/')) continue; if (this.f.every(([a, op, b]) => op === '==' ? d[a] === b : op === '>=' ? d[a] >= b : true)) docs.push(new Doc(path)._snap()); } return { docs: this.n ? docs.slice(0, this.n) : docs, empty: !docs.length }; } }
const db = { doc: p => new Doc(p), collection: p => new Col(p),
  async runTransaction(fn) { let wrote = false; const tx = { async get(ref) { if (wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.'); return ref.get(); }, set(ref, d, o) { wrote = true; ref._set(d, o); }, update(ref, d) { wrote = true; ref._update(d); } }; return fn(tx); } };
const admin = { initializeApp() {}, firestore: Object.assign(() => db, { FieldValue: { increment: n => ({ __sentinel: INC, n }), serverTimestamp: () => ({ __sentinel: TS }), delete: () => undefined } }) };
module.exports = { admin, store, db };
