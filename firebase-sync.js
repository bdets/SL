/* ==========================================================
   পড়ার খাতা — Cloud sync layer (Firebase Firestore)
   Keeps localStorage mirrored with a shared Firestore project so
   every device (student / tutor / guardian / admin) sees the same
   live data.

   DATA MODEL (v2 — one Firestore document PER RECORD):
   Each local collection (pk_users, pk_tasks, pk_messages,
   pk_notifications, pk_routine, pk_followups, pk_payments) is synced
   as its own Firestore *collection*, one small document per record
   (doc id = the record's own `id`). app.js still calls DB.set(key, wholeArray)
   exactly as before — this file is the only place that knows the array
   gets diffed into individual document writes.

   Why: the old v1 design stored an entire collection as ONE JSON blob in
   ONE document (`sync/{key}`). That has two real problems at real scale
   (hundreds+ of students, ongoing daily use):
     1. Firestore hard-caps a document at 1MB. A single "all tasks" or
        "all notifications" blob for ~1000+ students crosses that within
        weeks, not years — the app would start silently failing to sync.
     2. Every write re-uploaded the ENTIRE array. Two people saving at
        close to the same time could overwrite each other's unrelated
        changes ("last write wins" on the whole collection, not just the
        one record either of them touched) — a real data-loss risk.
   One-doc-per-record removes both: each document stays tiny forever
   regardless of how many students there are, and two people editing two
   different records can never clobber each other.

   pk_subjects is the one exception — it's a small, admin-curated
   className -> [subjects] map that does NOT grow with student count, so
   it stays as the old single-document format; not worth the extra
   complexity.

   MIGRATION: the first time a client with this new code runs against a
   Firestore project that still has old-format `sync/{key}` documents
   (from before this update) and the NEW per-record collection for that
   key is still empty, it copies every record from the old blob into the
   new collection once. The old `sync/{key}` docs are left in place
   afterwards (untouched, harmless) as a backup — they are simply no
   longer read once migration has run.
   ========================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc,
  collection, getDocs, onSnapshot, writeBatch, query, where, limit
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDTU24fMu0xjmSQdb3jQjSBJRbPpmmiSZY",
  authDomain: "porarkhata.firebaseapp.com",
  projectId: "porarkhata",
  storageBucket: "porarkhata.firebasestorage.app",
  messagingSenderId: "66504991509",
  appId: "1:66504991509:web:8fbd910dfd81c03dbe3f1c"
};

// Per-record collections (this is the fix — see header comment above).
const RECORD_KEYS = ['pk_users','pk_tasks','pk_messages','pk_notifications','pk_routine','pk_followups','pk_payments'];
// Small, admin-curated, doesn't grow with student count — keep as one whole doc.
const WHOLE_DOC_KEYS = ['pk_subjects'];

/* SCOPE-AWARE SYNC (added later): pk_tasks / pk_notifications / pk_followups
   are the three collections that grow with day-to-day USE (one record per
   reading assigned, per alert, per follow-up note) rather than with account
   count — at a few hundred active students these are what eventually blow
   past a browser's localStorage quota (~5-10MB) and, more urgently, past
   Firestore's free-tier daily read quota (every full-collection read counts
   a read per document, every time ANY device opens the app).
   So instead of pulling the WHOLE collection to every device like the other
   keys, these three are only synced once we know who's logged in, filtered
   to just that person's own data (student → their own tasks; guardian →
   their children's; tutor → their own students'; admin → unfiltered, same
   as before, since admin genuinely needs the overview — a good next step
   later, not done in this pass). pk_users/pk_routine/pk_payments/pk_messages
   stay full-sync exactly as before: they're bounded by account count (or,
   for messages, deferred for now), not by ongoing daily activity, so they
   were never the actual risk. */
const SCOPABLE_KEYS = ['pk_tasks','pk_notifications','pk_followups'];
const ALWAYS_FULL_KEYS = RECORD_KEYS.filter(k => !SCOPABLE_KEYS.includes(k));

