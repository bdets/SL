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
  collection, getDocs, onSnapshot, writeBatch
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

window.CloudSync = {
  connected: false,
  needsSeed: false,
  push(){ /* replaced below once db is ready */ },
  markSeeded(){ /* replaced below */ },
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
      const existing = await getDocs(collection(db, key));
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

  signInAnonymously(auth).catch(e => { console.warn('anonymous sign-in failed:', e.message); fallbackIfNeeded(); });

  onAuthStateChanged(auth, async (user) => {
    if(!user || settled) return;
    try{
      const metaSnap = await getDoc(doc(db, 'sync', 'meta'));
      const alreadySeeded = metaSnap.exists() && metaSnap.data().seeded;

      await Promise.all(RECORD_KEYS.map(key => migrateIfNeeded(key)));

      // Pull whatever already exists in the cloud into localStorage BEFORE the app boots,
      // so the very first render already shows the shared family data (not stale local demo data).
      await Promise.all(RECORD_KEYS.map(async key => {
        const snap = await getDocs(collection(db, key));
        const arr = snap.docs.map(d=>d.data());
        knownState[key] = new Map(arr.map(rec=>[rec.id, JSON.stringify(rec)]));
        localStorage.setItem(key, JSON.stringify(arr));
      }));
      await Promise.all(WHOLE_DOC_KEYS.map(async key => {
        const snap = await getDoc(doc(db, 'sync', key));
        if(snap.exists()) localStorage.setItem(key, snap.data().data);
      }));

      // Live updates from other devices, from this point on.
      RECORD_KEYS.forEach(key => {
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