window.CloudSync = {
  connected: false,
  needsSeed: false,
  push(){ /* replaced below once db is ready */ },
  markSeeded(){ /* replaced below */ },
  setScope(){ /* replaced below once db is ready — no-op until then (offline/fallback mode) */ },
  clearScope(){ /* replaced below */ },
  fetchTaskRange(){ return Promise.resolve([]); /* replaced below */ },
  onReady(cb){ this._cb = this._cb || []; this._cb.push(cb); }
};

function fireReady(){
  window.dispatchEvent(new CustomEvent('cloud-ready'));
  (window.CloudSync._cb || []).forEach(cb=>{ try{ cb(); }catch(e){} });
  window.CloudSync._cb = [];
}

// Give Firebase a few seconds; if it doesn't connect, app.js falls back to local-only mode.
const FALLBACK_MS = 4000;
let settled = false;
function fallbackIfNeeded(){
  if(settled) return;
  settled = true;
  window.CloudSync.connected = false;
  fireReady();
}
setTimeout(fallbackIfNeeded, FALLBACK_MS);

try{
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);

  // key -> Map(recordId -> JSON string of that record), representing the last
  // state we know Firestore holds (from our own writes AND from remote
  // onSnapshot updates). Used to diff an incoming whole-array push down to
  // just the records that actually changed, instead of rewriting everything.
  const knownState = {};

  window.CloudSync.push = (key, value) => {
    try{
      if(WHOLE_DOC_KEYS.includes(key)){
        setDoc(doc(db, 'sync', key), { data: JSON.stringify(value), updatedAt: Date.now() })
          .then(()=> window.dispatchEvent(new CustomEvent('cloud-push-ok', { detail:{ key } })))
          .catch(e=>{
            console.warn('cloud push failed for', key, e.message);
            window.dispatchEvent(new CustomEvent('cloud-push-failed', { detail:{ key, message: e.message, code: e.code||null } }));
          });
        return;
      }
      if(!Array.isArray(value)) return;
      pushRecordCollection(key, value);
    }catch(e){ console.warn('cloud push error', e.message); }
  };

  function pushRecordCollection(key, arr){
    const prev = knownState[key] || new Map();
    const next = new Map();
    const upserts = [];
    arr.forEach(rec=>{
      if(!rec || !rec.id) return; // safety guard — skip anything without a stable id
      const json = JSON.stringify(rec);
      next.set(rec.id, json);
      if(prev.get(rec.id) !== json) upserts.push(rec);
    });
    const deletions = [];
    prev.forEach((_json, id)=>{ if(!next.has(id)) deletions.push(id); });
    knownState[key] = next; // update BEFORE the async writes settle so a fast
                             // second push (e.g. two edits in a row) diffs
                             // against this call's result, not stale state.

    // Firestore write batches are capped at 500 operations — chunk defensively
    // (normal usage is 1-2 changed records per save; this only matters for the
    // rare bulk case, e.g. assigning a task to a whole class at once).
    const ops = [
      ...upserts.map(rec=>({type:'set', id:rec.id, data:rec})),
      ...deletions.map(id=>({type:'delete', id}))
    ];
    for(let i=0;i<ops.length;i+=450){
      const batch = writeBatch(db);
      ops.slice(i,i+450).forEach(op=>{
        const ref = doc(db, key, op.id);
        if(op.type==='set') batch.set(ref, op.data); else batch.delete(ref);
      });
      batch.commit()
        .then(()=> window.dispatchEvent(new CustomEvent('cloud-push-ok', { detail:{ key } })))
        .catch(e=>{
          // IMPORTANT: this used to only console.warn — meaning a write could fail
          // silently forever (e.g. expired Firestore test-mode rules, or a
          // permission-denied error) with the topbar still showing 🌐 "connected",
          // because that icon only reflects the initial auth handshake, not
          // whether ongoing writes are actually reaching Firestore. Dispatching
          // this event lets app.js surface a real warning to the user instead.
          console.warn('cloud batch write failed for', key, e.message);
          window.dispatchEvent(new CustomEvent('cloud-push-failed', { detail:{ key, message: e.message, code: e.code||null } }));
        });
    }
  }

  window.CloudSync.markSeeded = () => {
    setDoc(doc(db, 'sync', 'meta'), { seeded:true, seededAt: Date.now() }).catch(()=>{});
  };

  // Photos: already one-doc-per-photo since the previous version — unaffected.
  window.CloudSync.pushPhoto = (taskId, dataUrl) => {
    try{
      setDoc(doc(db, 'photos', taskId), { data: dataUrl, updatedAt: Date.now() })
        .then(()=> window.dispatchEvent(new CustomEvent('cloud-push-ok', { detail:{ key:'photos' } })))
        .catch(e=>{
          console.warn('photo push failed', e.message);
          window.dispatchEvent(new CustomEvent('cloud-push-failed', { detail:{ key:'photos', message: e.message, code: e.code||null } }));
        });
    }catch(e){ console.warn('photo push error', e.message); }
  };
  window.CloudSync.fetchPhoto = async (taskId) => {
    try{
      const snap = await getDoc(doc(db, 'photos', taskId));
      return snap.exists() ? snap.data().data : null;
    }catch(e){ console.warn('photo fetch failed', e.message); return null; }
  };

  // One-time migration: if the new per-record collection is still empty but
  // an old whole-array blob exists at sync/{key}, copy its records over.
  async function migrateIfNeeded(key){
    try{
      // limit(1) — we only need to know IF a doc exists, not read the whole
      // collection just to check .empty (that would itself be an expensive
      // full-collection read on every single app boot, forever).
      const existing = await getDocs(query(collection(db, key), limit(1)));
      if(!existing.empty) return; // already on the new format (or genuinely empty)
      const oldSnap = await getDoc(doc(db, 'sync', key));
      if(!oldSnap.exists()) return; // nothing to migrate
      const arr = JSON.parse(oldSnap.data().data || '[]');
      if(!Array.isArray(arr) || !arr.length) return;
      const ops = arr.filter(rec=>rec && rec.id);
      for(let i=0;i<ops.length;i+=450){
        const batch = writeBatch(db);
        ops.slice(i,i+450).forEach(rec=> batch.set(doc(db, key, rec.id), rec));
        await batch.commit();
      }
      console.info(`পড়ার খাতা: migrated ${ops.length} ${key} record(s) to the new per-document format.`);
    }catch(e){ console.warn('migration check failed for', key, e.message); }
  }

  // Builds the right Firestore query for a scopable key given who's logged
  // in. Returns null when nobody's logged in yet (nothing to sync). Falls
  // back to the full collection for admin / unrecognized roles — same
  // behaviour as before for that case.
  //
  // dateField/minISO (pk_tasks only, for now): bounds the LIVE synced copy
  // to a rolling recent window (default 7 days, by dueDate) instead of
  // that person's entire history forever — this is "ফেজ ২ ধাপ ১". Combined
  // with an equality filter this needs a Firestore composite index; the
  // first real use will fail once with a `failed-precondition` error whose
  // message contains a console link to auto-create it — that's expected,
  // not a bug (see README for the exact field combinations needed).
  function scopedQueryFor(key, scope, dateField, minISO){
    const col = collection(db, key);
    if(!scope || !scope.myId) return null;
    let q;
    if(key === 'pk_notifications'){
      q = query(col, where('userId','==', scope.myId));
    } else if(scope.role === 'student'){
      // pk_tasks and pk_followups both carry studentId + tutorId
      q = query(col, where('studentId','==', scope.myId));
    } else if(scope.role === 'tutor'){
      q = query(col, where('tutorId','==', scope.myId));
    } else if(scope.role === 'guardian'){
      const ids = (scope.childIds||[]).filter(Boolean).slice(0,10); // Firestore 'in' caps the list size; 10 is far beyond any real guardian's child count
      if(!ids.length) return query(col, where('studentId','==','__none__')); // no children on file — match nothing rather than leaking everyone's data
      q = query(col, where('studentId','in', ids));
    } else {
      q = col; // admin / unknown role — unfiltered by person, same as the old behaviour
    }
    if(dateField && minISO) q = query(q, where(dateField, '>=', minISO));
    return q;
  }

  const ROLLING_WINDOW_DAYS = 7;
  function daysAgoISO(n){ const dt = new Date(); dt.setDate(dt.getDate()-n); return dt.toISOString().slice(0,10); }

  let scopeUnsubs = [];
  window.CloudSync.setScope = (scope) => {
    scopeUnsubs.forEach(u=>{ try{ u(); }catch(e){} });
    scopeUnsubs = [];
    if(!scope || !scope.myId) return; // nobody logged in — nothing to sync
    SCOPABLE_KEYS.forEach(async key => {
      // pk_tasks only, for now: bound the always-live copy to tasks whose
      // dueDate hasn't expired more than ROLLING_WINDOW_DAYS days ago.
      // Deliberately dueDate, not assignedDate: a future/near-term dueDate
      // is always >= a past cutoff regardless of when it was assigned, so
      // this alone correctly keeps both "দেওয়া" (given, by assignedDate) and
      // "মিস/বাকি" (by dueDate) relevant — only tasks whose deadline is
      // genuinely stale (>7 days past) drop out of the live window. A
      // completed task rides along on the same dueDate rule; completedDate
      // itself isn't used for windowing (confirmed not needed).
      // pk_notifications/pk_followups stay as Phase-1 (role-scoped, full
      // history) — see the README note on why those were deprioritized.
      const dateField = key === 'pk_tasks' ? 'dueDate' : null;
      const minISO = dateField ? daysAgoISO(ROLLING_WINDOW_DAYS) : null;
      const q = scopedQueryFor(key, scope, dateField, minISO);
      if(!q) return;
      try{
        const snap = await getDocs(q);
        const arr = snap.docs.map(d=>d.data());
        knownState[key] = new Map(arr.map(rec=>[rec.id, JSON.stringify(rec)]));
        localStorage.setItem(key, JSON.stringify(arr));
        window.dispatchEvent(new CustomEvent('cloud-update', { detail:{ key } }));
      }catch(e){
        console.warn('scoped fetch failed for', key, e.message);
        // Query needing a Firestore composite index shows up here the first
        // time — Firestore's error normally includes a console link to
        // create it. Surfacing this as a real warning (instead of silently
        // swallowing it) is exactly what the cloud-push-failed listener in
        // app.js already does.
        window.dispatchEvent(new CustomEvent('cloud-push-failed', { detail:{ key, message: e.message, code: e.code||null } }));
      }
      const unsub = onSnapshot(q, (snap) => {
        const map = knownState[key] || new Map();
        snap.docChanges().forEach(change => {
          if(change.type === 'removed') map.delete(change.doc.id);
          else map.set(change.doc.id, JSON.stringify(change.doc.data()));
        });
        knownState[key] = map;
        const arr = Array.from(map.values()).map(j=>JSON.parse(j));
        const serialized = JSON.stringify(arr);
        if(serialized !== localStorage.getItem(key)){
          localStorage.setItem(key, serialized);
          window.dispatchEvent(new CustomEvent('cloud-update', { detail:{ key } }));
        }
      }, (err)=>{
        console.warn('onSnapshot error', key, err.message);
        window.dispatchEvent(new CustomEvent('cloud-push-failed', { detail:{ key, message: err.message, code: err.code||null } }));
      });
      scopeUnsubs.push(unsub);
    });
  };
  window.CloudSync.clearScope = () => {
    scopeUnsubs.forEach(u=>{ try{ u(); }catch(e){} });
    scopeUnsubs = [];
  };

  // On-demand, ONE-TIME fetch (no live listener — this is intentionally not
  // kept in sync afterwards) for a wider pk_tasks range than the rolling
  // window above, e.g. when someone picks পাক্ষিক/মাসিক/তারিখ অনুসারে in the
  // UI. scope: { role, myId, childIds, studentId? } — pass studentId to
  // narrow to one specific student regardless of role (used by the
  // class/student filter dropdowns already in the UI).
  window.CloudSync.fetchTaskRange = async (scope, dateField, fromISO, toISO) => {
    if(!scope || !scope.myId) return [];
    let narrowedScope = scope;
    if(scope.studentId){
      narrowedScope = { role:'student', myId: scope.studentId }; // reuse the student-shaped branch above regardless of who's actually asking
    }
    let q = scopedQueryFor('pk_tasks', narrowedScope);
    if(!q) return [];
    if(fromISO) q = query(q, where(dateField, '>=', fromISO));
    if(toISO) q = query(q, where(dateField, '<=', toISO));
    const snap = await getDocs(q);
    return snap.docs.map(d=>d.data());
  };

  signInAnonymously(auth).catch(e => { console.warn('anonymous sign-in failed:', e.message); fallbackIfNeeded(); });

  onAuthStateChanged(auth, async (user) => {
    if(!user || settled) return;
    try{
      const metaSnap = await getDoc(doc(db, 'sync', 'meta'));
      const alreadySeeded = metaSnap.exists() && metaSnap.data().seeded;

      await Promise.all(RECORD_KEYS.map(key => migrateIfNeeded(key)));

      // Pull whatever already exists in the cloud into localStorage BEFORE the app boots,
      // so the very first render already shows the shared family data (not stale local demo data).
      // Only the ALWAYS_FULL keys — the scopable ones (pk_tasks/pk_notifications/pk_followups)
      // wait for app.js to tell us who's logged in via setScope(), see above.
      await Promise.all(ALWAYS_FULL_KEYS.map(async key => {
        const snap = await getDocs(collection(db, key));
        const arr = snap.docs.map(d=>d.data());
        knownState[key] = new Map(arr.map(rec=>[rec.id, JSON.stringify(rec)]));
        localStorage.setItem(key, JSON.stringify(arr));
      }));
      await Promise.all(WHOLE_DOC_KEYS.map(async key => {
        const snap = await getDoc(doc(db, 'sync', key));
        if(snap.exists()) localStorage.setItem(key, snap.data().data);
      }));

      // Live updates from other devices, from this point on (ALWAYS_FULL keys only —
      // scoped keys get their own listener inside setScope() once someone's logged in).
      ALWAYS_FULL_KEYS.forEach(key => {
        onSnapshot(collection(db, key), (snap) => {
          const map = knownState[key] || new Map();
          snap.docChanges().forEach(change => {
            if(change.type === 'removed') map.delete(change.doc.id);
            else map.set(change.doc.id, JSON.stringify(change.doc.data()));
          });
          knownState[key] = map;
          const arr = Array.from(map.values()).map(j=>JSON.parse(j));
          const serialized = JSON.stringify(arr);
          if(serialized !== localStorage.getItem(key)){
            localStorage.setItem(key, serialized);
            window.dispatchEvent(new CustomEvent('cloud-update', { detail:{ key } }));
          }
        }, (err)=>{
          console.warn('onSnapshot error', key, err.message);
          window.dispatchEvent(new CustomEvent('cloud-push-failed', { detail:{ key, message: err.message, code: err.code||null } }));
        });
      });
      WHOLE_DOC_KEYS.forEach(key => {
        onSnapshot(doc(db, 'sync', key), (snap) => {
          if(!snap.exists()) return;
          const remote = snap.data().data;
          if(remote !== localStorage.getItem(key)){
            localStorage.setItem(key, remote);
            window.dispatchEvent(new CustomEvent('cloud-update', { detail:{ key } }));
          }
        }, (err)=>{
          console.warn('onSnapshot error', key, err.message);
          window.dispatchEvent(new CustomEvent('cloud-push-failed', { detail:{ key, message: err.message, code: err.code||null } }));
        });
      });

      window.CloudSync.connected = true;
      window.CloudSync.needsSeed = !alreadySeeded;
      settled = true;
      fireReady();
    }catch(e){
      console.warn('cloud bootstrap failed:', e.message);
      fallbackIfNeeded();
    }
  });
}catch(e){
  console.warn('firebase init failed:', e.message);
  fallbackIfNeeded();
}
