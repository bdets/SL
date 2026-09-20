/* ==========================================================
   পড়ার খাতা — Study Ledger
   Local-first data layer (localStorage) + role-based UI
   ========================================================== */

/* ---------- tiny DB layer ----------
   Caches each key's parsed value so repeat calls (users(), tasks(), ... —
   called dozens of times per render) don't re-run JSON.parse on a
   multi-hundred-KB string every single time once real data volume grows
   (hundreds of students, thousands of tasks). get() returns a shallow copy
   of the cached array/object so callers can push/splice into what they got
   back without corrupting the cache before they explicitly save it — same
   safety as the old "fresh JSON.parse every time" behaviour, just cheaper.
   The cache is invalidated on our own set() and on incoming cloud-update
   events (see the listener near the bottom of this file), so it can never
   silently go stale. */
const DB = {
  _cache: {},
  get(key, def){
    if(!(key in this._cache)){
      try{
        const v = localStorage.getItem(key);
        this._cache[key] = v ? JSON.parse(v) : def;
      }catch(e){ return def; }
    }
    const cached = this._cache[key];
    return Array.isArray(cached) ? cached.slice() : (cached && typeof cached==='object' ? {...cached} : cached);
  },
  set(key, val){
    try{
      localStorage.setItem(key, JSON.stringify(val));
      this._cache[key] = val;
      if(window.CloudSync && window.CloudSync.connected) window.CloudSync.push(key, val);
      return true;
    }catch(e){ showFatalError('ডাটা সেভ করা যাচ্ছে না: ' + e.message); return false; }
  },
  invalidate(key){ delete this._cache[key]; }
};

/* becomes true the moment any Firestore push/read fails after we were already
   connected (see the cloud-push-failed listener near the bottom of this file) —
   drives the ⚠️ sync-badge state and the one-time warning toast, since the
   badge alone (🌐/📴) can't tell the user a write is silently not reaching
   the cloud. */
let cloudSyncHasError = false;

/* surface any JS error directly on the login screen instead of failing silently */
function showFatalError(msg){
  let box = document.getElementById('fatal-banner');
  if(!box){
    box = document.createElement('div');
    box.id = 'fatal-banner';
    box.style.cssText = 'background:#F7E4E1;color:#B5443C;padding:12px 14px;border-radius:10px;margin-bottom:14px;font-size:.85rem;white-space:pre-wrap;text-align:left;direction:ltr';
    const card = document.querySelector('.login-card') || document.body;
    card.insertBefore(box, card.firstChild);
  }
  box.textContent = '⚠️ একটা টেকনিক্যাল সমস্যা হয়েছে (এই লেখাটা স্ক্রিনশট নিয়ে পাঠান):\n' + msg;
}
window.addEventListener('error', (e)=> showFatalError((e.message||'unknown error') + (e.filename? ` [${e.filename}:${e.lineno}]`:'')));

const K = { users:'pk_users', tasks:'pk_tasks', msgs:'pk_messages', notifs:'pk_notifications', syllabus:'pk_syllabus', routine:'pk_routine', followups:'pk_followups', payments:'pk_payments', subjects:'pk_subjects', seeded:'pk_seeded_v2', session:'pk_session_user' };

const users      = () => DB.get(K.users, []);
const saveUsers  = (v) => DB.set(K.users, v);
const tasks      = () => DB.get(K.tasks, []);
const saveTasks  = (v) => DB.set(K.tasks, v);
const msgs       = () => DB.get(K.msgs, []);
const saveMsgs   = (v) => DB.set(K.msgs, v);
const notifs     = () => DB.get(K.notifs, []);
const saveNotifs = (v) => DB.set(K.notifs, v);
const syllabus     = () => DB.get(K.syllabus, []);
const saveSyllabus = (v) => DB.set(K.syllabus, v);
const routine       = () => DB.get(K.routine, []);
const saveRoutine   = (v) => DB.set(K.routine, v);
const followups      = () => DB.get(K.followups, []);
const saveFollowups  = (v) => DB.set(K.followups, v);
const payments      = () => DB.get(K.payments, []);
const savePayments  = (v) => DB.set(K.payments, v);
const subjectList      = () => DB.get(K.subjects, {});
const saveSubjectList  = (v) => DB.set(K.subjects, v);
/* subjects are stored per-শ্রেণি (class): { "৭ম শ্রেণি": ['গণিত', ...], ... }.
   legacy data (a flat array from older versions) is treated as a shared list for every class. */
function getSubjectsForClass(className){
  const map = subjectList();
  if(Array.isArray(map)) return map.length ? map : DEFAULT_SUBJECTS;
  const arr = map[className];
  return (arr && arr.length) ? arr : DEFAULT_SUBJECTS;
}
function saveSubjectsForClass(className, arr){
  const map = subjectList();
  const obj = Array.isArray(map) ? {} : {...map};
  obj[className] = arr;
  saveSubjectList(obj);
}
function subjectSelectHtml(subjectsArr, selectedValue, opts={}){
  const placeholder = `<option value="" ${!selectedValue?'selected':''}>-সিলেক্ট করুন-</option>`;
  const options = subjectsArr.map(s=>`<option ${selectedValue===s?'selected':''}>${s}</option>`).join('');
  return `<select name="${opts.name||'subject'}" ${opts.attrs||'required'}>${placeholder}${options}</select>`;
}

const uid = (p='id') => p + '_' + Math.random().toString(36).slice(2,9);
const todayISO = () => new Date().toISOString().slice(0,10);
const fmtDate = (iso) => { if(!iso) return '—'; try{ return new Date(iso).toLocaleDateString('bn-BD',{year:'numeric',month:'long',day:'numeric'}); }catch(e){ return iso; } };
const fmtDateTime = (iso) => { try{ return new Date(iso).toLocaleString('bn-BD',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return iso; } };
/* date + weekday name, e.g. "২৭ আগস্ট, ২০২৬ (বৃহস্পতিবার)" — used in পড়ার তালিকা so a due-date's day is obvious at a glance */
const fmtDateWithDay = (iso) => { if(!iso) return '—'; try{ const d = new Date(iso); return `${fmtDate(iso)} (${WEEKDAYS[jsDayToOurIndex(d.getDay())]})`; }catch(e){ return iso; } };
const findUser = (id) => users().find(u=>u.id===id);
const usersByRole = (role) => users().filter(u=>u.role===role);

const DEFAULT_SUBJECTS = ['বাংলা','ইংরেজি','গণিত','বিজ্ঞান','সমাজবিজ্ঞান','ধর্ম শিক্ষা','আইসিটি','পদার্থবিজ্ঞান','রসায়ন','জীববিজ্ঞান'];
const ROLE_LABEL = { student:'ছাত্র/ছাত্রী', tutor:'টিউটর', guardian:'অভিভাবক', admin:'প্রশাসক' };
const WEEKDAYS = ['শনিবার','রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার'];
function jsDayToOurIndex(jsDay){ return (jsDay + 1) % 7; } // JS Sun(0)->1(রবিবার), Sat(6)->0(শনিবার)
function nextClassFor(studentId){
  const entries = routine().filter(r=>r.studentId===studentId);
  if(!entries.length) return null;
  const todayIdx = jsDayToOurIndex(new Date().getDay());
  for(let offset=0; offset<7; offset++){
    const idx = (todayIdx+offset)%7;
    const dayName = WEEKDAYS[idx];
    const matches = entries.filter(r=>r.day===dayName);
    if(matches.length) return { day: dayName, offset, entries: matches };
  }
  return null;
}
function relativeDateLabel(dateStr){
  const d = new Date(); const tmw = new Date(d); tmw.setDate(d.getDate()+1);
  const today = todayISO(), yesterday = daysAgoISO(1), tomorrow = tmw.toISOString().slice(0,10);
  if(dateStr===today) return 'আজ';
  if(dateStr===yesterday) return 'গতকাল';
  if(dateStr===tomorrow) return 'আগামীকাল';
  return fmtDateWithDay(dateStr);
}
const CLASSES = ['প্লে','নার্সারি','কেজি','১ম শ্রেণি','২য় শ্রেণি','৩য় শ্রেণি','৪র্থ শ্রেণি','৫ম শ্রেণি','৬ষ্ঠ শ্রেণি','৭ম শ্রেণি','৮ম শ্রেণি','৯ম শ্রেণি','১০ম শ্রেণি','এসএসসি পরীক্ষার্থী','একাদশ','দ্বাদশ','এইচএসসি পরীক্ষার্থী'];
const BN_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
function currentMonthValue(){ return new Date().toISOString().slice(0,7); }
function fmtMonth(ym){ if(!ym) return '—'; const [y,m] = ym.split('-').map(Number); if(!y||!m) return ym; return `${BN_MONTHS[m-1]} ${y.toLocaleString('bn-BD', {useGrouping:false})}`; }
function fmtTaka(n){ return `৳${Number(n||0).toLocaleString('bn-BD')}`; }

/* ---------- seed demo data ---------- */
function seed(force){
  if (!force && DB.get(K.seeded, false)) return;

  const u = [
    {id:'u_admin1', role:'admin', name:'রফিকুল ইসলাম', username:'admin', password:'1234', phone:'01711000001'},
    {id:'u_g1', role:'guardian', name:'সালমা বেগম', username:'guardian', password:'1234', phone:'01711000002', childIds:['u_s1','u_s2']},
    {id:'u_t1', role:'tutor', name:'ইমরান হোসেন (স্যার)', username:'tutor', password:'1234', phone:'01711000003', studentIds:['u_s1','u_s2']},
    {id:'u_t2', role:'tutor', name:'নাজমা আক্তার (আপা)', username:'tutor2', password:'1234', phone:'01711000004', studentIds:['u_s3']},
    {id:'u_s1', role:'student', name:'আরিয়ান হোসেন', nickname:'আরিয়ান', username:'student', password:'1234', className:'৭ম শ্রেণি', tutorId:'u_t1', guardianId:'u_g1'},
    {id:'u_s2', role:'student', name:'ফারিহা আক্তার', nickname:'ফারিহা', username:'student2', password:'1234', className:'৫ম শ্রেণি', tutorId:'u_t1', guardianId:'u_g1'},
    {id:'u_s3', role:'student', name:'তানভীর আহমেদ', nickname:'তানভীর', username:'student3', password:'1234', className:'৯ম শ্রেণি', tutorId:'u_t2', guardianId:null},
  ];
  saveUsers(u);

  const d = (offset) => { const dt = new Date(); dt.setDate(dt.getDate()+offset); return dt.toISOString().slice(0,10); };

  const t = [
    {id:uid('t'), studentId:'u_s1', tutorId:'u_t1', subject:'গণিত', chapter:'অধ্যায় ৫ — ভগ্নাংশ', pageFrom:42, pageTo:47,
     questions:'১. যোগ-বিয়োগের নিয়ম লিখ\n২. পৃ. ৪৫ এর ১-৫ নং অংক কর', type:'পড়া', syllabusId:'syl_math_frac',
     assignedDate:d(-6), dueDate:d(-5), status:'done', completedDate:d(-5), studentNote:'সব অংক করেছি, ৩নং একটু কঠিন ছিল'},
    {id:uid('t'), studentId:'u_s1', tutorId:'u_t1', subject:'ইংরেজি', chapter:'Unit 4 — Tense', pageFrom:30, pageTo:34,
     questions:'Exercise A ও B সম্পূর্ণ কর', type:'হোমওয়ার্ক', syllabusId:'syl_eng_unit4',
     assignedDate:d(-4), dueDate:d(-3), status:'done', completedDate:d(-2), studentNote:'দেরি হয়েছে কিন্তু শেষ করেছি'},
    {id:uid('t'), studentId:'u_s1', tutorId:'u_t1', subject:'বাংলা', chapter:'কবিতা — বিদ্রোহী', pageFrom:12, pageTo:16,
     questions:'মুখস্থ করতে হবে, ভাব-সম্প্রসারণ লিখতে হবে', type:'রিভিশন', syllabusId:'syl_bangla_bidrohi',
     assignedDate:d(-3), dueDate:d(-2), status:'partial', completedDate:d(-2), studentNote:'মুখস্থ হয়েছে, লেখা বাকি'},
    {id:uid('t'), studentId:'u_s1', tutorId:'u_t1', subject:'বিজ্ঞান', chapter:'অধ্যায় ৩ — পদার্থের অবস্থা', pageFrom:20, pageTo:26,
     questions:'সংজ্ঞা ও উদাহরণ লিখ', type:'পড়া', syllabusId:'syl_science_ch3',
     assignedDate:d(-2), dueDate:d(-1), status:'missed'},
    {id:uid('t'), studentId:'u_s1', tutorId:'u_t1', subject:'গণিত', chapter:'অধ্যায় ৬ — শতকরা', pageFrom:50, pageTo:55,
     questions:'পৃ. ৫২ এর ১-৮ নং অংক কর', type:'হোমওয়ার্ক', syllabusId:'syl_math_percent',
     assignedDate:d(0), dueDate:d(1), status:'pending'},
    {id:uid('t'), studentId:'u_s1', tutorId:'u_t1', subject:'ইংরেজি', chapter:'Vocabulary — Chapter 5', pageFrom:36, pageTo:38,
     questions:'১৫টি নতুন শব্দ খাতায় লিখ ও অর্থ শিখ', type:'পড়া', syllabusId:'syl_eng_unit5',
     assignedDate:d(0), dueDate:d(2), status:'pending'},

    {id:uid('t'), studentId:'u_s2', tutorId:'u_t1', subject:'বাংলা', chapter:'গল্প — লাল গরুটা', pageFrom:8, pageTo:12,
     questions:'গল্পের সারাংশ লিখ', type:'পড়া', syllabusId:'syl_bangla_lalgoru',
     assignedDate:d(-5), dueDate:d(-4), status:'done', completedDate:d(-4), studentNote:'পড়েছি, প্রশ্ন-উত্তর করেছি'},
    {id:uid('t'), studentId:'u_s2', tutorId:'u_t1', subject:'গণিত', chapter:'যোগ-বিয়োগ অনুশীলন', pageFrom:14, pageTo:16,
     questions:'পৃ. ১৫ সম্পূর্ণ পাতা', type:'হোমওয়ার্ক', syllabusId:'syl_math_addsub',
     assignedDate:d(-2), dueDate:d(-1), status:'missed'},
    {id:uid('t'), studentId:'u_s2', tutorId:'u_t1', subject:'ইংরেজি', chapter:'Rhymes — Twinkle Twinkle', pageFrom:4, pageTo:5,
     questions:'মুখস্থ কর', type:'রিভিশন', syllabusId:'syl_eng_rhymes', assignedDate:d(0), dueDate:d(1), status:'pending'},

    {id:uid('t'), studentId:'u_s3', tutorId:'u_t2', subject:'পদার্থবিজ্ঞান', chapter:'অধ্যায় ২ — গতি', pageFrom:18, pageTo:24,
     questions:'সূত্রগুলো লিখ ও ৩টি অংক কর', type:'পড়া', syllabusId:'syl_phy_motion',
     assignedDate:d(-3), dueDate:d(-2), status:'done', completedDate:d(-2), studentNote:'সূত্র মুখস্থ, অংক করেছি'},
    {id:uid('t'), studentId:'u_s3', tutorId:'u_t2', subject:'রসায়ন', chapter:'অধ্যায় ১ — পরমাণুর গঠন', pageFrom:6, pageTo:11,
     questions:'পরমাণু মডেল আঁক ও ব্যাখ্যা লিখ', type:'হোমওয়ার্ক', syllabusId:'syl_chem_atom',
     assignedDate:d(-1), dueDate:d(0), status:'pending'},
  ];
  saveTasks(t);

  const sy = [
    {id:'syl_math_frac', className:'৭ম শ্রেণি', subject:'গণিত', title:'অধ্যায় ৫ — ভগ্নাংশ'},
    {id:'syl_math_percent', className:'৭ম শ্রেণি', subject:'গণিত', title:'অধ্যায় ৬ — শতকরা'},
    {id:'syl_math_geo', className:'৭ম শ্রেণি', subject:'গণিত', title:'অধ্যায় ৭ — জ্যামিতি'},
    {id:'syl_math_addsub', className:'৫ম শ্রেণি', subject:'গণিত', title:'যোগ-বিয়োগ অনুশীলন'},
    {id:'syl_eng_unit4', className:'৭ম শ্রেণি', subject:'ইংরেজি', title:'Unit 4 — Tense'},
    {id:'syl_eng_unit5', className:'৭ম শ্রেণি', subject:'ইংরেজি', title:'Vocabulary — Chapter 5'},
    {id:'syl_eng_unit6', className:'৭ম শ্রেণি', subject:'ইংরেজি', title:'Unit 6 — Story'},
    {id:'syl_eng_rhymes', className:'৫ম শ্রেণি', subject:'ইংরেজি', title:'Rhymes — Twinkle Twinkle'},
    {id:'syl_bangla_bidrohi', className:'৭ম শ্রেণি', subject:'বাংলা', title:'কবিতা — বিদ্রোহী'},
    {id:'syl_bangla_lalgoru', className:'৫ম শ্রেণি', subject:'বাংলা', title:'গল্প — লাল গরুটা'},
    {id:'syl_bangla_grammar', className:'৭ম শ্রেণি', subject:'বাংলা', title:'ব্যাকরণ — কারক'},
    {id:'syl_science_ch3', className:'৭ম শ্রেণি', subject:'বিজ্ঞান', title:'অধ্যায় ৩ — পদার্থের অবস্থা'},
    {id:'syl_science_ch4', className:'৭ম শ্রেণি', subject:'বিজ্ঞান', title:'অধ্যায় ৪ — জীবজগৎ'},
    {id:'syl_phy_motion', className:'৯ম শ্রেণি', subject:'পদার্থবিজ্ঞান', title:'অধ্যায় ২ — গতি'},
    {id:'syl_phy_force', className:'৯ম শ্রেণি', subject:'পদার্থবিজ্ঞান', title:'অধ্যায় ৩ — বল'},
    {id:'syl_chem_atom', className:'৯ম শ্রেণি', subject:'রসায়ন', title:'অধ্যায় ১ — পরমাণুর গঠন'},
    {id:'syl_chem_bond', className:'৯ম শ্রেণি', subject:'রসায়ন', title:'অধ্যায় ২ — রাসায়নিক বন্ধন'},
  ];
  saveSyllabus(sy);

  const r = [
    {id:uid('r'), studentId:'u_s1', tutorId:'u_t1', day:'শনিবার', time:'বিকাল ৪:০০', subject:'গণিত', note:'শতকরা অনুশীলন'},
    {id:uid('r'), studentId:'u_s1', tutorId:'u_t1', day:'সোমবার', time:'বিকাল ৪:০০', subject:'ইংরেজি', note:'গ্রামার + ভোকাবুলারি'},
    {id:uid('r'), studentId:'u_s1', tutorId:'u_t1', day:'বুধবার', time:'বিকাল ৪:০০', subject:'বাংলা', note:'কবিতা মুখস্থ যাচাই'},
    {id:uid('r'), studentId:'u_s1', tutorId:'u_t1', day:'শুক্রবার', time:'সকাল ১০:০০', subject:'বিজ্ঞান', note:'সাপ্তাহিক রিভিশন'},
    {id:uid('r'), studentId:'u_s2', tutorId:'u_t1', day:'রবিবার', time:'বিকাল ৫:০০', subject:'বাংলা', note:''},
    {id:uid('r'), studentId:'u_s2', tutorId:'u_t1', day:'মঙ্গলবার', time:'বিকাল ৫:০০', subject:'গণিত', note:''},
    {id:uid('r'), studentId:'u_s3', tutorId:'u_t2', day:'শনিবার', time:'রাত ৮:০০', subject:'পদার্থবিজ্ঞান', note:''},
    {id:uid('r'), studentId:'u_s3', tutorId:'u_t2', day:'সোমবার', time:'রাত ৮:০০', subject:'রসায়ন', note:''},
  ];
  saveRoutine(r);

  const fu = (offset)=>{ const dt=new Date(); dt.setDate(dt.getDate()+offset); return dt.getTime(); };
  const followupSeed = [
    {id:uid('fu'), studentId:'u_s1', tutorId:'u_t1', text:'আরিয়ান গণিতে ভালো করছে, কিন্তু ইংরেজি ভোকাবুলারিতে আরেকটু সময় দিতে হবে। বাসায় প্রতিদিন ১০ মিনিট শব্দ চর্চার পরামর্শ দিলাম।', ts:fu(-6)},
    {id:uid('fu'), studentId:'u_s1', tutorId:'u_t1', text:'বিজ্ঞানের অধ্যায় ৩ মিস হয়েছে, আজকে ক্লাসে আলাদা করে বুঝিয়ে দিয়েছি। আগামী সপ্তাহে পুনরায় যাচাই করব।', ts:fu(-1)},
    {id:uid('fu'), studentId:'u_s2', tutorId:'u_t1', text:'ফারিহা বাংলায় বেশ আগ্রহী, গল্প পড়তে পছন্দ করে। গণিতে যোগ-বিয়োগে বাড়তি অনুশীলন দরকার।', ts:fu(-3)},
    {id:uid('fu'), studentId:'u_s3', tutorId:'u_t2', text:'তানভীর পদার্থবিজ্ঞানে ভালো অগ্রগতি দেখাচ্ছে। রসায়নের অধ্যায় ১ নিয়মিত রিভিশন করা দরকার, পরীক্ষা কাছাকাছি।', ts:fu(-2)},
  ];
  saveFollowups(followupSeed);

  const mo = (offset)=>{ const dt=new Date(); dt.setMonth(dt.getMonth()+offset); return dt.toISOString().slice(0,7); };
  const paymentSeed = [
    {id:uid('pay'), studentId:'u_s1', tutorId:'u_t1', guardianId:'u_g1', month:mo(-2), amount:2500, note:'', receivedDate:d(-55)},
    {id:uid('pay'), studentId:'u_s1', tutorId:'u_t1', guardianId:'u_g1', month:mo(-1), amount:2500, note:'', receivedDate:d(-25)},
    {id:uid('pay'), studentId:'u_s2', tutorId:'u_t1', guardianId:'u_g1', month:mo(-1), amount:2000, note:'একটু দেরিতে দেওয়া হয়েছে', receivedDate:d(-20)},
    {id:uid('pay'), studentId:'u_s3', tutorId:'u_t2', guardianId:null, month:mo(-1), amount:3000, note:'', receivedDate:d(-18)},
  ];
  savePayments(paymentSeed);

  saveSubjectList({});

  const m = [
    {id:uid('m'), from:'u_t1', to:'u_s1', text:'আজকের গণিত পড়াটা মনোযোগ দিয়ে করবে, শতকরা অংশটা পরীক্ষায় আসবে।', ts:Date.now()-1000*60*60*20},
    {id:uid('m'), from:'u_s1', to:'u_t1', text:'জ্বি স্যার, ইনশাআল্লাহ আজকেই শেষ করব।', ts:Date.now()-1000*60*60*19},
    {id:uid('m'), from:'u_g1', to:'u_t1', text:'আরিয়ান বিজ্ঞানের পড়াটা মিস করেছে দেখলাম, একটু খেয়াল রাখবেন স্যার।', ts:Date.now()-1000*60*60*10},
    {id:uid('m'), from:'u_t1', to:'u_g1', text:'জ্বি আপা, আজকে ক্লাসে ওকে আলাদা করে বুঝিয়ে দেব।', ts:Date.now()-1000*60*60*9},
  ];
  saveMsgs(m);

  const n = [
    {id:uid('n'), userId:'u_s1', text:'নতুন পড়া দেওয়া হয়েছে: গণিত — অধ্যায় ৬', ts:Date.now()-1000*60*60*5, read:false, type:'task'},
    {id:uid('n'), userId:'u_g1', text:'আরিয়ানের বিজ্ঞান পড়া আদায় হয়নি (মিস)', ts:Date.now()-1000*60*60*22, read:false, type:'missed'},
    {id:uid('n'), userId:'u_t1', text:'আরিয়ান "গণিত — ভগ্নাংশ" সম্পন্ন করেছে', ts:Date.now()-1000*60*60*30, read:true, type:'done'},
  ];
  saveNotifs(n);

  DB.set(K.seeded, true);
}
// seed() is called conditionally from startApp() below — only when no cloud
// data exists yet (or we're offline), so we never clobber real shared data.

/* ---------- app state ---------- */
const state = { role:'student', view:'dashboard', chatWith:null, revisionRange:'all', tutorClassFilter:'all', tutorStudentFilter:null, editingStudentId:null, editingRoutineId:null, editingTaskId:null, editingSyllabusId:null, syllabusClassFilter:null, editingUserId:null, editingPaymentId:null, paymentStudentFilter:null, paymentChildFilter:null, completingTaskId:null, completingStatus:null, messageRoleFilter:'all', adminUserRoleFilter:'all', messagesMode:'individual', snapshotDate:null,
  openForms:{}, stickyStudentClassName:null, subjectManageClass:null,
  adduserSelectedChildIds:[], adduserChildClassFilter:null, adminUserClassFilter:null,
  stickyAdduserRole:null, stickyAdduserClassName:null,
  studentDashTab:'given', studentDashRange:'week', studentDashCustomFrom:null, studentDashCustomTo:null,
  guardianTaskTab:'given', guardianDashRange:'week', guardianDashCustomFrom:null, guardianDashCustomTo:null,
  tutorTaskTab:'missed', tutorTaskRange:'week', tutorTaskCustomFrom:null, tutorTaskCustomTo:null,
  tutorDashTab:'given', tutorDashRange:'week', tutorDashCustomFrom:null, tutorDashCustomTo:null,
  tutorDashClassFilter:'all', tutorDashStudentFilter:null,
  adminDashTab:'given', adminDashRange:'week', adminDashCustomFrom:null, adminDashCustomTo:null,
  adminDashClassFilter:'all', adminDashStudentFilter:null,
  taskRangeCache:{}, guardianActiveChildId:null };
let lastRenderedView = null;

function currentUser(){
  const id = localStorage.getItem(K.session);
  return id ? findUser(id) : null;
}
function setCurrentUser(id){ localStorage.setItem(K.session, id); }
function clearSession(){ localStorage.removeItem(K.session); }

/* ---------- toast ---------- */
function toast(text, kind=''){
  const zone = document.getElementById('toast-zone');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  zone.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}

/* ==========================================================
   LOGIN SCREEN
   ========================================================== */
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let loginScreenInited = false;
function initLoginScreen(){
  if(loginScreenInited) return; // avoid rebinding listeners on repeated logouts
  loginForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const u = users().find(x=>x.username===username && x.password===password);
    if(!u){ loginError.hidden=false; loginError.textContent = 'ইউজারনেম অথবা পাসওয়ার্ড সঠিক নয়।'; return; }
    loginError.hidden = true;
    doLogin(u);
  });
  loginScreenInited = true;
}

function doLogin(u){
  setCurrentUser(u.id);
  loginForm.reset();
  boot();
}

/* ==========================================================
   NAV CONFIG
   ========================================================== */
const NAV = {
  student:[ ['dashboard','🏠','ড্যাশবোর্ড'], ['revision','📚','রিভিশন লগ'], ['routine','🗓️','রুটিন'], ['messages','💬','বার্তা'], ['profile','👤','প্রোফাইল'] ],
  tutor:[ ['dashboard','🏠','ড্যাশবোর্ড'], ['students','🎓','আমার স্টুডেন্ট'], ['assign','✍️','পড়া দিন'], ['syllabus','📖','সিলেবাস'], ['routine','🗓️','রুটিন'], ['revision','📚','রিভিশন লগ'], ['payments','💰','পেমেন্ট'], ['messages','💬','বার্তা'], ['profile','👤','প্রোফাইল'] ],
  guardian:[ ['dashboard','🏠','ড্যাশবোর্ড'], ['children','🧒','সন্তানেরা'], ['revision','📚','রিভিশন লগ'], ['routine','🗓️','রুটিন'], ['payments','🧾','পেমেন্ট স্লিপ'], ['messages','💬','বার্তা'], ['profile','👤','প্রোফাইল'] ],
  admin:[ ['dashboard','🏠','ড্যাশবোর্ড'], ['users','🗂️','ইউজার ব্যবস্থাপনা'], ['syllabus','📖','সিলেবাস'], ['routine','🗓️','রুটিন'], ['payments','💰','পেমেন্ট'], ['messages','💬','বার্তা'], ['settings','⚙️','সেটিংস'], ['profile','👤','প্রোফাইল'] ],
};
const VIEW_TITLES = {
  dashboard:'ড্যাশবোর্ড', revision:'রিভিশন লগ', messages:'বার্তা', routine:'রুটিন',
  students:'আমার স্টুডেন্ট', assign:'পড়া দিন', children:'সন্তানেরা', users:'ইউজার ব্যবস্থাপনা', syllabus:'সিলেবাস ব্যবস্থাপনা',
  payments:'পেমেন্ট', profile:'প্রোফাইল', settings:'সেটিংস'
};

function buildNav(){
  const user = currentUser();
  const navEl = document.getElementById('nav');
  const mtabEl = document.getElementById('mobile-tabbar');
  navEl.innerHTML = ''; mtabEl.innerHTML = '';
  NAV[user.role].forEach(([key,icon,label])=>{
    const b = document.createElement('button');
    b.className = 'nav-item' + (state.view===key ? ' active':'');
    b.innerHTML = `<span>${icon}</span><span>${label}</span>`;
    b.addEventListener('click', ()=>{ state.view=key; renderView(); });
    navEl.appendChild(b);

    const m = document.createElement('button');
    m.className = 'mtab' + (state.view===key ? ' active':'');
    m.innerHTML = `<span class="ic">${icon}</span><span>${label}</span>`;
    m.addEventListener('click', ()=>{ state.view=key; renderView(); });
    mtabEl.appendChild(m);
  });

  document.getElementById('me-box').innerHTML = `<b>${user.name}</b><span class="pill ${user.role}">${ROLE_LABEL[user.role]}</span>`;
}

/* ==========================================================
   BOOT / ROUTER
   ========================================================== */
function boot(){
  const user = currentUser();
  if(!user){
    // nobody logged in on this device right now — stop syncing the
    // per-user-scoped collections (pk_tasks/pk_notifications/pk_followups);
    // see firebase-sync.js's setScope/clearScope for why.
    if(window.CloudSync && window.CloudSync.clearScope) window.CloudSync.clearScope();
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app').hidden = true;
    initLoginScreen();
    return;
  }
  // tell the sync layer whose data to actually pull — this is what keeps a
  // single student's device from downloading every other family's readings
  // too (see the SCOPABLE_KEYS comment in firebase-sync.js). The scoped
  // fetch/listener resolves asynchronously; when it lands it fires the same
  // 'cloud-update' event a remote change would, which already triggers a
  // re-render below — so the first render here may briefly show nothing for
  // "সকল পড়া"-style blocks until that arrives, same as switching devices.
  if(window.CloudSync && window.CloudSync.setScope){
    window.CloudSync.setScope({ role:user.role, myId:user.id, childIds:user.childIds||[] });
  }
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app').hidden = false;
  state.view = (state.pendingDeepLinkView && NAV[user.role].some(([k])=>k===state.pendingDeepLinkView)) ? state.pendingDeepLinkView : 'dashboard';
  state.pendingDeepLinkView = null;
  state.chatWith = null;
  lastUnreadCount = -1; // reset so a fresh login never plays a sound for pre-existing notifications
  buildNav();
  renderView();
  renderNotifBell();
  updateSoundBadge();
  updatePushBadge();
}

document.getElementById('logout-btn').addEventListener('click', ()=>{ clearSession(); boot(); });
document.getElementById('mobile-logout-btn').addEventListener('click', ()=>{ clearSession(); boot(); });
/* mobile topbar dropdown menu — replaces the sidebar nav on small screens */
function renderTopbarMenu(){
  const user = currentUser(); if(!user) return;
  const panel = document.getElementById('topbar-menu-panel');
  const items = NAV[user.role].map(([key,icon,label])=>
    `<button data-view="${key}">${icon} ${label}</button>`).join('');
  panel.innerHTML = `${items}<hr style="border:none;border-top:1px solid var(--paper-line);margin:6px 0" />
    <button data-view="__logout">🚪 লগআউট</button>`;
}
document.getElementById('topbar-menu-btn').addEventListener('click', (e)=>{
  e.stopPropagation();
  const panel = document.getElementById('topbar-menu-panel');
  renderTopbarMenu();
  panel.hidden = !panel.hidden;
});
document.getElementById('topbar-menu-panel').addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-view]'); if(!btn) return;
  document.getElementById('topbar-menu-panel').hidden = true;
  if(btn.dataset.view === '__logout'){ clearSession(); boot(); return; }
  state.view = btn.dataset.view; renderView();
});
document.addEventListener('click',(e)=>{
  const panel = document.getElementById('topbar-menu-panel');
  if(!panel.hidden && !panel.contains(e.target) && e.target.id!=='topbar-menu-btn') panel.hidden = true;
});

function renderView(){
  // "নতুন যোগ করুন" ফর্মগুলো একই স্ক্রিনে বারবার এন্ট্রি করার সময় খোলা থাকবে,
  // কিন্তু অন্য স্ক্রীনে গেলে (state.view পরিবর্তন হলে) আবার কলাপস হয়ে যাবে।
  if(state.view !== lastRenderedView){
    state.openForms = {};
    state.adduserSelectedChildIds = [];
    lastRenderedView = state.view;
  }
  buildNav();
  document.getElementById('page-title').textContent = VIEW_TITLES[state.view] || '';
  const user = currentUser();
  const view = document.getElementById('view');
  const fn = {
    student:{ dashboard:renderStudentDashboard, revision:renderRevisionLog, routine:renderStudentRoutine, messages:renderMessages, profile:renderProfile },
    tutor:{ dashboard:renderTutorDashboard, students:renderTutorStudents, assign:renderAssignForm, routine:renderTutorRoutine, revision:renderRevisionLog, syllabus:renderSyllabusManager, payments:renderTutorPayments, messages:renderMessages, profile:renderProfile },
    guardian:{ dashboard:renderGuardianDashboard, children:renderGuardianChildren, revision:renderRevisionLog, routine:renderGuardianRoutine, payments:renderGuardianPayments, messages:renderMessages, profile:renderProfile },
    admin:{ dashboard:renderAdminDashboard, users:renderAdminUsers, syllabus:renderSyllabusManager, routine:renderAdminRoutine, payments:renderAdminPayments, messages:renderMessages, profile:renderProfile, settings:renderAdminSettings },
  }[user.role][state.view];
  if(!fn){ view.innerHTML = '<div class="empty">শীঘ্রই আসছে…</div>'; return; }
  view.innerHTML = state.view==='assign' ? fn(user, state.editingTaskId) : fn(user);
}

/* ==========================================================
   HELPERS: task status / progress
   ========================================================== */
function effectiveStatus(t){
  if(t.status==='done' || t.status==='partial' || t.status==='missed') return t.status;
  if(t.dueDate < todayISO()) return 'missed';
  return 'pending';
}
const STATUS_LABEL = { done:'সম্পন্ন', partial:'আংশিক সম্পন্ন', pending:'বাকি আছে', missed:'মিস হয়েছে' };
const STATUS_STAMP = { done:'✓', partial:'½', pending:'…', missed:'✕' };

function studentTasks(sid){ return tasks().filter(t=>t.studentId===sid).sort((a,b)=> b.assignedDate.localeCompare(a.assignedDate)); }
function studentProgress(sid){
  const ts = studentTasks(sid);
  if(!ts.length) return {pct:0, done:0, total:0, missed:0};
  const done = ts.filter(t=>effectiveStatus(t)==='done').length;
  const missed = ts.filter(t=>effectiveStatus(t)==='missed').length;
  return { pct: Math.round((done/ts.length)*100), done, total: ts.length, missed };
}
function progressBarClass(pct){ return pct>=70?'':(pct>=40?'mid':'low'); }

/* ---------- reusable: group a list of students by class ---------- */
function sortByClassOrder(classNames){ return [...classNames].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b)); }
function groupedStudentOptionsHtml(students, selectedId){
  const byClass = {};
  students.forEach(s=>{ (byClass[s.className||'—'] ||= []).push(s); });
  return sortByClassOrder(Object.keys(byClass)).map(c=>
    `<optgroup label="${c}">${byClass[c].map(s=>`<option value="${s.id}" ${s.id===selectedId?'selected':''}>${s.name}</option>`).join('')}</optgroup>`
  ).join('');
}
function groupedStudentButtonsHtml(students, activeId, action){
  const byClass = {};
  students.forEach(s=>{ (byClass[s.className||'—'] ||= []).push(s); });
  return sortByClassOrder(Object.keys(byClass)).map(c=>`
    <div style="font-size:.74rem; font-weight:700; color:var(--text-soft); margin:8px 0 4px">${c}</div>
    <div class="grid cols-4" style="margin-bottom:4px">
      ${byClass[c].map(s=>`<button class="btn-sm ${s.id===activeId?'primary':''}" data-action="${action}" data-id="${s.id}">${s.name}</button>`).join('')}
    </div>`).join('');
}

/* ---------- syllabus progress ---------- */
function syllabusByClassSubject(){
  const map = {}; // className -> subject -> [items]
  syllabus().forEach(it=>{
    (map[it.className] ||= {});
    (map[it.className][it.subject] ||= []).push(it);
  });
  return map;
}
function syllabusForClass(className){
  return syllabus().filter(it=>it.className===className);
}
function syllabusProgress(studentId){
  const student = findUser(studentId);
  const items = student ? syllabus().filter(it=>it.className===student.className) : [];
  const doneIds = new Set(
    tasks().filter(t=>t.studentId===studentId && t.syllabusId && effectiveStatus(t)==='done').map(t=>t.syllabusId)
  );
  const bySubject = {};
  items.forEach(it=>{
    const b = (bySubject[it.subject] ||= {total:0, done:0});
    b.total++;
    if(doneIds.has(it.id)) b.done++;
  });
  return bySubject;
}
function syllabusOverallPct(studentId){
  const bs = syllabusProgress(studentId);
  let total=0, done=0;
  Object.values(bs).forEach(b=>{ total+=b.total; done+=b.done; });
  return total ? Math.round(done/total*100) : 0;
}
function syllabusProgressHtml(studentId, compact){
  const bs = syllabusProgress(studentId);
  const subjects = Object.keys(bs).sort();
  if(!subjects.length) return compact ? '' : '<div class="empty">এই স্টুডেন্টের শ্রেণির জন্য এখনো কোনো সিলেবাস যুক্ত করা হয়নি।</div>';
  return subjects.map(s=>{
    const b = bs[s]; const pct = b.total ? Math.round(b.done/b.total*100) : 0;
    return `<div style="margin-bottom:${compact?'8':'12'}px">
      <div style="display:flex; justify-content:space-between; font-size:.8rem; margin-bottom:3px">
        <span>${s}</span><span style="color:var(--text-soft)">${b.done}/${b.total} (${pct}%)</span>
      </div>
      <div class="progress-bar ${progressBarClass(pct)}"><span style="width:${pct}%"></span></div>
    </div>`;
  }).join('');
}

/* ---------- date-range helpers (for revision log filters) ---------- */
function daysAgoISO(n){ const dt=new Date(); dt.setDate(dt.getDate()-n); return dt.toISOString().slice(0,10); }
const REVISION_RANGES = { week:7, month:30, quarter:90, all:null };

function taskRowHtml(t, opts={}){
  const st = effectiveStatus(t);
  const student = findUser(t.studentId);
  const isCompleting = state.completingTaskId === t.id;
  const summary = `
    <span class="stamp ${st}">${STATUS_STAMP[st]}</span>
    <span class="task-summary-text">
      <span class="subject-chip">${t.subject}</span>
      <b class="task-title-compact">${t.chapter}</b>
      ${t.hasPhoto? `<span class="pill photo" title="ছাত্র ছবি জমা দিয়েছে">📷</span>`:''}
      ${t.hasAssignPhoto? `<span class="pill photo" title="শিক্ষকের দেওয়া ছবি আছে">📎</span>`:''}
      ${t.__count>1? `<span class="pill" title="${t.__count} জন শিক্ষার্থীর জন্য কমন">×${t.__count}</span>`:''}
      ${opts.showStudent? `<span class="pill student">${student? student.name:''}</span>`:''}
      ${t.source==='guardian'? `<span class="pill guardian">অভিভাবক প্রদত্ত</span>`:''}
    </span>
    <span class="task-status-label ${st}">${STATUS_LABEL[st]}${st==='partial' && t.percent?` (${t.percent}%)`:''}</span>
    <span class="chevron">▸</span>
  `;
  const body = `
      <div class="task-meta">ধরন: ${t.type} · দেওয়া হয়েছে: ${fmtDateWithDay(t.assignedDate)} · শেষ তারিখ: ${fmtDateWithDay(t.dueDate)}${t.completedDate? ' · আদায়: '+fmtDateWithDay(t.completedDate):''}${t.pageFrom?' · পৃষ্ঠা: '+t.pageFrom+'-'+t.pageTo:''}</div>
      ${st==='partial' && t.percent? `<div class="progress-bar mid" style="margin-top:4px; max-width:220px"><span style="width:${t.percent}%"></span></div>`:''}
      ${t.questions? `<div class="task-meta">📝 ${t.questions.replace(/\n/g,' · ')}</div>`:''}
      ${t.studentNote? `<div class="task-meta">🗒️ ছাত্রের নোট: ${t.studentNote}</div>`:''}
      ${(t.hasAssignPhoto || t.hasPhoto) ? `<div class="task-actions">
        ${t.hasAssignPhoto? `<button class="btn-sm" data-action="view-photo" data-id="${t.id}_given">📎 শিক্ষকের ছবি</button>`:''}
        ${t.hasPhoto? `<button class="btn-sm" data-action="view-photo" data-id="${t.id}">📷 ছাত্রের ছবি</button>`:''}
      </div>` : ''}
      ${isCompleting ? completionFormHtml(t) : (opts.actions? `<div class="task-actions">${opts.actions(t,st)}</div>`:'')}
  `;
  return `
  <details class="task-row" data-task="${t.id}" ${isCompleting?'open':''}>
    <summary class="task-row-summary">${summary}</summary>
    <div class="task-row-body">${body}</div>
  </details>`;
}

function completionFormHtml(t){
  const isPartial = state.completingStatus==='partial';
  return `<div class="form-card" style="margin-top:10px">
    <form id="complete-form" data-task="${t.id}" data-status="${state.completingStatus}">
      ${isPartial? `<label style="display:block; margin-bottom:10px">কতটুকু পড়া হয়েছে (%)
        <input type="number" name="percent" min="1" max="99" step="1" value="${t.percent||50}" required />
      </label>` : ''}
      <textarea name="note" placeholder="নোট লিখুন (ঐচ্ছিক) — কতটুকু পড়া হলো, কোথায় সমস্যা হয়েছে...">${t.studentNote||''}</textarea>
      <label style="margin-top:10px; display:block; font-size:.82rem; font-weight:600; color:var(--text-soft)">📷 হোমওয়ার্কের ছবি যুক্ত করুন (ঐচ্ছিক)
        <input type="file" name="photo" accept="image/*" capture="environment" style="margin-top:5px" />
      </label>
      <div id="photo-preview-${t.id}" style="margin-top:8px"></div>
      <div style="margin-top:10px; display:flex; gap:8px">
        <button class="btn-primary" type="submit">সংরক্ষণ করুন</button>
        <button class="btn-ghost" type="button" id="complete-form-cancel">বাতিল</button>
      </div>
    </form>
  </div>`;
}

/* ==========================================================
   STUDENT VIEWS
   ========================================================== */
function nextClassCardHtml(studentId){
  const nc = nextClassFor(studentId);
  if(!nc) return '';
  const dayLabel = nc.offset===0?'আজ':(nc.offset===1?'আগামীকাল':nc.day);
  return `<div class="card margin" style="margin-bottom:16px">
    <h3>🗓️ আগামী ক্লাস — ${dayLabel}${nc.offset>0?` (${nc.day})`:''}</h3>
    ${nc.entries.map(e=>`<div class="task-meta">• <b style="color:var(--text)">${e.subject}</b> — ${e.time}${e.note?' — '+e.note:''}</div>`).join('')}
  </div>`;
}
function revisionCheckHtml(studentId){
  const recent = studentTasks(studentId).filter(t=>effectiveStatus(t)==='done').sort((a,b)=>b.completedDate.localeCompare(a.completedDate)).slice(0,3);
  return `<div class="card margin" style="margin-bottom:16px">
    <h3>🔁 রিভিশন-চেক</h3>
    ${recent.length? `
      <div class="stat-label" style="margin-bottom:8px">সম্প্রতি সম্পন্ন হওয়া পড়াগুলো একবার ঝালিয়ে নাও:</div>
      ${recent.map(t=>`<div class="task-meta">• <b style="color:var(--text)">${t.subject}</b> — ${t.chapter}</div>`).join('')}
      <button class="btn-sm" style="margin-top:10px" data-action="goto-revision">📚 পূর্ণ রিভিশন লগ দেখুন</button>`
      : '<div class="empty">এখনো রিভিশনের জন্য কিছু সম্পন্ন হয়নি।</div>'}
  </div>`;
}
function dateGroupedTaskListHtml(studentId){
  const relevant = studentTasks(studentId).filter(t=>effectiveStatus(t)!=='done')
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  if(!relevant.length) return '<div class="empty">সব পড়া সময়মতো শেষ — দারুণ! 🎉</div>';
  const groups = [];
  relevant.forEach(t=>{
    const label = relativeDateLabel(t.dueDate);
    let g = groups.find(g=>g.label===label && g.dueDate===t.dueDate);
    if(!g){ g = {label, dueDate:t.dueDate, items:[]}; groups.push(g); }
    g.items.push(t);
  });
  groups.sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  return groups.map(g=>`
    <div class="section-title" style="margin-top:16px; margin-bottom:6px"><h3 style="font-size:.95rem">${g.label}</h3></div>
    ${g.items.map(t=>taskRowHtml(t,{actions:studentActionButtons})).join('')}
  `).join('');
}

/* full date-grouped task list (pending/missed section + done section), reused across
   student's own task page, and guardian/tutor's per-student focused view */
function manageDoneTaskButtonsHtml(t){
  return `<button class="btn-sm danger" data-action="mark-not-done" data-id="${t.id}">সম্পন্ন হয়নি</button>
    <button class="btn-sm" data-action="remind-revision" data-id="${t.id}">🔔 মনে করিয়ে দিন</button>`;
}
/* merge task rows that are identical except for which student they belong to
   (the normal result of assigning "পুরো শ্রেণি" at once, or several students
   coincidentally having the exact same subject/chapter/dates) into a single
   line with a ×N badge, instead of repeating the same line once per student */
function dedupeCommonTasks(items){
  const groups = []; const index = {};
  items.forEach(t=>{
    const key = [t.subject,t.chapter,t.type,t.assignedDate,t.dueDate,t.questions||'',effectiveStatus(t),!!t.hasPhoto,!!t.hasAssignPhoto].join('|');
    if(index[key]===undefined){ index[key] = groups.length; groups.push({...t, __count:0, __ids:[]}); }
    const g = groups[index[key]];
    g.__count++; g.__ids.push(t.id);
  });
  return groups;
}

function dateGroupedTaskListFromItems(ts, opts={}){
  if(!ts.length) return '<div class="empty">এখনো কোনো পড়া দেওয়া হয়নি।</div>';
  const notDone = ts.filter(t=>effectiveStatus(t)!=='done').sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const done = ts.filter(t=>effectiveStatus(t)==='done').sort((a,b)=>(b.completedDate||'').localeCompare(a.completedDate||''));
  const groupByDate = (list, dateField)=>{
    const groups = [];
    list.forEach(t=>{
      const dv = t[dateField] || t.dueDate;
      let g = groups.find(g=>g.dueDate===dv);
      if(!g){ g = {label: relativeDateLabel(dv), dueDate: dv, items:[]}; groups.push(g); }
      g.items.push(t);
    });
    return groups;
  };
  const pendingGroups = groupByDate(notDone,'dueDate').sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const doneGroups = groupByDate(done,'completedDate').sort((a,b)=>b.dueDate.localeCompare(a.dueDate));
  const pendingActions = opts.pendingActions || (()=>'');
  const doneActions = opts.doneActions || (()=>'');
  const showStudent = !!opts.showStudent;
  return `
  <div class="section-title"><h3>📋 বাকি/মিস হওয়া পড়া (তারিখ অনুযায়ী)</h3></div>
  ${pendingGroups.length ? pendingGroups.map(g=>`
      <div class="section-title" style="margin-top:14px; margin-bottom:6px"><h3 style="font-size:.95rem">${g.label}</h3></div>
      ${g.items.map(t=>taskRowHtml(t,{showStudent, actions:pendingActions})).join('')}
    `).join('') : '<div class="empty">সব পড়া সময়মতো শেষ — দারুণ! 🎉</div>'}
  <div class="section-title" style="margin-top:24px"><h3>✅ সম্পন্ন পড়া (তারিখ অনুযায়ী)</h3></div>
  ${doneGroups.length ? doneGroups.map(g=>`
      <div class="section-title" style="margin-top:14px; margin-bottom:6px"><h3 style="font-size:.95rem">${fmtDateWithDay(g.dueDate)}</h3></div>
      ${g.items.map(t=>taskRowHtml(t,{showStudent, actions:doneActions})).join('')}
    `).join('') : '<div class="empty">এখনো কিছু সম্পন্ন হয়নি।</div>'}
  `;
}
function dateGroupedFullTaskListHtml(studentId, opts={}){
  return dateGroupedTaskListFromItems(studentTasks(studentId), opts);
}

/* class-wide aggregate view: every visible student's tasks merged & deduped by
   content (see dedupeCommonTasks) — no student names, one line per common item */
function classAggregateTaskListHtml(students){
  if(!students.length) return '<div class="empty">এই ফিল্টারে কোনো শিক্ষার্থী নেই।</div>';
  const ids = students.map(s=>s.id);
  const ts = tasks().filter(t=>ids.includes(t.studentId));
  const deduped = dedupeCommonTasks(ts);
  return dateGroupedTaskListFromItems(deduped, {
    showStudent:false,
    pendingActions: (t)=> t.__count>1 ? '' : tutorTaskActionButtons(t),
    doneActions: (t)=> t.__count>1 ? '' : (tutorTaskActionButtons(t) + manageDoneTaskButtonsHtml(t))
  });
}

/* group a student's tasks by the date the teacher assigned them (assignedDate),
   newest first — used by all three student-dashboard tabs below */
function groupByAssignedDate(ts){
  const groups = [];
  // newest assignedDate first — ts arrives in whatever order the caller
  // built it (often several students interleaved), so this was previously
  // ungrouped-and-unsorted, which is the sorting bug being fixed here.
  ts.slice().sort((a,b)=> b.assignedDate.localeCompare(a.assignedDate)).forEach(t=>{
    let g = groups.find(g=>g.date===t.assignedDate);
    if(!g){ g = {date:t.assignedDate, label: fmtDateWithDay(t.assignedDate), items:[]}; groups.push(g); }
    g.items.push(t);
  });
  return groups;
}
/* row-based (not card-based) versions of the same two groupings, for use in
   the guardian's per-child task list — reuses taskRowHtml so guardian-only
   actions (মুছুন/সম্পন্ন হয়নি/মনে করিয়ে দিন) keep working, unlike the
   student-only card view (taskCardHtml) which offers "সম্পন্ন করলাম" buttons
   that aren't appropriate for a guardian to click on the student's behalf. */
function rowGroupedByAssignedDateHtml(ts, opts={}){
  if(!ts.length) return '<div class="empty">এখনো কোনো পড়া দেওয়া হয়নি।</div>';
  return groupByAssignedDate(ts).map(g=>`
    <div class="section-title" style="margin-top:16px; margin-bottom:6px"><h3 style="font-size:.95rem">${g.label}</h3></div>
    ${g.items.map(t=>taskRowHtml(t,opts)).join('')}
  `).join('');
}
function rowGroupedByDueDateHtml(ts, opts={}){
  if(!ts.length) return '<div class="empty">এখনো কোনো পড়া দেওয়া হয়নি।</div>';
  const groups = [];
  ts.slice().sort((a,b)=>b.dueDate.localeCompare(a.dueDate)).forEach(t=>{
    let g = groups.find(g=>g.date===t.dueDate);
    if(!g){ g = {date:t.dueDate, label: fmtDateWithDay(t.dueDate), items:[]}; groups.push(g); }
    g.items.push(t);
  });
  return groups.map(g=>`
    <div class="section-title" style="margin-top:16px; margin-bottom:6px"><h3 style="font-size:.95rem">${g.label}</h3></div>
    ${g.items.map(t=>taskRowHtml(t,opts)).join('')}
  `).join('');
}
function taskCardHtml(t){
  const st = effectiveStatus(t);
  const isCompleting = state.completingTaskId === t.id;
  return `
  <div class="task-card">
    <div class="task-card-top">
      <span class="stamp ${st}">${STATUS_STAMP[st]}</span>
      <span class="subject-chip">${t.subject}</span>
      ${t.hasAssignPhoto? `<span class="pill photo" title="শিক্ষকের দেওয়া ছবি আছে">📎</span>`:''}
      ${t.hasPhoto? `<span class="pill photo" title="ছবি জমা দেওয়া হয়েছে">📷</span>`:''}
    </div>
    <div class="task-card-title">${t.chapter}</div>
    <div class="task-card-meta">শেষ তারিখ: ${fmtDate(t.dueDate)}</div>
    <span class="task-status-label ${st}">${STATUS_LABEL[st]}${st==='partial' && t.percent?` (${t.percent}%)`:''}</span>
    ${st==='partial' && t.percent? `<div class="progress-bar mid"><span style="width:${t.percent}%"></span></div>`:''}
    ${(t.hasAssignPhoto || t.hasPhoto)? `<div class="task-card-actions">
        ${t.hasAssignPhoto? `<button class="btn-sm" data-action="view-photo" data-id="${t.id}_given">📎 শিক্ষকের ছবি</button>`:''}
        ${t.hasPhoto? `<button class="btn-sm" data-action="view-photo" data-id="${t.id}">📷 আমার ছবি</button>`:''}
      </div>`:''}
    ${isCompleting ? completionFormHtml(t) : (st!=='done' && !t.__readOnly ? `<div class="task-card-actions">${studentActionButtons(t,st)}</div>` : '')}
  </div>`;
}
function studentGivenCardsHtml(ts){
  if(!ts.length) return '<div class="empty">এই সময়সীমায় কোনো পড়া নেই।</div>';
  return groupByAssignedDate(ts).map(g=>`
    <div class="section-title" style="margin-top:16px; margin-bottom:8px"><h3 style="font-size:.95rem">${g.label}</h3></div>
    <div class="task-card-grid">${g.items.map(taskCardHtml).join('')}</div>
  `).join('');
}
/* "এই তারিখে যে যে পড়া নেওয়া হবে" — every task grouped by its শেষ তারিখ/dueDate
   (earliest due date first), so সম্পন্ন/বাকি/মিস — সব একসাথে, তারিখ ধরে দেখা যায় */
function studentByDueDateCardsHtml(ts){
  ts = ts.slice().sort((a,b)=>b.dueDate.localeCompare(a.dueDate)); // newest due date first
  if(!ts.length) return '<div class="empty">এই সময়সীমায় কোনো পড়া নেই।</div>';
  const groups = [];
  ts.forEach(t=>{
    let g = groups.find(g=>g.date===t.dueDate);
    if(!g){ g = {date:t.dueDate, label: fmtDateWithDay(t.dueDate), items:[]}; groups.push(g); }
    g.items.push(t);
  });
  return groups.map(g=>`
    <div class="section-title" style="margin-top:16px; margin-bottom:8px"><h3 style="font-size:.95rem">${g.label}</h3></div>
    <div class="task-card-grid">${g.items.map(taskCardHtml).join('')}</div>
  `).join('');
}

function renderStudentDashboard(user){
  const prog = studentProgress(user.id);
  const pending = studentTasks(user.id).filter(t=>effectiveStatus(t)==='pending');
  const missed = studentTasks(user.id).filter(t=>effectiveStatus(t)==='missed');
  const tab = state.studentDashTab==='due' ? 'due' : 'given';
  const range = state.studentDashRange || 'week';
  const tabs = [
    ['given','📚 শিক্ষকের দেওয়া পড়া'],
    ['due','📅 পড়া আদায়ের শেষ তারিখ অনুযায়ী'],
  ];
  let tabContent;
  if(range==='week'){
    tabContent = tab==='due' ? studentByDueDateCardsHtml(studentTasks(user.id)) : studentGivenCardsHtml(studentTasks(user.id));
  } else {
    const bounds = rangeToBounds(range, state.studentDashCustomFrom, state.studentDashCustomTo);
    const cacheKey = `student-dash:${user.id}:${JSON.stringify(bounds)}`;
    const cached = state.taskRangeCache[cacheKey];
    if(!cached){
      tabContent = `<div class="empty">লোড হচ্ছে…</div>`;
    } else {
      const marked = markOutOfWindow(cached);
      tabContent = tab==='due' ? studentByDueDateCardsHtml(marked) : studentGivenCardsHtml(marked);
    }
  }
  return `
  <div class="grid cols-4">
    <div class="card margin"><h3>মোট পড়া</h3><div class="stat-num">${prog.total}</div><div class="stat-label">এখন পর্যন্ত দেওয়া</div></div>
    <div class="card margin"><h3>আদায়ের হার</h3><div class="stat-num">${prog.pct}%</div>
      <div class="progress-bar ${progressBarClass(prog.pct)}" style="margin-top:6px"><span style="width:${prog.pct}%"></span></div></div>
    <div class="card margin"><h3>বাকি আছে</h3><div class="stat-num">${pending.length}</div><div class="stat-label">এখনো শেষ হয়নি</div></div>
    <div class="card margin"><h3>মিস হয়েছে</h3><div class="stat-num" style="color:var(--danger)">${missed.length}</div><div class="stat-label">সময়মতো হয়নি</div></div>
  </div>
  ${nextClassCardHtml(user.id)}
  ${revisionCheckHtml(user.id)}
  <div class="section-title"><h3>সিলেবাস অগ্রগতি</h3></div>
  <div class="card margin">${syllabusProgressHtml(user.id)}</div>
  <div class="grid cols-2" style="margin-top:20px; margin-bottom:12px">
    ${tabs.map(([k,l])=>`<button class="btn-sm ${tab===k?'primary':''}" data-action="set-student-dash-tab" data-id="${k}">${l}</button>`).join('')}
  </div>
  <div class="form-grid" style="margin-bottom:14px">
    <label>সময়কাল
      <select data-role="student-dash-range">
        <option value="week" ${range==='week'?'selected':''}>সাপ্তাহিক</option>
        <option value="fortnight" ${range==='fortnight'?'selected':''}>পাক্ষিক</option>
        <option value="month" ${range==='month'?'selected':''}>মাসিক</option>
        <option value="custom" ${range==='custom'?'selected':''}>তারিখ অনুসারে</option>
      </select>
    </label>
    ${range==='custom' ? `
    <label>শুরুর তারিখ
      <input type="date" data-role="student-dash-custom-from" value="${state.studentDashCustomFrom||''}" />
    </label>
    <label>শেষ তারিখ
      <input type="date" data-role="student-dash-custom-to" value="${state.studentDashCustomTo||''}" />
    </label>` : ''}
  </div>
  ${tabContent}
  `;
}

function studentActionButtons(t, st){
  if(st==='done') return '';
  return `
    <button class="btn-sm success" data-action="start-complete" data-id="${t.id}" data-status="done">✅ সম্পন্ন করলাম</button>
    <button class="btn-sm" data-action="start-complete" data-id="${t.id}" data-status="partial">🟡 আংশিক হয়েছে</button>
  `;
}

/* actually saves a student's completion (called after the inline completion form is submitted) */
function completeTask(taskId, status, note, photoDataUrl, percent){
  const user = currentUser();
  const all = tasks();
  const idx = all.findIndex(t=>t.id===taskId);
  if(idx===-1) return;
  all[idx].status = status;
  all[idx].completedDate = todayISO();
  if(status==='partial' && percent) all[idx].percent = Math.max(1, Math.min(99, percent));
  if(status==='done') delete all[idx].percent;
  if(note) all[idx].studentNote = note;
  if(photoDataUrl){ all[idx].hasPhoto = true; savePhotoForTask(taskId, photoDataUrl); }
  saveTasks(all);
  const t = all[idx];
  const doneLabel = status==='done' ? 'সম্পন্ন করেছে' : `আংশিক সম্পন্ন করেছে (${t.percent||0}%)`;
  if(t.tutorId) addNotification(t.tutorId, `${user.name} "${t.subject} — ${t.chapter}" ${doneLabel}${photoDataUrl?' (ছবিসহ)':''}`, 'done');
  const student = findUser(t.studentId);
  if(student?.guardianId) addNotification(student.guardianId, `${student.name} "${t.subject}" পড়া ${status==='done'?'সম্পন্ন করেছে ✅':`আংশিক করেছে (${t.percent||0}%)`}`, 'done');
  toast('আপডেট হয়েছে, চমৎকার! 🎉','success');
  state.completingTaskId = null;
  state.completingStatus = null;
  renderView(); renderNotifBell();
}

/* ---------- photo attachments ----------
   Photos are kept OUT of the normal DB.set()/CloudSync.push() whole-array sync
   (which would blow past Firestore's 1MB-per-document limit after a few
   photos). Instead each photo lives in its own tiny localStorage entry and,
   when online, its own tiny Firestore document (see firebase-sync.js). */
function getPhotoMap(){ try{ return JSON.parse(localStorage.getItem('pk_task_photos')||'{}'); }catch(e){ return {}; } }
function setPhotoMapLocal(map){ try{ localStorage.setItem('pk_task_photos', JSON.stringify(map)); }catch(e){ showFatalError('ছবি সেভ করা যাচ্ছে না: ' + e.message); } }
function getPhotoForTask(taskId){ return getPhotoMap()[taskId] || null; }
function savePhotoForTask(taskId, dataUrl){
  const map = getPhotoMap();
  map[taskId] = dataUrl;
  setPhotoMapLocal(map);
  if(window.CloudSync && window.CloudSync.connected && window.CloudSync.pushPhoto) window.CloudSync.pushPhoto(taskId, dataUrl);
}
async function loadAndShowPhoto(taskId, btnEl){
  let dataUrl = getPhotoForTask(taskId);
  if(!dataUrl && window.CloudSync && window.CloudSync.connected && window.CloudSync.fetchPhoto){
    const originalText = btnEl.textContent;
    btnEl.textContent = 'লোড হচ্ছে...'; btnEl.disabled = true;
    dataUrl = await window.CloudSync.fetchPhoto(taskId);
    btnEl.textContent = originalText; btnEl.disabled = false;
    if(dataUrl){ const map = getPhotoMap(); map[taskId] = dataUrl; setPhotoMapLocal(map); }
  }
  if(!dataUrl){ toast('ছবি পাওয়া যায়নি — হয়তো এখনো সিঙ্ক হয়নি।','warn'); return; }
  showPhotoModal(dataUrl);
}
function showPhotoModal(dataUrl){
  let modal = document.getElementById('photo-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'photo-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(20,18,15,.82);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
    modal.addEventListener('click', ()=> modal.remove());
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5)" />`;
}
/* resize+recompress an image file client-side so it stays well under Firestore's
   1MB document limit (~800px longest side, JPEG quality 0.6 → usually 50-200KB). */
function compressImageFile(file, maxDim=800, quality=0.6){
  return new Promise((resolve)=>{
    if(!file || !file.type || !file.type.startsWith('image/')){ resolve(null); return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w>maxDim || h>maxDim){
          if(w>h){ h = Math.round(h*maxDim/w); w = maxDim; } else { w = Math.round(w*maxDim/h); h = maxDim; }
        }
        try{
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        }catch(e){ resolve(null); }
      };
      img.onerror = ()=> resolve(null);
      img.src = reader.result;
    };
    reader.onerror = ()=> resolve(null);
    reader.readAsDataURL(file);
  });
}

/* ---------- ROUTINE (shared table renderer) ---------- */
function routineDisplayTableHtml(studentId, manage){
  const items = routine().filter(r=>r.studentId===studentId);
  if(!items.length) return '<div class="empty">এখনো কোনো রুটিন যোগ করা হয়নি।</div>';
  const order = (d)=>WEEKDAYS.indexOf(d);
  const grouped = [];
  items.forEach(r=>{
    let g = grouped.find(g=>g.day===r.day && g.time===r.time);
    if(!g){ g = {day:r.day, time:r.time, entries:[]}; grouped.push(g); }
    g.entries.push(r);
  });
  grouped.sort((a,b)=> order(a.day)-order(b.day) || a.time.localeCompare(b.time));
  const rows = grouped.map(g=>{
    const subjectsText = g.entries.map(e=>`
      <span class="routine-entry"${manage?' data-tap-reveal':''}>
        <span class="subject-chip">${e.subject}</span>${e.note?` <span class="routine-note">(${e.note})</span>`:''}
        ${manage?`<span class="reveal-actions">
            <button class="btn-sm" data-action="edit-routine" data-id="${e.id}" title="এডিট">✏️</button>
            <button class="btn-sm danger" data-action="delete-routine" data-id="${e.id}" title="মুছুন">🗑️</button>
          </span>`:''}
      </span>`).join('');
    return `<div class="routine-row">
      <div class="routine-daytime"><b>${g.day}</b><span class="routine-time">${g.time}</span></div>
      <div class="routine-subjects">${subjectsText}</div>
    </div>`;
  }).join('');
  return `<div class="routine-table">${rows}${manage?'<div class="tap-reveal-hint">👆 কোনো বিষয়ে চাপলে এডিট/মুছার অপশন দেখাবে</div>':''}</div>`;
}

function renderStudentRoutine(user){
  return `<div class="section-title"><h3>সাপ্তাহিক রুটিন</h3></div>${routineDisplayTableHtml(user.id, false)}`;
}

function renderGuardianRoutine(user, forcedStudentId){
  const kids = (user.childIds||[]).map(findUser).filter(Boolean);
  const active = forcedStudentId || kids[0]?.id;
  if(!active) return '<div class="empty">কোনো সন্তান লিংক করা নেই।</div>';
  return `
  <div class="grid cols-3" style="margin-bottom:14px">
    ${kids.map(k=>`<button class="btn-sm ${k.id===active?'primary':''}" data-action="pick-guardian-routine" data-id="${k.id}">${k.name}</button>`).join('')}
  </div>
  ${routineDisplayTableHtml(active, false)}`;
}

/* shared routine editor used by both tutor (own students) and admin (all students) —
   supports adding either to one student or to a whole class at once */
function renderRoutineEditor(students, active, opts){
  const { pickAction } = opts;
  if(!active) return '<div class="empty">কোনো স্টুডেন্ট যুক্ত নেই।</div>';
  const editing = state.editingRoutineId ? routine().find(r=>r.id===state.editingRoutineId) : null;
  const defaultDay = editing ? editing.day : (state.stickyRoutineDay || WEEKDAYS[0]);
  const defaultTime = editing ? editing.time : (state.stickyRoutineTime || '');
  const classes = [...new Set(students.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  const stickyTarget = state.stickyRoutineTarget || 'student';
  const stickyClassName = (state.stickyRoutineClassName && classes.includes(state.stickyRoutineClassName)) ? state.stickyRoutineClassName : classes[0];
  const activeStudent = findUser(active);
  const pickerClassName = activeStudent?.className && classes.includes(activeStudent.className) ? activeStudent.className : classes[0];
  const studentsInPickerClass = students.filter(s=>s.className===pickerClassName);
  const routineClassName = editing ? findUser(editing.studentId)?.className : (stickyTarget==='class' ? stickyClassName : activeStudent?.className);
  const routineSubjects = getSubjectsForClass(routineClassName);
  const classCount = stickyClassName ? students.filter(s=>s.className===stickyClassName).length : 0;

  return `
  <div class="form-grid" style="margin-bottom:16px">
    <label>শ্রেণি
      <select data-role="routine-picker-class" data-pick-action="${pickAction}">
        ${classes.map(c=>`<option value="${c}" ${pickerClassName===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </label>
    <label>শিক্ষার্থী
      <select data-role="routine-picker-student" data-pick-action="${pickAction}">
        ${studentsInPickerClass.map(s=>`<option value="${s.id}" ${s.id===active?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </label>
  </div>
  <details class="form-card" style="margin-bottom:16px" data-formkey="routine-add" ${(editing || state.openForms['routine-add'])?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">${editing?'রুটিন এডিট করুন':'➕ রুটিনে নতুন ক্লাস যোগ করুন'}</summary>
    <div style="margin-top:12px">
    <form id="routine-form" data-student="${active}" data-editing="${editing?editing.id:''}">
      <div class="form-grid">
        ${editing ? '' : `
        <label class="full">কার জন্য
          <select name="routineTarget" data-role="routine-target">
            <option value="student" ${stickyTarget==='student'?'selected':''}>শুধু নির্বাচিত শিক্ষার্থী (${activeStudent?activeStudent.name:''})</option>
            <option value="class" ${stickyTarget==='class'?'selected':''}>পুরো শ্রেণি (সবাইকে একসাথে)</option>
          </select>
        </label>`}
        <label id="routine-class-group" ${editing || stickyTarget!=='class' ? 'hidden':''}>শ্রেণি
          <select name="routineClassName" data-role="routine-class">${classes.map(c=>`<option ${stickyClassName===c?'selected':''}>${c}</option>`).join('')}</select>
          <span id="routine-class-count" style="font-weight:400; font-size:.76rem; color:var(--text-soft)">${stickyTarget==='class'?`এই শ্রেণিতে ${classCount} জন শিক্ষার্থী পাবে`:''}</span>
        </label>
        <label>দিন
          <select name="day">${WEEKDAYS.map(d=>`<option ${defaultDay===d?'selected':''}>${d}</option>`).join('')}</select>
        </label>
        <label>সময়
          <input name="time" placeholder="যেমনঃ বিকাল ৪:০০" value="${defaultTime}" required />
        </label>
        <label>বিষয়
          ${subjectSelectHtml(routineSubjects, editing?editing.subject:'', {attrs:'required data-role="routine-subject"'})}
        </label>
        <label>নোট (ঐচ্ছিক)
          <input name="note" placeholder="যেমনঃ শতকরা অনুশীলন" value="${editing?(editing.note||''):''}" />
        </label>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px">
        <button class="btn-primary" type="submit">${editing?'সংরক্ষণ করুন':'যোগ করুন'}</button>
        ${editing?`<button class="btn-ghost" type="button" id="routine-form-cancel">বাতিল</button>`:''}
      </div>
    </form>
    </div>
  </details>
  ${routineDisplayTableHtml(active, true)}`;
}

function renderTutorRoutine(user, forcedStudentId){
  const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
  const active = forcedStudentId || state.tutorRoutineStudent || myStudents[0]?.id;
  state.tutorRoutineStudent = active;
  return renderRoutineEditor(myStudents, active, { pickAction:'pick-tutor-routine' });
}

function renderAdminRoutine(user, forcedStudentId){
  const allStudents = usersByRole('student');
  const active = forcedStudentId || state.adminRoutineStudent || allStudents[0]?.id;
  state.adminRoutineStudent = active;
  return renderRoutineEditor(allStudents, active, { pickAction:'pick-admin-routine' });
}

function snapshotResultsHtml(studentId, dateStr){
  const ts = studentTasks(studentId).filter(t=>t.dueDate <= dateStr);
  const doneList = ts.filter(t=> t.completedDate && t.completedDate<=dateStr && (t.status==='done'||t.status==='partial'));
  const pendingList = ts.filter(t=> !doneList.includes(t));
  return `
    <div style="margin-top:14px">
      <b style="color:var(--success); font-size:.88rem">✅ ${fmtDate(dateStr)} পর্যন্ত সম্পন্ন হয়েছিল (${doneList.length}টি)</b>
      <div style="margin-top:6px">${doneList.map(t=>`<div class="task-meta">• <b style="color:var(--text)">${t.subject}</b> — ${t.chapter}</div>`).join('') || '<div class="empty">কিছু নেই</div>'}</div>
      <b style="color:var(--danger); font-size:.88rem; display:block; margin-top:14px">⏳ ${fmtDate(dateStr)} পর্যন্ত বাকি ছিল (${pendingList.length}টি)</b>
      <div style="margin-top:6px">${pendingList.map(t=>`<div class="task-meta">• <b style="color:var(--text)">${t.subject}</b> — ${t.chapter}</div>`).join('') || '<div class="empty">কিছু নেই</div>'}</div>
    </div>`;
}

function renderRevisionLog(user, forcedStudentId){
  // For guardian/tutor, pick a student; for student, self
  let studentId = forcedStudentId;
  let pickerHtml = '';
  const canManage = user.role==='guardian' || user.role==='tutor';
  if(user.role==='guardian'){
    const kids = (user.childIds||[]).map(findUser).filter(Boolean);
    studentId = studentId || kids[0]?.id;
    pickerHtml = `<div class="grid cols-3" style="margin-bottom:14px">${kids.map(k=>`
      <button class="btn-sm ${k.id===studentId?'primary':''}" data-action="pick-child" data-id="${k.id}">${k.name}</button>`).join('')}</div>`;
  } else if(user.role==='tutor'){
    const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
    studentId = studentId || state.revisionTutorStudent || myStudents[0]?.id;
    state.revisionTutorStudent = studentId;
    const pickedStudent = findUser(studentId);
    const classes = [...new Set(myStudents.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
    const pickerClassName = pickedStudent?.className && classes.includes(pickedStudent.className) ? pickedStudent.className : classes[0];
    const studentsInPickerClass = myStudents.filter(s=>s.className===pickerClassName);
    pickerHtml = `<div class="form-grid" style="margin-bottom:16px">
      <label>শ্রেণি
        <select data-role="revision-picker-class">
          ${classes.map(c=>`<option value="${c}" ${pickerClassName===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </label>
      <label>শিক্ষার্থী
        <select data-role="revision-picker-student">
          ${studentsInPickerClass.map(s=>`<option value="${s.id}" ${s.id===studentId?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </label>
    </div>`;
  } else if(user.role==='student'){
    studentId = user.id;
  }
  if(!studentId) return '<div class="empty">কোনো শিক্ষার্থী পাওয়া যায়নি।</div>';

  const rangeTabs = `<div class="grid cols-4" style="margin-bottom:14px">
    ${[['week','সাপ্তাহিক'],['month','মাসিক'],['quarter','ত্রৈমাসিক'],['all','সব সময়']].map(([k,l])=>
      `<button class="btn-sm ${state.revisionRange===k?'primary':''}" data-action="set-revision-range" data-id="${k}">${l}</button>`).join('')}
  </div>`;

  const snapshotHtml = `
  <details class="form-card" style="margin-bottom:16px" ${state.snapshotDate?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">📅 নির্দিষ্ট তারিখ পর্যন্ত অবস্থা দেখুন</summary>
    <div style="margin-top:12px">
      <input type="date" id="snapshot-date-input" value="${state.snapshotDate||''}" style="max-width:220px" />
      ${state.snapshotDate ? snapshotResultsHtml(studentId, state.snapshotDate) : ''}
    </div>
  </details>`;

  const minDate = REVISION_RANGES[state.revisionRange] ? daysAgoISO(REVISION_RANGES[state.revisionRange]) : null;
  let done = studentTasks(studentId).filter(t=>effectiveStatus(t)==='done');
  if(minDate) done = done.filter(t=>t.completedDate >= minDate);

  const syllabusHtml = `<div class="card margin" style="margin-bottom:16px">
    <h3>সিলেবাস অগ্রগতি (বিষয়ভিত্তিক)</h3>
    ${syllabusProgressHtml(studentId)}
  </div>`;

  const bySubject = {};
  done.forEach(t=>{ (bySubject[t.subject] ||= []).push(t); });

  const subjectsHtml = Object.keys(bySubject).sort().map(subj=>{
    const items = bySubject[subj];
    const rows = items.sort((a,b)=>a.chapter.localeCompare(b.chapter,'bn',{numeric:true})).map(t=>`
      <div class="revision-row"${canManage?' data-tap-reveal':''}>
        <div class="revision-chapter">${t.chapter}</div>
        ${t.questions?`<div class="revision-questions">${t.questions}</div>`:''}
        <div class="revision-date">${fmtDate(t.completedDate)}${canManage?`<span class="reveal-actions">
            <button class="btn-sm danger" data-action="mark-not-done" data-id="${t.id}" title="সম্পন্ন হয়নি">↩️</button>
            <button class="btn-sm" data-action="remind-revision" data-id="${t.id}" title="মনে করিয়ে দিন">🔔</button>
          </span>`:''}</div>
      </div>`).join('');
    return `
    <details class="revision-subject-card" data-formkey="revision-subject-${subj}" ${state.openForms['revision-subject-'+subj]?'open':''}>
      <summary>${subj} <span class="revision-count">(${items.length}টি সম্পন্ন)</span></summary>
      <div class="revision-table">${rows}</div>
      ${canManage?'<div class="tap-reveal-hint">👆 কোনো লাইনে চাপলে বিকল্পগুলো দেখাবে</div>':''}
    </details>`;
  }).join('');

  return `${pickerHtml}${syllabusHtml}${snapshotHtml}${rangeTabs}
    <p style="color:var(--text-soft-strong); font-size:.85rem; margin-top:-4px">পরীক্ষার আগে বিষয়ভিত্তিক গোছানো রিভিশনের জন্য — অধ্যায়/টপিক ও প্রশ্নসহ।</p>
    ${subjectsHtml || '<div class="empty">এই সময়সীমায় কোনো পড়া সম্পন্ন হয়নি।</div>'}`;
}

/* ==========================================================
   TUTOR VIEWS
   ========================================================== */
function todaysDayName(){ return WEEKDAYS[jsDayToOurIndex(new Date().getDay())]; }

/* আজকের পড়া — আজকের দিনে রুটিন অনুযায়ী কোন কোন স্টুডেন্টের ক্লাস আছে */
/* group any items that have a .studentId by that student's শ্রেণি (class), in class order */
function groupByStudentClass(items){
  const byClass = {};
  items.forEach(item=>{
    const s = findUser(item.studentId);
    const cls = s?.className || '—';
    (byClass[cls] ||= []).push(item);
  });
  return sortByClassOrder(Object.keys(byClass)).map(cls=>({cls, items:byClass[cls]}));
}

/* merge routine entries that are identical except for which student they belong
   to (subject+time+note the same) into one line with a ×N count */
function dedupeRoutineEntries(entries, extraKeyFn){
  const groups = []; const index = {};
  entries.forEach(r=>{
    const key = [r.subject, r.time, r.note||'', extraKeyFn?extraKeyFn(r):''].join('|');
    if(index[key]===undefined){ index[key] = groups.length; groups.push({rep:r, count:0}); }
    groups[index[key]].count++;
  });
  return groups;
}

function tutorTodayRoutineHtml(myStudents){
  const todayDay = todaysDayName();
  const entries = routine().filter(r => myStudents.some(s=>s.id===r.studentId) && r.day===todayDay)
    .sort((a,b)=> a.time.localeCompare(b.time));
  if(!entries.length) return `<div class="empty">আজ (${todayDay}) রুটিনে কোনো ক্লাস নেই।</div>`;
  return groupByStudentClass(entries).map(({cls, items})=>`
    <div class="today-class-group">
      <div class="today-class-title">${cls}</div>
      ${dedupeRoutineEntries(items).map(g=>`<div class="task-meta">• <span class="subject-chip">${g.rep.subject}</span> ${g.rep.time}${g.rep.note?' — '+g.rep.note:''}${g.count>1?` <span class="pill">×${g.count}</span>`:''}</div>`).join('')}
    </div>`).join('');
}

/* আজকের পড়া আদায় তালিকা — আজকে যেসব পড়ার শেষ তারিখ, তাদের অবস্থা (সম্পন্ন/বাকি) */
function tutorTodayCollectionHtml(myStudents){
  const today = todayISO();
  const items = tasks().filter(t=> myStudents.some(s=>s.id===t.studentId) && t.dueDate===today);
  if(!items.length) return '<div class="empty">আজকের জন্য শেষ তারিখ দেওয়া কোনো পড়া নেই।</div>';
  return groupByStudentClass(items).map(({cls, items})=>`
    <div class="today-class-group">
      <div class="today-class-title">${cls}</div>
      ${dedupeCommonTasks(items).map(t=>taskRowHtml(t,{showStudent:false, actions:()=>''})).join('')}
    </div>`).join('');
}

/* টিউটরের টাস্ক — আজকের রুটিনে উল্লেখিত প্রতিটা সাবজেক্টে আসলেই পড়া দেওয়া হয়েছে কিনা তার চেকলিস্ট */
function tutorTodayTaskChecklistHtml(myStudents){
  const todayDay = todaysDayName();
  const today = todayISO();
  const entries = routine().filter(r => myStudents.some(s=>s.id===r.studentId) && r.day===todayDay);
  if(!entries.length) return '<div class="empty">আজ রুটিনে কোনো ক্লাস নেই, তাই কোনো টাস্ক নেই।</div>';
  const givenOf = (r)=> tasks().some(t=> t.studentId===r.studentId && t.subject===r.subject && t.assignedDate===today);
  return groupByStudentClass(entries).map(({cls, items})=>`
    <div class="today-class-group">
      <div class="today-class-title">${cls}</div>
      ${dedupeRoutineEntries(items, r=>givenOf(r)).map(g=>{
        const given = givenOf(g.rep);
        return `<div class="task-meta" style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap">
          <span>${given?'✅':'⏳'} <span class="subject-chip">${g.rep.subject}</span> — ${given?'পড়া দেওয়া হয়েছে':'এখনো পড়া দেওয়া হয়নি'}${g.count>1?` <span class="pill">×${g.count}</span>`:''}</span>
          ${given?'':`<button class="btn-sm primary" data-action="goto-assign-for" data-id="${g.rep.studentId}">✍️ পড়া দিন</button>`}
        </div>`;
      }).join('')}
    </div>`).join('');
}

function renderTutorDashboard(user){
  const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
  const allTasksForMe = tasks().filter(t=>t.tutorId===user.id);
  const missedCount = allTasksForMe.filter(t=>effectiveStatus(t)==='missed').length;
  const doneCount = allTasksForMe.filter(t=>effectiveStatus(t)==='done').length;
  return `
  <div class="grid cols-4">
    <div class="card margin"><h3>স্টুডেন্ট</h3><div class="stat-num">${myStudents.length}</div><div class="stat-label">আমার আওতায়</div></div>
    <div class="card margin"><h3>মোট পড়া দেওয়া</h3><div class="stat-num">${allTasksForMe.length}</div></div>
    <div class="card margin"><h3>সম্পন্ন</h3><div class="stat-num" style="color:var(--success)">${doneCount}</div></div>
    <div class="card margin"><h3>মিস হয়েছে</h3><div class="stat-num" style="color:var(--danger)">${missedCount}</div></div>
  </div>
  <div class="grid cols-2">
    <div>
      <div class="section-title"><h3>🗓️ আজকের পড়া (রুটিন অনুসারে)</h3></div>
      <div class="card margin">${tutorTodayRoutineHtml(myStudents)}</div>
    </div>
    <div>
      <div class="section-title"><h3>✅ আজকের টাস্ক (রুটিনের সাবজেক্টে পড়া দেওয়া হয়েছে কিনা)</h3></div>
      <div class="card margin">${tutorTodayTaskChecklistHtml(myStudents)}</div>
    </div>
  </div>
  <div class="section-title"><h3>📋 আজকের পড়া আদায় তালিকা</h3></div>
  ${tutorTodayCollectionHtml(myStudents)}
  <div class="section-title"><h3>স্টুডেন্টদের অবস্থা</h3></div>
  <div class="grid cols-3">
  ${myStudents.map(s=>{
    const p = studentProgress(s.id);
    const sp = syllabusOverallPct(s.id);
    return `<div class="card margin">
      <h3>${s.name} <span style="font-size:.75rem; color:var(--text-soft); font-weight:400">(${s.className||''})</span></h3>
      <div class="stat-label">টাস্ক আদায়</div>
      <div class="progress-bar ${progressBarClass(p.pct)}" style="margin:4px 0 8px"><span style="width:${p.pct}%"></span></div>
      <div class="stat-label">আদায়: ${p.pct}% · মিস: ${p.missed}টি</div>
      <div class="stat-label" style="margin-top:8px">সিলেবাস সম্পন্ন: ${sp}%</div>
      <button class="btn-sm" style="margin-top:10px" data-action="goto-student-tasks" data-id="${s.id}">বিস্তারিত দেখুন</button>
    </div>`;
  }).join('') || '<div class="empty">কোনো স্টুডেন্ট যুক্ত নেই। প্রশাসককে বলে যুক্ত করান।</div>'}
  </div>
  ${tutorDashboardTaskTabsHtml(myStudents)}
  `;
}

/* "সকল পড়া" block for the bottom of the tutor's own dashboard — same two
   given/due tabs as the student dashboard, with the tutor's usual management
   buttons (এডিট/মুছুন always; সম্পন্ন-হয়নি/মনে-করিয়ে-দিন for done items)
   appearing when a reading card is opened. Also filterable by class/student
   and by সাপ্তাহিক (default) / পাক্ষিক / মাসিক / তারিখ অনুসারে. */
const DASH_RANGE_DAYS = { week:7, fortnight:15, month:30 };
function tutorDashboardTaskTabsHtml(myStudents){
  const tab = state.tutorDashTab==='due' ? 'due' : 'given';
  const range = state.tutorDashRange || 'week';
  const classes = [...new Set(myStudents.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  const classFilter = state.tutorDashClassFilter && (state.tutorDashClassFilter==='all' || classes.includes(state.tutorDashClassFilter)) ? state.tutorDashClassFilter : 'all';
  const studentsInClass = myStudents.filter(s => classFilter==='all' || s.className===classFilter);
  const activeStudent = state.tutorDashStudentFilter && studentsInClass.some(s=>s.id===state.tutorDashStudentFilter) ? state.tutorDashStudentFilter : null;
  const scopedStudents = activeStudent ? studentsInClass.filter(s=>s.id===activeStudent) : studentsInClass;

  const dateField = tab==='due' ? 'dueDate' : 'assignedDate';
  const scopedIds = new Set(scopedStudents.map(s=>s.id));
  const user = currentUser();
  let pool;
  if(range==='week'){
    pool = tasks().filter(t=>scopedIds.has(t.studentId));
  } else {
    const bounds = rangeToBounds(range, state.tutorDashCustomFrom, state.tutorDashCustomTo);
    const cacheKey = `tutor-dash:${user.id}:${JSON.stringify(bounds)}`;
    const cached = state.taskRangeCache[cacheKey];
    pool = cached ? markOutOfWindow(cached).filter(t=>scopedIds.has(t.studentId)) : null;
  }

  const tabs = [
    ['given','📚 শিক্ষকের দেওয়া পড়া'],
    ['due','📅 পড়া আদায়ের শেষ তারিখ অনুযায়ী'],
  ];
  const opts = {
    showStudent: scopedStudents.length>1,
    actions: (t,st)=> (t.__readOnly ? '' : tutorTaskActionButtons(t) + (st==='done' ? manageDoneTaskButtonsHtml(t) : ''))
  };
  const content = pool===null
    ? `<div class="empty">লোড হচ্ছে…</div>`
    : (tab==='due' ? rowGroupedByDueDateHtml(pool, opts) : rowGroupedByAssignedDateHtml(pool, opts));
  return `
  <div class="section-title" style="margin-top:24px"><h3>সকল পড়া</h3></div>
  <div class="grid cols-2" style="margin:10px 0 12px">
    ${tabs.map(([k,l])=>`<button class="btn-sm ${tab===k?'primary':''}" data-action="set-tutor-dash-tab" data-id="${k}">${l}</button>`).join('')}
  </div>
  <div class="form-grid" style="margin-bottom:14px">
    <label>শ্রেণি
      <select data-role="tutor-dash-class">
        <option value="all" ${classFilter==='all'?'selected':''}>সব শ্রেণি</option>
        ${classes.map(c=>`<option value="${c}" ${classFilter===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </label>
    <label>শিক্ষার্থী
      <select data-role="tutor-dash-student">
        <option value="" ${!activeStudent?'selected':''}>সবাই (এই ফিল্টারে)</option>
        ${studentsInClass.map(s=>`<option value="${s.id}" ${s.id===activeStudent?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </label>
    <label>সময়কাল
      <select data-role="tutor-dash-range">
        <option value="week" ${range==='week'?'selected':''}>সাপ্তাহিক</option>
        <option value="fortnight" ${range==='fortnight'?'selected':''}>পাক্ষিক</option>
        <option value="month" ${range==='month'?'selected':''}>মাসিক</option>
        <option value="custom" ${range==='custom'?'selected':''}>তারিখ অনুসারে</option>
      </select>
    </label>
    ${range==='custom' ? `
    <label>শুরুর তারিখ
      <input type="date" data-role="tutor-dash-custom-from" value="${state.tutorDashCustomFrom||''}" />
    </label>
    <label>শেষ তারিখ
      <input type="date" data-role="tutor-dash-custom-to" value="${state.tutorDashCustomTo||''}" />
    </label>` : ''}
  </div>
  ${content}
  `;
}

/* same block for the admin dashboard, but scoped to every student system-wide
   by default — kept behind a সাপ্তাহিক (default)/পাক্ষিক/মাসিক/তারিখ অনুসারে
   range filter, and a class/student selector to narrow it, so it stays fast
   at the app's target scale (~1200-1500 students); README explicitly notes
   the old unfiltered "সকল টাস্ক" list on this dashboard was removed for that
   same reason, so this reintroduces the view without bringing that problem back. */
function adminDashboardTaskTabsHtml(){
  const tab = state.adminDashTab==='due' ? 'due' : 'given';
  const range = state.adminDashRange || 'week';
  const allStudents = usersByRole('student');
  const classes = [...new Set(allStudents.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  const classFilter = state.adminDashClassFilter && (state.adminDashClassFilter==='all' || classes.includes(state.adminDashClassFilter)) ? state.adminDashClassFilter : 'all';
  const studentsInClass = allStudents.filter(s => classFilter==='all' || s.className===classFilter);
  const activeStudent = state.adminDashStudentFilter && studentsInClass.some(s=>s.id===state.adminDashStudentFilter) ? state.adminDashStudentFilter : null;
  const scopedStudents = activeStudent ? studentsInClass.filter(s=>s.id===activeStudent) : studentsInClass;

  const dateField = tab==='due' ? 'dueDate' : 'assignedDate';
  const scopedIds = new Set(scopedStudents.map(s=>s.id));
  let pool;
  if(range==='week'){
    pool = tasks().filter(t=>scopedIds.has(t.studentId));
  } else {
    const bounds = rangeToBounds(range, state.adminDashCustomFrom, state.adminDashCustomTo);
    const cacheKey = `admin-dash:${JSON.stringify(bounds)}`;
    const cached = state.taskRangeCache[cacheKey];
    pool = cached ? markOutOfWindow(cached).filter(t=>scopedIds.has(t.studentId)) : null;
  }

  const tabs = [
    ['given','📚 শিক্ষকের দেওয়া পড়া'],
    ['due','📅 পড়া আদায়ের শেষ তারিখ অনুযায়ী'],
  ];
  const opts = {
    showStudent: scopedStudents.length>1,
    actions: (t,st)=> (t.__readOnly ? '' : tutorTaskActionButtons(t) + (st==='done' ? manageDoneTaskButtonsHtml(t) : ''))
  };
  const content = pool===null
    ? `<div class="empty">লোড হচ্ছে…</div>`
    : (tab==='due' ? rowGroupedByDueDateHtml(pool, opts) : rowGroupedByAssignedDateHtml(pool, opts));
  return `
  <div class="section-title" style="margin-top:24px"><h3>সকল পড়া</h3></div>
  <div class="grid cols-2" style="margin:10px 0 12px">
    ${tabs.map(([k,l])=>`<button class="btn-sm ${tab===k?'primary':''}" data-action="set-admin-dash-tab" data-id="${k}">${l}</button>`).join('')}
  </div>
  <div class="form-grid" style="margin-bottom:14px">
    <label>শ্রেণি
      <select data-role="admin-dash-class">
        <option value="all" ${classFilter==='all'?'selected':''}>সব শ্রেণি</option>
        ${classes.map(c=>`<option value="${c}" ${classFilter===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </label>
    <label>শিক্ষার্থী
      <select data-role="admin-dash-student">
        <option value="" ${!activeStudent?'selected':''}>সবাই (এই ফিল্টারে)</option>
        ${studentsInClass.map(s=>`<option value="${s.id}" ${s.id===activeStudent?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </label>
    <label>সময়কাল
      <select data-role="admin-dash-range">
        <option value="week" ${range==='week'?'selected':''}>সাপ্তাহিক</option>
        <option value="fortnight" ${range==='fortnight'?'selected':''}>পাক্ষিক</option>
        <option value="month" ${range==='month'?'selected':''}>মাসিক</option>
        <option value="custom" ${range==='custom'?'selected':''}>তারিখ অনুসারে</option>
      </select>
    </label>
    ${range==='custom' ? `
    <label>শুরুর তারিখ
      <input type="date" data-role="admin-dash-custom-from" value="${state.adminDashCustomFrom||''}" />
    </label>
    <label>শেষ তারিখ
      <input type="date" data-role="admin-dash-custom-to" value="${state.adminDashCustomTo||''}" />
    </label>` : ''}
  </div>
  ${content}
  `;
}

function renderTutorStudents(user){
  const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
  const classes = [...new Set(myStudents.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  const filterClass = state.tutorClassFilter || 'all';
  const active = state.tutorStudentFilter;
  const editingStudent = state.editingStudentId ? findUser(state.editingStudentId) : null;

  const visibleStudents = myStudents.filter(s => filterClass==='all' || s.className===filterClass);

  const studentTableRows = myStudents.map(s=>{
    const g = findUser(s.guardianId);
    return `<tr>
      <td>${s.name} <span style="color:var(--text-soft); font-size:.78rem">(${s.username})</span></td>
      <td><span class="pill student">${s.className||'—'}</span></td>
      <td>${g?g.name:'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm" data-action="edit-student" data-id="${s.id}">এডিট</button>
        <button class="btn-sm danger" data-action="remove-student" data-id="${s.id}">রিমুভ</button>
      </td>
    </tr>`;
  }).join('');

  const defaultStudentClass = editingStudent ? editingStudent.className : (state.stickyStudentClassName || CLASSES[0]);
  return `
  <details class="form-card" style="margin-bottom:18px" data-formkey="student-add" ${(editingStudent || state.openForms['student-add'])?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">${editingStudent? `${editingStudent.name} — এডিট করুন` : '➕ নতুন শিক্ষার্থী যোগ করুন'}</summary>
    <div style="margin-top:12px">
    <form id="student-form" data-editing="${editingStudent?editingStudent.id:''}">
      <div class="form-grid">
        <label>নাম<input name="name" value="${editingStudent?editingStudent.name:''}" required /></label>
        <label>ডাকনাম
          <input name="nickname" value="${editingStudent?(editingStudent.nickname||''):''}" placeholder="যেমনঃ আরিয়ান" />
        </label>
        <label>শ্রেণি
          <select name="className" required>${CLASSES.map(c=>`<option ${defaultStudentClass===c?'selected':''}>${c}</option>`).join('')}</select>
        </label>
        <label>ইউজারনেম<input name="username" value="${editingStudent?editingStudent.username:''}" required /></label>
        <label>পাসওয়ার্ড
          <input name="password" type="password" value="${editingStudent? '' : '1234'}" placeholder="${editingStudent? 'পরিবর্তন করতে না চাইলে খালি রাখুন' : ''}" ${editingStudent?'':'required'} />
          ${editingStudent? '' : `<span style="font-weight:400; font-size:.76rem; color:var(--text-soft)">ডিফল্ট পাসওয়ার্ড: 1234 (চাইলে বদলে দিন)</span>`}
        </label>
        ${editingStudent? `<label style="justify-content:flex-end">&nbsp;
          <button class="btn-sm" type="button" id="student-reset-password">🔑 ডিফল্ট পাসওয়ার্ডে রিসেট করুন</button>
        </label>` : ''}
        <label class="full">অভিভাবক (ঐচ্ছিক)
          <select name="guardianId">
            <option value="">— নেই —</option>
            ${usersByRole('guardian').map(g=>`<option value="${g.id}" ${editingStudent&&editingStudent.guardianId===g.id?'selected':''}>${g.name}</option>`).join('')}
          </select>
        </label>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px">
        <button class="btn-primary" type="submit">${editingStudent?'সংরক্ষণ করুন':'যোগ করুন'}</button>
        ${editingStudent? `<button class="btn-ghost" type="button" id="student-form-cancel">বাতিল</button>` : ''}
      </div>
    </form>
    </div>
  </details>

  <details class="form-card" style="margin-bottom:18px" data-formkey="student-list" ${state.openForms['student-list']?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">👨‍🎓 আমার শিক্ষার্থীরা (${myStudents.length})</summary>
    <div style="margin-top:12px">
    <table class="table">
      <thead><tr><th>নাম</th><th>শ্রেণি</th><th>অভিভাবক</th><th></th></tr></thead>
      <tbody>${studentTableRows || `<tr><td colspan="4" class="empty">এখনো কোনো শিক্ষার্থী যুক্ত করা হয়নি।</td></tr>`}</tbody>
    </table>
    </div>
  </details>

  <details class="form-card" style="margin-bottom:18px" data-formkey="student-task-filter" ${state.openForms['student-task-filter']?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">পড়া/টাস্ক — শ্রেণি বা শিক্ষার্থী ভিত্তিক ফিল্টার</summary>
    <div style="margin-top:12px">
    <div class="form-grid" style="margin-bottom:16px">
      <label>শ্রেণি
        <select data-role="student-filter-class">
          <option value="all" ${filterClass==='all'?'selected':''}>সব শ্রেণি</option>
          ${classes.map(c=>`<option value="${c}" ${filterClass===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </label>
      <label>শিক্ষার্থী
        <select data-role="student-filter-student">
          <option value="" ${!active?'selected':''}>সবাই (এই ফিল্টারে)</option>
          ${visibleStudents.map(s=>`<option value="${s.id}" ${s.id===active?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </label>
    </div>
    ${tutorTaskFilterTabsHtml(active, visibleStudents)}
    ${active ? followupSectionHtml(active, true) : ''}
    </div>
  </details>
  `;
}

/* Phase-2, step 1 (pilot surface): the always-live local pk_tasks cache is
   now bounded to a rolling ~7-day window by dueDate (see firebase-sync.js).
   When someone picks a wider range (পাক্ষিক/মাসিক/তারিখ অনুসারে) here, that
   data usually isn't in localStorage at all — this fetches it once (not a
   live subscription) and keeps it in an in-memory-only cache for this
   session. Deliberately NOT merged into the real tasks()/localStorage array
   the edit/delete/complete buttons operate on — records that only exist in
   this wider-range cache are shown read-only (no action buttons), since
   they're outside the actively-synced set. cacheKey should uniquely
   identify the query (role/student/date range); scope is the same shape
   fetchTaskRange expects ({role, myId, childIds?, studentId?}). */
async function ensureWiderTaskRange(cacheKey, scope, fromISO, toISO){
  if(state.taskRangeCache[cacheKey]) return state.taskRangeCache[cacheKey];
  if(!window.CloudSync || !window.CloudSync.fetchTaskRange) return null;
  try{
    const data = await window.CloudSync.fetchTaskRange(scope, 'dueDate', fromISO||null, toISO||null);
    state.taskRangeCache[cacheKey] = data;
    return data;
  }catch(e){
    toast('⚠️ পুরনো রেঞ্জের ডাটা আনতে সমস্যা হয়েছে — ইন্টারনেট চেক করুন।', 'warn');
    return null;
  }
}
/* Range → {from,to} ISO bounds, or null bounds for 'week' (already covered
   by the live rolling window, so no fetch needed — the fast/common path). */
function rangeToBounds(range, customFrom, customTo){
  if(range==='custom') return { from: customFrom||null, to: customTo||null };
  if(range==='week' || !range) return null; // covered by the live rolling window already
  return { from: daysAgoISO(DASH_RANGE_DAYS[range] || 7), to: null };
}
/* Marks which of a task list's items are only visible via the wider-range
   cache (i.e. not in the live-synced tasks()) — those get no management
   buttons, since editing/deleting them wouldn't reflect back into tasks(). */
function markOutOfWindow(list){
  const liveIds = new Set(tasks().map(t=>t.id));
  return list.map(t => liveIds.has(t.id) ? t : { ...t, __readOnly:true });
}
/* Pilot wiring for the tutor's "আমার স্টুডেন্ট" মিস/সম্পন্ন filter — kicks off
   (and caches) the wider-range fetch when needed. See ensureWiderTaskRange. */
async function triggerTutorTaskRangeFetch(){
  const range = state.tutorTaskRange || 'week';
  if(range==='week') return; // covered by the live rolling window already
  const user = currentUser();
  if(!user) return;
  const bounds = rangeToBounds(range, state.tutorTaskCustomFrom, state.tutorTaskCustomTo);
  const activeStudentId = state.tutorStudentFilter;
  const scope = { role:'tutor', myId:user.id, studentId: activeStudentId || undefined };
  const cacheKey = `tutor-filter:${activeStudentId||'all'}:${JSON.stringify(bounds)}`;
  await ensureWiderTaskRange(cacheKey, scope, bounds && bounds.from, bounds && bounds.to);
}
/* Same idea for the other four given/due surfaces — one fetch per (surface,
   date-range) pair; class/student filter changes within a surface reuse the
   same cached fetch and just re-filter it client-side (see each render
   function), so only range/custom-date changes need to call these. */
async function triggerStudentDashRangeFetch(){
  const range = state.studentDashRange || 'week';
  if(range==='week') return;
  const user = currentUser();
  if(!user) return;
  const bounds = rangeToBounds(range, state.studentDashCustomFrom, state.studentDashCustomTo);
  const cacheKey = `student-dash:${user.id}:${JSON.stringify(bounds)}`;
  await ensureWiderTaskRange(cacheKey, { role:'student', myId:user.id }, bounds && bounds.from, bounds && bounds.to);
}
async function triggerGuardianDashRangeFetch(studentId){
  const range = state.guardianDashRange || 'week';
  if(range==='week') return;
  const user = currentUser();
  if(!user || !studentId) return;
  const bounds = rangeToBounds(range, state.guardianDashCustomFrom, state.guardianDashCustomTo);
  const cacheKey = `guardian-dash:${studentId}:${JSON.stringify(bounds)}`;
  await ensureWiderTaskRange(cacheKey, { role:'guardian', myId:user.id, studentId }, bounds && bounds.from, bounds && bounds.to);
}
async function triggerTutorDashRangeFetch(){
  const range = state.tutorDashRange || 'week';
  if(range==='week') return;
  const user = currentUser();
  if(!user) return;
  const bounds = rangeToBounds(range, state.tutorDashCustomFrom, state.tutorDashCustomTo);
  // fetches ALL of this tutor's own tasks in range (not narrowed by the class/
  // student filter) — the class/student dropdown then just re-filters the
  // same cached set client-side, so switching it doesn't need another fetch.
  const cacheKey = `tutor-dash:${user.id}:${JSON.stringify(bounds)}`;
  await ensureWiderTaskRange(cacheKey, { role:'tutor', myId:user.id }, bounds && bounds.from, bounds && bounds.to);
}
async function triggerAdminDashRangeFetch(){
  const range = state.adminDashRange || 'week';
  if(range==='week') return;
  const user = currentUser();
  if(!user) return;
  const bounds = rangeToBounds(range, state.adminDashCustomFrom, state.adminDashCustomTo);
  // admin isn't scoped by person, so one fetch per date-range covers every
  // class/student combination — same reasoning as the tutor dashboard above.
  const cacheKey = `admin-dash:${JSON.stringify(bounds)}`;
  await ensureWiderTaskRange(cacheKey, { role:'admin', myId:user.id }, bounds && bounds.from, bounds && bounds.to);
}

/* "মিস হওয়া পড়া" (pending/missed) vs "সম্পন্ন হওয়া পড়া" (completed) as two
   separate tabs, each filterable by সাপ্তাহিক (last 7 days) / মাসিক (last 30
   days) / তারিখ অনুসারে (a custom from–to date range) — used inside the
   tutor's "আমার স্টুডেন্ট" → class/student filter section. */
const TUTOR_TASK_RANGE_DAYS = { week:7, fortnight:15, month:30 };
function tutorTaskFilterTabsHtml(activeStudentId, visibleStudents){
  const tab = state.tutorTaskTab==='done' ? 'done' : 'missed';
  const range = state.tutorTaskRange || 'week';
  const dateField = tab==='done' ? 'completedDate' : 'dueDate';

  let pool = null;
  let loading = false;
  if(range==='week'){
    // fast path — already covered by the live rolling window, no fetch needed
    pool = activeStudentId
      ? studentTasks(activeStudentId)
      : dedupeCommonTasks(tasks().filter(t=>visibleStudents.some(s=>s.id===t.studentId)));
  } else {
    const bounds = rangeToBounds(range, state.tutorTaskCustomFrom, state.tutorTaskCustomTo);
    const cacheKey = `tutor-filter:${activeStudentId||'all'}:${JSON.stringify(bounds)}`;
    const cached = state.taskRangeCache[cacheKey];
    if(!cached){
      loading = true; // the change-handler already kicked off the fetch; it'll re-render when ready
    } else {
      const marked = markOutOfWindow(cached);
      pool = activeStudentId
        ? marked.filter(t=>t.studentId===activeStudentId)
        : dedupeCommonTasks(marked.filter(t=>visibleStudents.some(s=>s.id===t.studentId)));
    }
  }

  let listHtml;
  if(loading){
    listHtml = `<div class="empty">লোড হচ্ছে…</div>`;
  } else {
    let filtered = pool.filter(t => tab==='done' ? effectiveStatus(t)==='done' : effectiveStatus(t)!=='done');
    // no extra local date-filter needed here anymore — `pool` is already
    // scoped to the right dueDate range, either by the live rolling window
    // ('week') or by the fetch in the branch above (fortnight/month/custom).

    const groups = [];
    filtered.slice()
      .sort((a,b)=> tab==='done' ? (b.completedDate||'').localeCompare(a.completedDate||'') : a.dueDate.localeCompare(b.dueDate))
      .forEach(t=>{
        const dv = t[dateField] || t.dueDate;
        let g = groups.find(g=>g.dueDate===dv);
        if(!g){ g = {label: relativeDateLabel(dv), dueDate: dv, items:[]}; groups.push(g); }
        g.items.push(t);
      });

    const rowActions = tab==='done'
      ? (t)=> (t.__count>1 || t.__readOnly) ? '' : (tutorTaskActionButtons(t) + manageDoneTaskButtonsHtml(t))
      : (t)=> (t.__count>1 || t.__readOnly) ? '' : tutorTaskActionButtons(t);

    listHtml = groups.length ? groups.map(g=>`
        <div class="section-title" style="margin-top:14px; margin-bottom:6px"><h3 style="font-size:.95rem">${g.label}</h3></div>
        ${g.items.map(t=>taskRowHtml(t,{actions:rowActions})).join('')}
      `).join('')
      : `<div class="empty">${tab==='done' ? 'এই সময়সীমায় কোনো পড়া সম্পন্ন হয়নি।' : 'এই সময়সীমায় কোনো বাকি/মিস হওয়া পড়া নেই।'}</div>`;
  }

  return `
    <div class="grid cols-2" style="margin-bottom:12px">
      <button class="btn-sm ${tab==='missed'?'primary':''}" data-action="set-tutor-task-tab" data-id="missed">❌ মিস হওয়া পড়া</button>
      <button class="btn-sm ${tab==='done'?'primary':''}" data-action="set-tutor-task-tab" data-id="done">✅ সম্পন্ন হওয়া পড়া</button>
    </div>
    <div class="form-grid" style="margin-bottom:14px">
      <label>সময়কাল
        <select data-role="tutor-task-range">
          <option value="week" ${range==='week'?'selected':''}>সাপ্তাহিক</option>
          <option value="fortnight" ${range==='fortnight'?'selected':''}>পাক্ষিক</option>
          <option value="month" ${range==='month'?'selected':''}>মাসিক</option>
          <option value="custom" ${range==='custom'?'selected':''}>তারিখ অনুসারে</option>
        </select>
      </label>
      ${range==='custom' ? `
      <label>শুরুর তারিখ
        <input type="date" data-role="tutor-task-custom-from" value="${state.tutorTaskCustomFrom||''}" />
      </label>
      <label>শেষ তারিখ
        <input type="date" data-role="tutor-task-custom-to" value="${state.tutorTaskCustomTo||''}" />
      </label>` : ''}
    </div>
    ${listHtml}
  `;
}

function taskListWithStudentControls(studentId, readOnly){
  const ts = studentTasks(studentId);
  return ts.map(t=>taskRowHtml(t,{actions: readOnly ? ()=>'' : tutorTaskActionButtons})).join('') || '<div class="empty">এখনো পড়া দেওয়া হয়নি।</div>';
}
function tutorTaskActionButtons(t){
  return `<button class="btn-sm" data-action="edit-task" data-id="${t.id}">এডিট</button>
    <button class="btn-sm danger" data-action="delete-task" data-id="${t.id}">মুছুন</button>`;
}

/* ---------- ফলোআপ / তদারকি (follow-up notes) ---------- */
function followupsForStudent(studentId){
  return followups().filter(f=>f.studentId===studentId).sort((a,b)=>b.ts-a.ts);
}
function followupListHtml(studentId, canManage){
  const items = followupsForStudent(studentId);
  if(!items.length) return '<div class="empty">এখনো কোনো ফলোআপ নোট নেই।</div>';
  return items.map(f=>{
    const author = findUser(f.tutorId);
    return `<div class="task-row" style="align-items:center">
      <div class="stamp" style="border-color:var(--ink); color:var(--ink); background:#eef2f6">📝</div>
      <div class="task-body">
        <div class="task-meta">${author?author.name:'টিউটর'} · ${fmtDateTime(f.ts)}</div>
        <div style="margin-top:3px">${f.text}</div>
        ${canManage? `<div class="task-actions"><button class="btn-sm danger" data-action="delete-followup" data-id="${f.id}">মুছুন</button></div>`:''}
      </div>
    </div>`;
  }).join('');
}
function followupSectionHtml(studentId, canManage){
  return `
  <div class="section-title"><h3>তদারকি / ফলোআপ নোট</h3></div>
  ${canManage? `
  <div class="form-card" style="margin-bottom:14px">
    <form id="followup-form" data-student="${studentId}">
      <textarea name="text" placeholder="যেমনঃ আজকে ওর পড়ায় মনোযোগ ভালো ছিল, তবে গণিতে আরেকটু অনুশীলন দরকার..." required></textarea>
      <button class="btn-primary" type="submit" style="margin-top:10px">নোট যোগ করুন</button>
    </form>
  </div>` : ''}
  ${followupListHtml(studentId, canManage)}
  `;
}

/* ---------- পেমেন্ট / স্যালারি স্লিপ ---------- */
function paymentsForStudent(studentId){
  return payments().filter(p=>p.studentId===studentId).sort((a,b)=>b.month.localeCompare(a.month) || b.receivedDate.localeCompare(a.receivedDate));
}
function paymentTableHtml(studentId, canManage){
  const items = paymentsForStudent(studentId);
  if(!items.length) return '<div class="empty">এখনো কোনো পেমেন্ট রেকর্ড নেই।</div>';
  const rows = items.map(p=>`
    <div class="payment-row"${canManage?' data-tap-reveal':''}>
      <div class="payment-main">
        <b>${fmtMonth(p.month)}</b> — ${fmtTaka(p.amount)}
        <div class="payment-sub">${fmtDate(p.receivedDate)}${p.note?' · '+p.note:''}</div>
      </div>
      ${canManage?`<span class="reveal-actions">
          <button class="btn-sm" data-action="edit-payment" data-id="${p.id}" title="এডিট">✏️</button>
          <button class="btn-sm danger" data-action="delete-payment" data-id="${p.id}" title="মুছুন">🗑️</button>
        </span>`:''}
    </div>`).join('');
  return `<div class="payment-table">${rows}${canManage?'<div class="tap-reveal-hint">👆 কোনো লাইনে চাপলে এডিট/মুছার অপশন দেখাবে</div>':''}</div>`;
}

function renderTutorPayments(user){
  const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
  const classes = [...new Set(myStudents.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  if(!classes.length) return '<div class="empty">কোনো স্টুডেন্ট যুক্ত নেই।</div>';
  const classFilter = (state.paymentClassFilter && classes.includes(state.paymentClassFilter))
    ? state.paymentClassFilter
    : (findUser(state.paymentStudentFilter)?.className || classes[0]);
  const studentsInClass = myStudents.filter(s=>s.className===classFilter);
  const active = (state.paymentStudentFilter && studentsInClass.some(s=>s.id===state.paymentStudentFilter))
    ? state.paymentStudentFilter
    : studentsInClass[0]?.id;
  state.paymentClassFilter = classFilter;
  state.paymentStudentFilter = active;
  if(!active) return '<div class="empty">কোনো স্টুডেন্ট যুক্ত নেই।</div>';
  const editing = state.editingPaymentId ? payments().find(p=>p.id===state.editingPaymentId) : null;

  const thisMonth = currentMonthValue();
  const thisMonthTotal = myStudents.reduce((sum,s)=>{
    const p = paymentsForStudent(s.id).find(x=>x.month===thisMonth);
    return sum + (p ? p.amount : 0);
  }, 0);

  return `
  <div class="grid cols-4" style="margin-bottom:16px">
    <div class="card margin"><h3>এই মাসে সর্বমোট প্রাপ্ত</h3><div class="stat-num">${fmtTaka(thisMonthTotal)}</div><div class="stat-label">${fmtMonth(thisMonth)}</div></div>
  </div>
  <div class="form-grid" style="margin-bottom:16px">
    <label>শ্রেণি
      <select data-role="payment-class-select">
        ${classes.map(c=>`<option value="${c}" ${classFilter===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </label>
    <label>স্টুডেন্ট
      <select data-role="payment-student-select">
        ${studentsInClass.map(s=>`<option value="${s.id}" ${s.id===active?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </label>
  </div>
  <details class="form-card" style="margin-bottom:16px" ${editing?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">${editing?'পেমেন্ট এডিট করুন':'➕ পেমেন্ট রিসিভ মার্ক করুন'}</summary>
    <div style="margin-top:12px">
    <form id="payment-form" data-student="${active}" data-editing="${editing?editing.id:''}">
      <div class="form-grid">
        <label>মাস
          <input name="month" type="month" value="${editing?editing.month:currentMonthValue()}" required />
        </label>
        <label>পরিমাণ (৳)
          <input name="amount" type="number" min="0" step="1" value="${editing?editing.amount:''}" required />
        </label>
        <label class="full">নোট (ঐচ্ছিক)
          <input name="note" placeholder="যেমনঃ নগদে পরিশোধ" value="${editing?(editing.note||''):''}" />
        </label>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px">
        <button class="btn-primary" type="submit">${editing?'সংরক্ষণ করুন':'✅ রিসিভ মার্ক করুন'}</button>
        ${editing?`<button class="btn-ghost" type="button" id="payment-form-cancel">বাতিল</button>`:''}
      </div>
    </form>
    </div>
  </details>
  <div class="section-title"><h3>পেমেন্ট হিস্ট্রি</h3></div>
  ${paymentTableHtml(active, true)}
  `;
}

function renderGuardianPayments(user, forcedStudentId){
  const kids = (user.childIds||[]).map(findUser).filter(Boolean);
  const active = forcedStudentId || state.paymentChildFilter || kids[0]?.id;
  state.paymentChildFilter = active;
  if(!active) return '<div class="empty">কোনো সন্তান লিংক করা নেই।</div>';
  return `
  <div class="grid cols-3" style="margin-bottom:14px">
    ${kids.map(k=>`<button class="btn-sm ${k.id===active?'primary':''}" data-action="pick-guardian-payment" data-id="${k.id}">${k.name}</button>`).join('')}
  </div>
  <div class="section-title"><h3>পেমেন্ট স্লিপ / রিসিট হিস্ট্রি</h3></div>
  ${paymentTableHtml(active, false)}
  `;
}

function renderAdminPayments(user){
  const all = [...payments()].sort((a,b)=>b.month.localeCompare(a.month) || b.receivedDate.localeCompare(a.receivedDate));
  const thisMonth = currentMonthValue();
  const thisMonthTotal = all.filter(p=>p.month===thisMonth).reduce((s,p)=>s+Number(p.amount||0),0);
  return `
  <div class="grid cols-4" style="margin-bottom:16px">
    <div class="card margin"><h3>এই মাসে সর্বমোট আদায়</h3><div class="stat-num">${fmtTaka(thisMonthTotal)}</div><div class="stat-label">সব টিউটর মিলিয়ে — ${fmtMonth(thisMonth)}</div></div>
  </div>
  <table class="table">
    <thead><tr><th>স্টুডেন্ট</th><th>টিউটর</th><th>মাস</th><th>পরিমাণ</th><th>তারিখ</th><th>নোট</th></tr></thead>
    <tbody>
    ${all.map(p=>{
      const s = findUser(p.studentId), t = findUser(p.tutorId);
      return `<tr><td>${s?s.name:'—'}</td><td>${t?t.name:'—'}</td><td>${fmtMonth(p.month)}</td><td>${fmtTaka(p.amount)}</td><td>${fmtDate(p.receivedDate)}</td><td>${p.note||'—'}</td></tr>`;
    }).join('') || `<tr><td colspan="6" class="empty">কোনো পেমেন্ট রেকর্ড নেই।</td></tr>`}
    </tbody>
  </table>`;
}

function renderAssignForm(user, editingTaskId){
  const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
  const classes = [...new Set(myStudents.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  const editing = editingTaskId ? tasks().find(t=>t.id===editingTaskId) : null;
  const stickyTarget = state.stickyAssignTarget || 'student';
  const stickyStudentId = (state.stickyAssignStudentId && myStudents.some(s=>s.id===state.stickyAssignStudentId)) ? state.stickyAssignStudentId : null;
  const stickyClassName = (state.stickyAssignClassName && classes.includes(state.stickyAssignClassName)) ? state.stickyAssignClassName : classes[0];

  function syllabusOptionsForClass(className){
    const items = syllabusForClass(className);
    const bySubj = {};
    items.forEach(it=>(bySubj[it.subject] ||= []).push(it));
    return `<option value="">— কোনোটা নয় —</option>` + Object.keys(bySubj).sort().map(subj=>
      `<optgroup label="${subj}">${bySubj[subj].map(it=>`<option value="${it.id}">${it.title}</option>`).join('')}</optgroup>`
    ).join('');
  }
  const firstStudent = editing ? findUser(editing.studentId) : (stickyStudentId? findUser(stickyStudentId) : myStudents[0]);
  const initialClassForSyllabus = editing ? firstStudent?.className : (stickyTarget==='class' ? stickyClassName : firstStudent?.className);
  const initialSyllabusOptions = syllabusOptionsForClass(initialClassForSyllabus);
  const initialTodayFilter = editing ? null : (stickyTarget==='class' ? {mode:'class', className:stickyClassName} : {mode:'student', studentId: firstStudent?.id});

  return `
  <div class="form-card">
    <h3 style="margin-top:0">${editing? 'পড়া এডিট করুন' : 'নতুন পড়া / টাস্ক দিন'}</h3>
    <form id="assign-form" data-editing="${editingTaskId||''}">
      <div class="form-grid">
        ${editing ? '' : `
        <label>কাকে দিবেন
          <select name="assignTarget" data-role="assign-target">
            <option value="student" ${stickyTarget==='student'?'selected':''}>একজন নির্দিষ্ট শিক্ষার্থী</option>
            <option value="class" ${stickyTarget==='class'?'selected':''}>পুরো শ্রেণি (সবাইকে একসাথে)</option>
          </select>
        </label>`}
        <label id="assign-student-group" ${!editing && stickyTarget==='class' ? 'hidden':''}>স্টুডেন্ট
          <select name="studentId" data-role="assign-student" ${editing?'disabled':''}>
            ${groupedStudentOptionsHtml(myStudents, editing?editing.studentId:stickyStudentId)}
          </select>
        </label>
        <label id="assign-class-group" ${editing || stickyTarget!=='class' ? 'hidden':''}>শ্রেণি
          <select name="className" data-role="assign-class">${classes.map(c=>`<option ${stickyClassName===c?'selected':''}>${c}</option>`).join('')}</select>
        </label>
        <label>বিষয়
          ${subjectSelectHtml(getSubjectsForClass(initialClassForSyllabus), editing?editing.subject:'', {name:'subject', attrs:'required data-role="assign-subject"'})}
        </label>
        <label>ধরন
          <select name="type">
            ${['পড়া','হোমওয়ার্ক','রিভিশন'].map(t=>`<option ${editing&&editing.type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </label>
        <label class="full">অধ্যায় / টপিক
          <input name="chapter" placeholder="অধ্যায়, টপিক, পৃষ্ঠা নম্বর, প্রশ্ন নং উল্লেখ সহ নির্দেশনা দিন" value="${editing?editing.chapter:''}" required />
        </label>
        <label>দেওয়ার তারিখ
          <input name="assignedDate" type="date" value="${editing?editing.assignedDate:(state.stickyAssignedDate||todayISO())}" required />
        </label>
        <label>শেষ করার তারিখ
          <input name="dueDate" type="date" value="${editing?editing.dueDate:''}" placeholder="পড়া আদায় এর তারিখ সিলেক্ট করুন" required />
          ${editing?'':'<span style="font-weight:400; font-size:.76rem; color:var(--text-soft)">পড়া আদায় এর তারিখ সিলেক্ট করুন</span>'}
        </label>
        <label class="full">সিলেবাস আইটেম (ঐচ্ছিক — যুক্ত করলে সিলেবাস অগ্রগতিতে গণনা হবে)
          <select name="syllabusId" data-role="assign-syllabus">${initialSyllabusOptions}</select>
        </label>
        <label class="full">প্রশ্ন / নির্দেশনা (একেক লাইনে একটি)
          <textarea name="questions" placeholder="যেমনঃ পৃ. ৪৫ এর ১-৫ নং অংক কর">${editing?editing.questions:''}</textarea>
        </label>
        <label class="full">📷 ছবি যুক্ত করুন (ঐচ্ছিক — বই/ওয়ার্কশিটের পাতা, হাতে-লেখা নির্দেশনা ইত্যাদি)
          <input type="file" name="assignPhoto" accept="image/*" capture="environment" style="margin-top:5px" />
          ${editing && editing.hasAssignPhoto? '<span style="font-weight:400; font-size:.76rem; color:var(--text-soft)">ইতিমধ্যে একটা ছবি যুক্ত আছে — নতুন ছবি দিলে সেটা বদলে যাবে</span>':''}
        </label>
        <div id="assign-photo-preview" style="grid-column:1/-1"></div>
      </div>
      <div style="margin-top:14px; display:flex; gap:8px">
        <button class="btn-primary" type="submit">${editing? 'সংরক্ষণ করুন' : 'পড়া দিন'}</button>
        ${editing? `<button class="btn-ghost" type="button" id="cancel-edit-task">বাতিল</button>` : ''}
      </div>
    </form>
  </div>
  <div class="section-title"><h3>✍️ আজ যেসব পড়া দেওয়া হয়েছে</h3></div>
  <div id="todays-assigned-list">${todaysAssignedTasksHtml(user, initialTodayFilter)}</div>`;
}

/* current "কাকে দিবেন" selection in the assign-form -> filter for the "today's
   assigned" list below it, so that list always matches who the form is about */
function assignFormTodayFilter(form){
  const targetSel = form.querySelector('[name=assignTarget]');
  const mode = targetSel ? targetSel.value : 'student';
  if(mode==='class') return { mode:'class', className: form.querySelector('[name=className]')?.value };
  return { mode:'student', studentId: form.querySelector('[name=studentId]')?.value };
}
function refreshTodaysAssignedList(form){
  const container = document.getElementById('todays-assigned-list');
  if(!container) return;
  container.innerHTML = todaysAssignedTasksHtml(currentUser(), assignFormTodayFilter(form));
}

function todaysAssignedTasksHtml(user, filter){
  const today = todayISO();
  let items = tasks().filter(t=>t.tutorId===user.id && t.assignedDate===today);
  if(filter){
    if(filter.mode==='student' && filter.studentId) items = items.filter(t=>t.studentId===filter.studentId);
    else if(filter.mode==='class' && filter.className) items = items.filter(t=>findUser(t.studentId)?.className===filter.className);
  }
  if(!items.length) return '<div class="empty">আজ এখনো এই ফিল্টারে কাউকে পড়া দেওয়া হয়নি।</div>';
  if(filter && filter.mode==='class'){
    const deduped = dedupeCommonTasks(items).reverse(); // newest-added first
    return deduped.map(t=>taskRowHtml(t,{showStudent:false, actions: t.__count>1? ()=>'' : tutorTaskActionButtons})).join('');
  }
  items = items.slice().reverse(); // newest-added first
  return items.map(t=>taskRowHtml(t,{showStudent:false, actions: tutorTaskActionButtons})).join('');
}

/* ==========================================================
   GUARDIAN VIEWS
   ========================================================== */
/* অভিভাবক ড্যাশবোর্ড — শিক্ষার্থী অনুসারে আজ/আগামীকাল/পরের ৭ দিনের মধ্যে আদায় হবে এমন পড়া */
function upcomingTasksForStudent(studentId, days=7){
  const start = todayISO();
  const endDt = new Date(); endDt.setDate(endDt.getDate()+days);
  const end = endDt.toISOString().slice(0,10);
  return studentTasks(studentId).filter(t=> effectiveStatus(t)!=='done' && t.dueDate>=start && t.dueDate<=end)
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
}
function guardianUpcomingHtml(studentId){
  const items = upcomingTasksForStudent(studentId, 7);
  if(!items.length) return '<div class="empty">সামনের ৭ দিনে বাকি কোনো পড়া নেই — দারুণ! 🎉</div>';
  const groups = [];
  items.forEach(t=>{
    let g = groups.find(g=>g.dueDate===t.dueDate);
    if(!g){ g = {label: relativeDateLabel(t.dueDate), dueDate: t.dueDate, items:[]}; groups.push(g); }
    g.items.push(t);
  });
  return groups.map(g=>`
    <div class="section-title" style="margin-top:12px; margin-bottom:6px"><h3 style="font-size:.92rem">${g.label}</h3></div>
    ${g.items.map(t=>taskRowHtml(t,{actions:()=>''})).join('')}
  `).join('');
}

function renderGuardianDashboard(user){
  const kids = (user.childIds||[]).map(findUser).filter(Boolean);
  return `
  <div class="grid cols-3">
  ${kids.map(k=>{
    const p = studentProgress(k.id);
    const sp = syllabusOverallPct(k.id);
    const tutor = findUser(k.tutorId);
    const latestFollowup = followupsForStudent(k.id)[0];
    return `<div class="card margin">
      <h3>${k.name} <span style="font-size:.75rem; color:var(--text-soft); font-weight:400">(${k.className||''})</span></h3>
      <div class="stat-label">টাস্ক আদায়</div>
      <div class="progress-bar ${progressBarClass(p.pct)}" style="margin:4px 0 8px"><span style="width:${p.pct}%"></span></div>
      <div class="stat-label">আদায়: ${p.pct}% (${p.done}/${p.total}) · মিস: ${p.missed}টি</div>
      <div class="stat-label" style="margin-top:8px">সিলেবাস সম্পন্ন: ${sp}%</div>
      <div class="stat-label" style="margin-top:6px">টিউটর: ${tutor?tutor.name:'—'}</div>
      ${latestFollowup? `<div class="stat-label" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--paper-line)">📝 সর্বশেষ ফলোআপ (${fmtDateTime(latestFollowup.ts)}): "${latestFollowup.text.slice(0,70)}${latestFollowup.text.length>70?'…':''}"</div>` : ''}
      <button class="btn-sm" style="margin-top:10px" data-action="goto-child-tasks" data-id="${k.id}">টাস্কগুলো দেখুন</button>
      ${tutor?`<button class="btn-sm" style="margin-top:10px" data-action="msg-user" data-id="${tutor.id}">টিউটরকে মেসেজ দিন</button>`:''}
    </div>`;
  }).join('') || '<div class="empty">কোনো সন্তান লিংক করা নেই। প্রশাসককে বলে যুক্ত করান।</div>'}
  </div>
  <div class="section-title"><h3>📅 আসন্ন পড়া (আজ, আগামীকাল ও পরের ৭ দিন)</h3></div>
  ${kids.map(k=>`
    <div class="section-title" style="margin-top:18px"><h3 style="font-size:1rem">${k.name}</h3></div>
    ${guardianUpcomingHtml(k.id)}
  `).join('') || ''}
  `;
}

function renderGuardianChildren(user, focusId){
  const kids = (user.childIds||[]).map(findUser).filter(Boolean);
  const active = focusId || state.guardianActiveChildId || kids[0]?.id;
  if(!active) return '<div class="empty">কোনো সন্তান লিংক করা নেই।</div>';
  return `
  <div class="grid cols-3" style="margin-bottom:14px">
    ${kids.map(k=>`<button class="btn-sm ${k.id===active?'primary':''}" data-action="pick-guardian-child" data-id="${k.id}">${k.name}</button>`).join('')}
  </div>
  <details class="form-card" style="margin-bottom:16px" data-formkey="guardian-task-add" ${state.openForms['guardian-task-add']?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">➕ এক্সট্রা টাস্ক/পড়া যোগ করুন (টিউটরের বাইরে)</summary>
    <div style="margin-top:12px">
      <form id="guardian-task-form" data-student="${active}">
        <div class="form-grid">
          <label>বিষয়
            ${subjectSelectHtml(getSubjectsForClass(findUser(active)?.className), '')}
          </label>
          <label>শেষ করার তারিখ
            <input name="dueDate" type="date" value="${todayISO()}" required />
          </label>
          <label class="full">বিষয়বস্তু/শিরোনাম
            <input name="chapter" placeholder="যেমনঃ কুরআন তিলাওয়াত অনুশীলন" required />
          </label>
          <label class="full">নির্দেশনা (ঐচ্ছিক)
            <textarea name="questions" placeholder="বিস্তারিত লিখুন..."></textarea>
          </label>
        </div>
        <button class="btn-primary" type="submit" style="margin-top:12px">যোগ করুন</button>
      </form>
    </div>
  </details>
  ${guardianTaskTabsHtml(active)}
  ${followupSectionHtml(active, false)}
  `;
}
/* same two tabs as the student dashboard ("শিক্ষকের দেওয়া পড়া" / "পড়া আদায়ের
   শেষ তারিখ অনুযায়ী"), also available on the guardian's ID so a parent can
   browse their child's reading the same two ways. */
function guardianTaskTabsHtml(studentId){
  const tab = state.guardianTaskTab==='due' ? 'due' : 'given';
  const range = state.guardianDashRange || 'week';
  const tabs = [
    ['given','📚 শিক্ষকের দেওয়া পড়া'],
    ['due','📅 পড়া আদায়ের শেষ তারিখ অনুযায়ী'],
  ];
  const opts = { actions: (t,st)=> (st==='done' && !t.__readOnly) ? manageDoneTaskButtonsHtml(t) : '' };
  let ts;
  if(range==='week'){
    ts = studentTasks(studentId);
  } else {
    const bounds = rangeToBounds(range, state.guardianDashCustomFrom, state.guardianDashCustomTo);
    const cacheKey = `guardian-dash:${studentId}:${JSON.stringify(bounds)}`;
    const cached = state.taskRangeCache[cacheKey];
    ts = cached ? markOutOfWindow(cached) : null;
  }
  const tabContent = ts===null
    ? `<div class="empty">লোড হচ্ছে…</div>`
    : (tab==='due' ? rowGroupedByDueDateHtml(ts, opts) : rowGroupedByAssignedDateHtml(ts, opts));
  return `
  <div class="grid cols-2" style="margin-bottom:12px">
    ${tabs.map(([k,l])=>`<button class="btn-sm ${tab===k?'primary':''}" data-action="set-guardian-task-tab" data-id="${k}">${l}</button>`).join('')}
  </div>
  <div class="form-grid" style="margin-bottom:14px">
    <label>সময়কাল
      <select data-role="guardian-dash-range">
        <option value="week" ${range==='week'?'selected':''}>সাপ্তাহিক</option>
        <option value="fortnight" ${range==='fortnight'?'selected':''}>পাক্ষিক</option>
        <option value="month" ${range==='month'?'selected':''}>মাসিক</option>
        <option value="custom" ${range==='custom'?'selected':''}>তারিখ অনুসারে</option>
      </select>
    </label>
    ${range==='custom' ? `
    <label>শুরুর তারিখ
      <input type="date" data-role="guardian-dash-custom-from" value="${state.guardianDashCustomFrom||''}" />
    </label>
    <label>শেষ তারিখ
      <input type="date" data-role="guardian-dash-custom-to" value="${state.guardianDashCustomTo||''}" />
    </label>` : ''}
  </div>
  ${tabContent}
  `;
}

/* ==========================================================
   ADMIN VIEWS
   ========================================================== */
function monthlyCompletionStats(monthsBack=6){
  const now = new Date();
  const stats = [];
  for(let i=monthsBack-1; i>=0; i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = d.toISOString().slice(0,7);
    const monthTasks = tasks().filter(t=>t.assignedDate && t.assignedDate.slice(0,7)===ym);
    const done = monthTasks.filter(t=>effectiveStatus(t)==='done').length;
    const missed = monthTasks.filter(t=>effectiveStatus(t)==='missed').length;
    const total = monthTasks.length;
    stats.push({ ym, label: fmtMonth(ym).split(' ')[0], total, done, missed, pct: total? Math.round(done/total*100):0 });
  }
  return stats;
}
function monthlyChartHtml(){
  const stats = monthlyCompletionStats(6);
  const maxH = 110;
  const anyData = stats.some(s=>s.total>0);
  return `
  <div class="card margin" style="margin-bottom:16px">
    <h3>মাসিক আদায়ের হার (গত ৬ মাস)</h3>
    ${anyData ? `
    <div style="display:flex; align-items:flex-end; gap:12px; height:${maxH+50}px; margin-top:18px; padding:0 4px">
      ${stats.map(s=>`
        <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:0">
          <div style="font-size:.74rem; color:var(--text-soft-strong); font-weight:700">${s.total?s.pct+'%':'—'}</div>
          <div style="width:100%; max-width:38px; height:${s.total?Math.max(6, Math.round(s.pct/100*maxH)):3}px;
            background:${!s.total?'var(--paper-line)':(s.pct>=70?'var(--success)':(s.pct>=40?'var(--warn)':'var(--danger)'))};
            border-radius:6px 6px 2px 2px"></div>
          <div style="font-size:.72rem; color:var(--text-soft-strong); text-align:center; font-weight:600">${s.label}</div>
        </div>`).join('')}
    </div>` : '<div class="empty">এখনো পর্যাপ্ত ডাটা নেই।</div>'}
  </div>`;
}

function renderAdminDashboard(user){
  const st = usersByRole('student'), tu = usersByRole('tutor'), gu = usersByRole('guardian');
  const all = tasks();
  const missedTotal = all.filter(t=>effectiveStatus(t)==='missed').length;
  const donePct = all.length? Math.round(all.filter(t=>effectiveStatus(t)==='done').length/all.length*100):0;
  const worst = st.map(s=>({s, p:studentProgress(s.id)})).sort((a,b)=>a.p.pct-b.p.pct).slice(0,5);
  return `
  <div class="grid cols-4">
    <div class="card margin"><h3>মোট স্টুডেন্ট</h3><div class="stat-num">${st.length}</div></div>
    <div class="card margin"><h3>মোট টিউটর</h3><div class="stat-num">${tu.length}</div></div>
    <div class="card margin"><h3>মোট অভিভাবক</h3><div class="stat-num">${gu.length}</div></div>
    <div class="card margin"><h3>সার্বিক আদায়ের হার</h3><div class="stat-num">${donePct}%</div></div>
  </div>
  ${monthlyChartHtml()}
  <div class="section-title"><h3>যেসব স্টুডেন্ট পিছিয়ে আছে</h3></div>
  <table class="table">
    <thead><tr><th>স্টুডেন্ট</th><th>টিউটর</th><th>আদায়ের হার</th><th>মিস</th><th></th></tr></thead>
    <tbody>
    ${worst.map(({s,p})=>{
      const tutor = findUser(s.tutorId);
      return `<tr>
        <td>${s.name}</td><td>${tutor?tutor.name:'—'}</td>
        <td><div class="progress-bar ${progressBarClass(p.pct)}" style="width:100px; display:inline-block; vertical-align:middle"><span style="width:${p.pct}%"></span></div> ${p.pct}%</td>
        <td style="color:var(--danger); font-weight:700">${p.missed}</td>
        <td>${tutor?`<button class="btn-sm" data-action="msg-user" data-id="${tutor.id}">টিউটরকে গাইড দিন</button>`:''}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" class="empty">কোনো ডাটা নেই</td></tr>`}
    </tbody>
  </table>
  <div style="color:var(--danger); font-size:.85rem; margin-top:14px">মোট মিসড টাস্ক: ${missedTotal}টি</div>
  ${adminDashboardTaskTabsHtml()}
  `;
}

/* ==========================================================
   PROFILE (shared across all roles) — self-service password change
   ========================================================== */
/* ==========================================================
   ADMIN SETTINGS — backup / restore tools live here, deliberately
   tucked away from the everyday user-management screen.
   ========================================================== */
function renderAdminSettings(user){
  return `
  <div class="form-card" style="max-width:520px; margin-bottom:18px">
    <h3 style="margin-top:0">ডাটাবেস ব্যাকআপ</h3>
    <p style="color:var(--text-soft); font-size:.82rem; margin-top:-4px">নিয়মিত ব্যাকআপ ডাউনলোড করে নিরাপদ জায়গায় রাখা ভালো অভ্যাস।</p>
    <button class="btn-outline" type="button" id="backup-download-btn">⬇️ ব্যাকআপ ডাউনলোড করুন</button>
  </div>
  <div class="form-card" style="max-width:520px; border:1px solid var(--danger)">
    <h3 style="margin-top:0; color:var(--danger)">⚠️ ব্যাকআপ থেকে রিস্টোর করুন</h3>
    <p style="color:var(--text-soft); font-size:.82rem; margin-top:-4px">
      এটা করলে বর্তমান সব ডাটা (এই ডিভাইস ও ক্লাউড উভয়ই) মুছে ব্যাকআপ ফাইলের ডাটা দিয়ে প্রতিস্থাপিত হবে —
      সবার ডিভাইসে এই পরিবর্তন ছড়িয়ে যাবে। নিশ্চিত না হলে করবেন না।</p>
    <label class="btn-outline" style="cursor:pointer; display:inline-flex; align-items:center; border-color:var(--danger); color:var(--danger)">
      ⬆️ ব্যাকআপ ফাইল বেছে রিস্টোর করুন
      <input type="file" id="backup-restore-input" accept="application/json" style="display:none" />
    </label>
  </div>`;
}

function downloadBackup(){
  const backup = {
    exportedAt: new Date().toISOString(),
    users: users(), tasks: tasks(), messages: msgs(), notifications: notifs(),
    syllabus: syllabus(), routine: routine(), followups: followups(), payments: payments(),
    photos: getPhotoMap(), subjects: subjectList()
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `porar-khata-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('ব্যাকআপ ডাউনলোড হয়েছে ⬇️','success');
}

function renderProfile(user){
  return `
  <div class="card margin" style="max-width:420px; margin-bottom:18px">
    <h3>আমার তথ্য</h3>
    <div class="stat-label" style="margin-top:8px">নাম: <b style="color:var(--text)">${user.name}</b></div>
    <div class="stat-label" style="margin-top:4px">ইউজারনেম: <b style="color:var(--text)">${user.username}</b></div>
    <div class="stat-label" style="margin-top:4px">রোল: <span class="pill ${user.role}">${ROLE_LABEL[user.role]}</span></div>
    ${user.role==='student' && user.className? `<div class="stat-label" style="margin-top:4px">শ্রেণি: <b style="color:var(--text)">${user.className}</b></div>`:''}
    ${user.phone? `<div class="stat-label" style="margin-top:4px">মোবাইল: <b style="color:var(--text)">${user.phone}</b></div>`:''}
  </div>
  <div class="form-card" style="max-width:420px">
    <h3 style="margin-top:0">পাসওয়ার্ড পরিবর্তন করুন</h3>
    <form id="change-password-form">
      <div class="form-grid">
        <label class="full">বর্তমান পাসওয়ার্ড<input type="password" name="current" required /></label>
        <label class="full">নতুন পাসওয়ার্ড<input type="password" name="new1" required minlength="2" /></label>
        <label class="full">নতুন পাসওয়ার্ড আবার লিখুন<input type="password" name="new2" required minlength="2" /></label>
      </div>
      <button class="btn-primary" type="submit" style="margin-top:12px">পাসওয়ার্ড পরিবর্তন করুন</button>
    </form>
  </div>`;
}

function renderSyllabusManager(user){
  const byClassSubj = syllabusByClassSubject();
  const filterClass = state.syllabusClassFilter || Object.keys(byClassSubj).sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b))[0] || CLASSES[0];
  const editing = state.editingSyllabusId ? syllabus().find(s=>s.id===state.editingSyllabusId) : null;
  const subjectManageClass = state.subjectManageClass || CLASSES[0];
  const syllabusFormClass = editing ? editing.className : (state.stickySyllabusClass || CLASSES[0]);
  return `
  <details class="form-card" style="margin-bottom:16px" data-formkey="subject-manage" ${state.openForms['subject-manage']?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">📚 বিষয়/সাবজেক্ট ব্যবস্থাপনা (শ্রেণিভিত্তিক — নতুন বিষয় যোগ/মুছুন)</summary>
    <div style="margin-top:12px">
      <form id="subject-form" style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end">
        <label style="min-width:160px">শ্রেণি
          <select name="className">${CLASSES.map(c=>`<option ${subjectManageClass===c?'selected':''}>${c}</option>`).join('')}</select>
        </label>
        <label style="flex:1; min-width:180px">নতুন বিষয়ের নাম
          <input name="subjectName" placeholder="যেমনঃ চারু ও কারুকলা" required />
        </label>
        <button class="btn-primary" type="submit">যোগ করুন</button>
      </form>
      <div style="margin-top:12px; display:flex; gap:6px; flex-wrap:wrap">
        ${getSubjectsForClass(subjectManageClass).map(s=>`<span class="subject-chip" style="display:inline-flex; align-items:center; gap:6px">${s}
          <button data-action="delete-subject" data-id="${s}" data-class="${subjectManageClass}" style="background:none;border:none;color:#fff;cursor:pointer;font-weight:700">✕</button></span>`).join('')}
      </div>
    </div>
  </details>
  <div class="form-card" style="margin-bottom:20px">
    <h3 style="margin-top:0">${editing? 'সিলেবাস আইটেম এডিট করুন' : 'সিলেবাসে নতুন অধ্যায়/টপিক যোগ করুন'}</h3>
    <p style="color:var(--text-soft); font-size:.82rem; margin-top:-4px">
      এখানে যোগ করা আইটেমগুলো "পড়া দিন" ফর্মে বেছে নেওয়া যাবে, যাতে সেটা সম্পন্ন হলে
      সেই শ্রেণির স্টুডেন্টের সিলেবাস অগ্রগতিতে স্বয়ংক্রিয়ভাবে যোগ হয়ে যায়।</p>
    <form id="syllabus-form" data-editing="${editing?editing.id:''}">
      <div class="form-grid">
        <label>শ্রেণি
          <select name="className">${CLASSES.map(c=>`<option ${syllabusFormClass===c?'selected':''}>${c}</option>`).join('')}</select>
        </label>
        <label>বিষয়
          ${subjectSelectHtml(getSubjectsForClass(syllabusFormClass), editing?editing.subject:(state.stickySyllabusSubject||''), {name:'subject'})}
        </label>
        <label class="full">অধ্যায়/টপিকের নাম
          <input name="title" placeholder="যেমনঃ অধ্যায় ৮ — পরিমাপ" value="${editing?editing.title:''}" required />
        </label>
      </div>
      <div style="margin-top:12px; display:flex; gap:8px">
        <button class="btn-primary" type="submit">${editing?'সংরক্ষণ করুন':'যোগ করুন'}</button>
        ${editing? `<button class="btn-ghost" type="button" id="syllabus-form-cancel">বাতিল</button>` : ''}
      </div>
    </form>
  </div>
  <div class="section-title"><h3>বিদ্যমান সিলেবাস</h3></div>
  <div class="grid cols-4" style="margin-bottom:14px">
    ${CLASSES.filter(c=>byClassSubj[c]).map(c=>`<button class="btn-sm ${filterClass===c?'primary':''}" data-action="filter-syllabus-class" data-id="${c}">${c}</button>`).join('')}
  </div>
  ${byClassSubj[filterClass] ? Object.keys(byClassSubj[filterClass]).sort().map(subj=>`
    <div class="card margin" style="margin-bottom:14px">
      <h3>${subj}</h3>
      <table class="table" style="margin-top:8px">
        <tbody>
        ${byClassSubj[filterClass][subj].map(it=>`<tr><td>${it.title}</td>
          <td style="width:150px; white-space:nowrap">
            <button class="btn-sm" data-action="edit-syllabus" data-id="${it.id}">এডিট</button>
            <button class="btn-sm danger" data-action="delete-syllabus" data-id="${it.id}">মুছুন</button>
          </td></tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('') : '<div class="empty">এই শ্রেণির জন্য এখনো কোনো সিলেবাস আইটেম যোগ করা হয়নি।</div>'}
  `;
}

function renderAdduserChildrenPicker(){
  const selectedIds = state.adduserSelectedChildIds || [];
  const selectedStudents = selectedIds.map(findUser).filter(Boolean);
  const allStudents = usersByRole('student');
  const classes = [...new Set(allStudents.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  const classFilter = state.adduserChildClassFilter && classes.includes(state.adduserChildClassFilter) ? state.adduserChildClassFilter : 'all';
  const availableInClass = allStudents.filter(s=> !selectedIds.includes(s.id) && (classFilter==='all' || s.className===classFilter));

  return `
  <div class="grid cols-4" style="margin-bottom:8px">
    <button type="button" class="btn-sm ${classFilter==='all'?'primary':''}" data-action="adduser-child-classfilter" data-id="all">সব শ্রেণি</button>
    ${classes.map(c=>`<button type="button" class="btn-sm ${classFilter===c?'primary':''}" data-action="adduser-child-classfilter" data-id="${c}">${c}</button>`).join('')}
  </div>
  <div class="card margin" style="max-height:180px; overflow:auto; margin-bottom:8px">
    ${availableInClass.length ? availableInClass.map(s=>`<button type="button" class="btn-sm" style="margin:2px" data-action="adduser-child-add" data-id="${s.id}">+ ${s.name} (${s.className||'—'})</button>`).join('') : '<div class="empty">এই ফিল্টারে বাকি কোনো শিক্ষার্থী নেই।</div>'}
  </div>
  <div class="stat-label" style="margin-bottom:4px">নির্বাচিত সন্তানরা (${selectedStudents.length})</div>
  <div class="card margin">
    ${selectedStudents.length ? selectedStudents.map(s=>`<span class="pill student" style="margin:2px; display:inline-flex; align-items:center; gap:6px">${s.name} (${s.className||'—'}) <button type="button" data-action="adduser-child-remove" data-id="${s.id}" style="border:none; background:none; cursor:pointer; color:inherit; font-weight:700">✕</button></span>`).join('') : '<div class="empty">এখনো কোনো সন্তান নির্বাচন করা হয়নি।</div>'}
  </div>
  ${selectedIds.map(id=>`<input type="hidden" name="childIds" value="${id}">`).join('')}
  `;
}
function refreshAdduserChildrenPicker(){
  const el = document.getElementById('adduser-children-picker');
  if(el) el.innerHTML = renderAdduserChildrenPicker();
}

function renderAdminUsers(user){
  const all = users();
  const editing = state.editingUserId ? findUser(state.editingUserId) : null;
  const roleFilter = state.adminUserRoleFilter || 'all';
  const studentClasses = [...new Set(all.filter(u=>u.role==='student').map(u=>u.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
  const classFilter = state.adminUserClassFilter && studentClasses.includes(state.adminUserClassFilter) ? state.adminUserClassFilter : 'all';
  const filtered = all.filter(u => (roleFilter==='all'||u.role===roleFilter) && (classFilter==='all' || u.className===classFilter));
  const defaultRole = editing ? editing.role : (state.stickyAdduserRole || 'student');
  const roleForVisibility = defaultRole;
  const defaultAdduserClass = editing ? editing.className : (state.stickyAdduserClassName || CLASSES[0]);

  return `
  <details class="form-card" style="margin-bottom:20px" data-formkey="adduser-add" ${(editing || state.openForms['adduser-add'])?'open':''}>
    <summary style="cursor:pointer; font-weight:700; color:var(--ink)">${editing? `${editing.name} — এডিট করুন` : '➕ নতুন ইউজার যোগ করুন'}</summary>
    <div style="margin-top:12px">
    <form id="adduser-form" data-editing="${editing?editing.id:''}">
      <div class="form-grid">
        <label>নাম<input name="name" value="${editing?editing.name:''}" required /></label>
        <label>রোল
          <select name="role" id="adduser-role" ${editing?'disabled':''}>
            <option value="student" ${defaultRole==='student'?'selected':''}>ছাত্র/ছাত্রী</option>
            <option value="tutor" ${defaultRole==='tutor'?'selected':''}>টিউটর</option>
            <option value="guardian" ${defaultRole==='guardian'?'selected':''}>অভিভাবক</option>
            <option value="admin" ${defaultRole==='admin'?'selected':''}>প্রশাসক</option>
          </select>
        </label>
        <label id="adduser-phone-wrap" ${roleForVisibility==='student'?'hidden':''}>মোবাইল নম্বর
          <input name="phone" data-role="adduser-phone" value="${editing?(editing.phone||''):''}" placeholder="যেমনঃ 01712345678" />
        </label>
        <label id="adduser-nickname-wrap" ${roleForVisibility!=='student'?'hidden':''}>ডাকনাম
          <input name="nickname" data-role="adduser-nickname" value="${editing?(editing.nickname||''):''}" placeholder="যেমনঃ আরিয়ান" />
        </label>
        <label id="adduser-class-wrap" ${roleForVisibility!=='student'?'hidden':''}>শ্রেণি
          <select name="className" data-role="adduser-class">${CLASSES.map(c=>`<option ${(editing?editing.className===c:defaultAdduserClass===c)?'selected':''}>${c}</option>`).join('')}</select>
        </label>
        <label>ইউজারনেম<input name="username" data-role="adduser-username" value="${editing?editing.username:''}" required /></label>
        <label>পাসওয়ার্ড
          <input name="password" type="password" data-role="adduser-password" value="${editing? '' : '1234'}" placeholder="${editing? 'পরিবর্তন করতে না চাইলে খালি রাখুন' : ''}" ${editing?'':'required'} />
          ${editing? '' : `<span style="font-weight:400; font-size:.76rem; color:var(--text-soft)">ডিফল্ট পাসওয়ার্ড: 1234 (চাইলে বদলে দিন)</span>`}
        </label>
        ${editing? `<label style="justify-content:flex-end">&nbsp;
          <button class="btn-sm" type="button" id="adduser-reset-password">🔑 ডিফল্ট পাসওয়ার্ডে রিসেট করুন</button>
        </label>` : ''}
        <label class="full" id="adduser-link-wrap" ${roleForVisibility!=='student'?'hidden':''}>টিউটর লিংক করুন (স্টুডেন্টের জন্য)
          <select name="tutorId">
            <option value="">— নেই —</option>
            ${usersByRole('tutor').map(t=>`<option value="${t.id}" ${editing&&editing.tutorId===t.id?'selected':''}>${t.name}</option>`).join('')}
          </select>
        </label>
        <label class="full" id="adduser-children-wrap" ${roleForVisibility!=='guardian'?'hidden':''}>সন্তানরা
          <div id="adduser-children-picker">${renderAdduserChildrenPicker()}</div>
        </label>
      </div>
      <div style="margin-top:14px; display:flex; gap:8px">
        <button class="btn-primary" type="submit">${editing?'সংরক্ষণ করুন':'যোগ করুন'}</button>
        ${editing?`<button class="btn-ghost" type="button" id="adduser-form-cancel">বাতিল</button>`:''}
      </div>
    </form>
    </div>
  </details>

  <div class="section-title"><h3>সকল ইউজার (${filtered.length}/${all.length})</h3></div>
  <div class="grid cols-4" style="margin-bottom:10px">
    <button class="btn-sm ${roleFilter==='all'?'primary':''}" data-action="filter-admin-users-role" data-id="all">সবাই</button>
    <button class="btn-sm ${roleFilter==='student'?'primary':''}" data-action="filter-admin-users-role" data-id="student">ছাত্র/ছাত্রী</button>
    <button class="btn-sm ${roleFilter==='tutor'?'primary':''}" data-action="filter-admin-users-role" data-id="tutor">টিউটর</button>
    <button class="btn-sm ${roleFilter==='guardian'?'primary':''}" data-action="filter-admin-users-role" data-id="guardian">অভিভাবক</button>
    <button class="btn-sm ${roleFilter==='admin'?'primary':''}" data-action="filter-admin-users-role" data-id="admin">প্রশাসক</button>
  </div>
  ${studentClasses.length ? `<div class="grid cols-4" style="margin-bottom:14px">
    <button class="btn-sm ${classFilter==='all'?'primary':''}" data-action="filter-admin-users-class" data-id="all">সব শ্রেণি</button>
    ${studentClasses.map(c=>`<button class="btn-sm ${classFilter===c?'primary':''}" data-action="filter-admin-users-class" data-id="${c}">${c}</button>`).join('')}
  </div>` : ''}
  <table class="table">
    <thead><tr><th>নাম</th><th>রোল</th><th>ইউজারনেম</th><th>বিস্তারিত</th><th></th></tr></thead>
    <tbody>
    ${filtered.map(u=>`<tr>
      <td>${u.name}</td>
      <td><span class="pill ${u.role}">${ROLE_LABEL[u.role]}</span></td>
      <td>${u.username}</td>
      <td>${u.role==='student'? `শ্রেণি: ${u.className||'—'} · টিউটর: ${findUser(u.tutorId)?.name||'—'} · অভিভাবক: ${findUser(u.guardianId)?.name||'—'}`
          : u.role==='tutor'? `স্টুডেন্ট: ${(u.studentIds||[]).length}টি${u.phone?' · ফোন: '+u.phone:''}`
          : u.role==='guardian'? `সন্তান: ${(u.childIds||[]).length}টি${u.phone?' · ফোন: '+u.phone:''}` : (u.phone?'ফোন: '+u.phone:'—')}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm" data-action="edit-user" data-id="${u.id}">এডিট</button>
        <button class="btn-sm danger" data-action="remove-user" data-id="${u.id}">মুছুন</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">এই ফিল্টারে কোনো ইউজার নেই।</td></tr>`}
    </tbody>
  </table>`;
}

/* ==========================================================
   MESSAGES (shared across roles)
   ========================================================== */
function contactsFor(user){
  if(user.role==='student'){
    const list=[]; const tutor=findUser(user.tutorId); const guardian=findUser(user.guardianId);
    if(tutor) list.push(tutor); if(guardian) list.push(guardian); return list;
  }
  if(user.role==='tutor') return (user.studentIds||[]).map(findUser).filter(Boolean).concat(
      (user.studentIds||[]).map(id=>findUser(findUser(id)?.guardianId)).filter(Boolean));
  if(user.role==='guardian'){
    const kids=(user.childIds||[]).map(findUser).filter(Boolean);
    const tutors = kids.map(k=>findUser(k.tutorId)).filter(Boolean);
    return [...kids, ...tutors];
  }
  if(user.role==='admin') return users().filter(u=>u.id!==user.id);
  return [];
}
function convo(a,b){ return msgs().filter(m=>(m.from===a&&m.to===b)||(m.from===b&&m.to===a)).sort((x,y)=>x.ts-y.ts); }

function broadcastStudentsFor(user){
  if(user.role==='admin') return usersByRole('student');
  if(user.role==='tutor') return (user.studentIds||[]).map(findUser).filter(Boolean);
  return [];
}
function broadcastClassesFor(user){
  const students = broadcastStudentsFor(user);
  return [...new Set(students.map(s=>s.className).filter(Boolean))].sort((a,b)=>CLASSES.indexOf(a)-CLASSES.indexOf(b));
}
function broadcastTargetsFor(user){
  if(user.role==='admin') return [['all','সবাই'],['student','সব ছাত্র/ছাত্রী'],['tutor','সব টিউটর'],['guardian','সব অভিভাবক']];
  if(user.role==='tutor') return [['all','সবাই (আমার স্টুডেন্ট + অভিভাবক)'],['students','শুধু আমার স্টুডেন্টরা'],['guardians','শুধু অভিভাবকরা']];
  return [];
}
function broadcastTargetOptionsHtml(user, classFilter){
  if(!classFilter || classFilter==='all'){
    return broadcastTargetsFor(user).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  }
  const classStudents = broadcastStudentsFor(user).filter(s=>s.className===classFilter);
  return `<option value="classAll:${classFilter}">${classFilter} — সবাইকে (${classStudents.length}জন)</option>`
    + classStudents.map(s=>`<option value="student:${s.id}">${s.name}</option>`).join('');
}
function broadcastRecipients(user, target){
  if(target && target.startsWith('student:')){
    const s = findUser(target.slice('student:'.length));
    return s ? [s] : [];
  }
  if(target && target.startsWith('classAll:')){
    const className = target.slice('classAll:'.length);
    return broadcastStudentsFor(user).filter(s=>s.className===className);
  }
  if(user.role==='admin'){
    if(target==='all') return users().filter(u=>u.id!==user.id);
    return usersByRole(target);
  }
  if(user.role==='tutor'){
    const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
    const myGuardians = [...new Set(myStudents.map(s=>s.guardianId).filter(Boolean))].map(findUser).filter(Boolean);
    if(target==='students') return myStudents;
    if(target==='guardians') return myGuardians;
    return [...myStudents, ...myGuardians];
  }
  return [];
}
function renderBroadcastForm(user){
  const classes = broadcastClassesFor(user);
  const classFilter = state.broadcastClassFilter && classes.includes(state.broadcastClassFilter) ? state.broadcastClassFilter : 'all';
  return `
  <div class="form-card">
    <h3 style="margin-top:0">একাধিকজনকে বার্তা পাঠান</h3>
    <form id="broadcast-form">
      <div class="form-grid">
        ${classes.length ? `<label>শ্রেণি (ঐচ্ছিক ফিল্টার)
          <select name="classFilter" data-role="broadcast-classfilter">
            <option value="all" ${classFilter==='all'?'selected':''}>— সব শ্রেণি —</option>
            ${classes.map(c=>`<option value="${c}" ${classFilter===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </label>` : ''}
        <label class="full">কাদের পাঠাবেন
          <select name="target" data-role="broadcast-target">${broadcastTargetOptionsHtml(user, classFilter)}</select>
        </label>
        <label class="full">বার্তা
          <textarea name="text" placeholder="আপনার বার্তা লিখুন..." required></textarea>
        </label>
      </div>
      <button class="btn-primary" type="submit" style="margin-top:12px">📢 পাঠান</button>
    </form>
  </div>`;
}

function renderMessages(user){
  const canBroadcast = user.role==='admin' || user.role==='tutor';
  const mode = canBroadcast ? (state.messagesMode || 'individual') : 'individual';
  const modeToggle = canBroadcast ? `
  <div class="grid cols-2" style="margin-bottom:12px">
    <button class="btn-sm ${mode==='individual'?'primary':''}" data-action="set-message-mode" data-id="individual">💬 একজনকে বার্তা</button>
    <button class="btn-sm ${mode==='broadcast'?'primary':''}" data-action="set-message-mode" data-id="broadcast">📢 একাধিকজনকে (ব্রডকাস্ট)</button>
  </div>` : '';

  if(mode==='broadcast'){ return modeToggle + renderBroadcastForm(user); }

  const contacts = contactsFor(user);
  const uniq = [...new Map(contacts.map(c=>[c.id,c])).values()];
  const availableRoles = [...new Set(uniq.map(c=>c.role))];
  const roleFilter = state.messageRoleFilter && availableRoles.includes(state.messageRoleFilter) ? state.messageRoleFilter : 'all';
  const filtered = roleFilter==='all' ? uniq : uniq.filter(c=>c.role===roleFilter);

  const active = state.chatWith && filtered.find(c=>c.id===state.chatWith) ? state.chatWith : filtered[0]?.id;
  state.chatWith = active;

  const roleTabsHtml = availableRoles.length>1 ? `
  <div class="grid cols-4" style="margin-bottom:12px">
    <button class="btn-sm ${roleFilter==='all'?'primary':''}" data-action="filter-message-role" data-id="all">সবাই</button>
    ${availableRoles.map(r=>`<button class="btn-sm ${roleFilter===r?'primary':''}" data-action="filter-message-role" data-id="${r}">${ROLE_LABEL[r]}</button>`).join('')}
  </div>` : '';

  if(!filtered.length) return modeToggle + roleTabsHtml + '<div class="empty">এই ফিল্টারে কোনো পরিচিতি নেই।</div>';
  if(!active) return modeToggle + roleTabsHtml + '<div class="empty">কোনো পরিচিতি নেই।</div>';

  const messages = convo(user.id, active);
  const other = findUser(active);
  return `
  ${modeToggle}
  ${roleTabsHtml}
  <div class="chat-wrap">
    <div class="chat-list">
      ${filtered.map(c=>`<div class="chat-contact ${c.id===active?'active':''}" data-action="open-chat" data-id="${c.id}">
        <b>${c.name}</b><br/><span class="pill ${c.role}" style="margin-top:4px">${ROLE_LABEL[c.role]}</span></div>`).join('')}
    </div>
    <div class="chat-panel">
      <div class="chat-msgs" id="chat-msgs">
        ${messages.map(m=>`<div class="msg ${m.from===user.id?'me':'them'}">${m.text}<span class="t">${fmtDateTime(m.ts)}</span></div>`).join('') || '<div class="empty">কোনো বার্তা নেই, প্রথম বার্তা পাঠান।</div>'}
      </div>
      <form class="chat-input" id="chat-form">
        <input type="text" id="chat-text" placeholder="${other.name}-কে বার্তা লিখুন…" autocomplete="off" required />
        <button class="btn-primary" type="submit">পাঠান</button>
      </form>
    </div>
  </div>`;
}

/* ==========================================================
   NOTIFICATIONS
   ========================================================== */
function addNotification(userId, text, type='info'){
  const n = notifs(); n.push({id:uid('n'), userId, text, ts:Date.now(), read:false, type}); saveNotifs(n);
}
/* ---------- notification sound ---------- */
let audioCtx = null;
let lastUnreadCount = -1; // -1 = not measured yet, so first render never "surprises" with a sound
function soundEnabled(){ return DB.get('pk_sound_enabled', true); }
function ensureAudioCtx(){
  if(audioCtx) return audioCtx;
  try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ return null; }
  return audioCtx;
}
// Unlock audio on the first user interaction (browsers block audio before a gesture).
document.addEventListener('click', function unlockAudioOnce(){
  ensureAudioCtx();
  document.removeEventListener('click', unlockAudioOnce);
}, { once:true });

function playNotificationSound(){
  if(!soundEnabled()) return;
  const ctx = ensureAudioCtx();
  if(!ctx) return;
  if(ctx.state === 'suspended') ctx.resume().catch(()=>{});
  const now = ctx.currentTime;
  [[880, now, 0.11], [1175, now+0.11, 0.13]].forEach(([freq, start, dur])=>{
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start+0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start+dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(start); osc.stop(start+dur+0.02);
  });
  if(navigator.vibrate) try{ navigator.vibrate(60); }catch(e){}
}

function toggleSound(){
  const enabled = !soundEnabled();
  DB.set('pk_sound_enabled', enabled);
  updateSoundBadge();
  if(enabled) playNotificationSound();
}
function updateSoundBadge(){
  const btn = document.getElementById('sound-toggle-btn');
  if(!btn) return;
  btn.textContent = soundEnabled() ? '🔊' : '🔇';
  btn.title = soundEnabled() ? 'নোটিফিকেশন সাউন্ড চালু — বন্ধ করতে চাপুন' : 'নোটিফিকেশন সাউন্ড বন্ধ — চালু করতে চাপুন';
}

/* ---------- push (system) notifications ----------
   Note: this uses the browser's local Notification API, triggered whenever
   our live Firestore listener sees new data — it works while the app/tab is
   open in the background (minimized, another tab, phone screen locked with
   the PWA still running). It is NOT the same as true server-push (which
   would keep working even after the browser/app is fully closed for a long
   time) — that needs Firebase Cloud Functions, which requires the paid
   Blaze plan. This free version covers the common case at no cost. */
function pushSupported(){ return typeof Notification !== 'undefined'; }
function updatePushBadge(){
  const btn = document.getElementById('push-toggle-btn');
  if(!btn) return;
  if(!pushSupported()){ btn.hidden = true; return; }
  const perm = Notification.permission;
  // Only show this icon while there's actually a decision to make (permission not
  // yet asked). Once the person has granted or denied it, having a second bell
  // icon sitting in the topbar forever just adds clutter — the real notification
  // bell (🔔 with the unread badge) is enough from that point on.
  if(perm==='default'){
    btn.hidden = false;
    btn.textContent='🔔?'; btn.title='পুশ নোটিফিকেশন চালু করতে চাপুন';
  } else {
    btn.hidden = true;
  }
}
async function togglePush(){
  if(!pushSupported()) return;
  const perm = Notification.permission;
  if(perm==='granted'){ toast('পুশ নোটিফিকেশন ইতিমধ্যে চালু আছে।'); return; }
  if(perm==='denied'){ toast('ব্রাউজারের সেটিংস থেকে ম্যানুয়ালি অনুমতি দিতে হবে।','warn'); return; }
  try{
    const result = await Notification.requestPermission();
    updatePushBadge();
    if(result==='granted'){
      toast('পুশ নোটিফিকেশন চালু হয়েছে ✅','success');
      showSystemNotification('পড়ার খাতা', 'নোটিফিকেশন চালু হয়েছে — এখন থেকে নতুন কিছু এলে জানানো হবে।');
    }
  }catch(e){ /* ignore */ }
}
async function showSystemNotification(title, body, data){
  if(!pushSupported() || Notification.permission!=='granted') return;
  try{
    if('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg){ reg.showNotification(title, { body, icon:'icons/icon-192.png', badge:'icons/icon-192.png', data }); return; }
    }
    new Notification(title, { body, icon:'icons/icon-192.png', data });
  }catch(e){ /* ignore — notifications are a nice-to-have, never block the app on failure */ }
}
/* which in-app screen a notification should jump to when tapped, per role */
function viewForNotifType(user, type){
  if(type==='msg') return 'messages';
  if(type==='payment') return 'payments';
  if(type==='task' || type==='done'){
    if(user.role==='student') return 'dashboard'; // "আজকের পড়া" module removed — the given/due tabs now live on the dashboard
    if(user.role==='guardian') return 'children';
    if(user.role==='tutor') return 'students';
  }
  return 'dashboard';
}

function renderNotifBell(){
  const user = currentUser(); if(!user) return;
  const mine = notifs().filter(n=>n.userId===user.id).sort((a,b)=>b.ts-a.ts);
  const unread = mine.filter(n=>!n.read).length;
  if(lastUnreadCount>-1 && unread>lastUnreadCount){
    const newest = mine[0];
    const hasRealPush = pushSupported() && Notification.permission==='granted';
    if(newest) showSystemNotification('পড়ার খাতা', newest.text, { view: viewForNotifType(user, newest.type) });
    // If real device push notifications are on, let the OS play its own set
    // notification tone (that's the "real" device sound) — don't also play our
    // synthesized beep on top of it. Only fall back to the synthesized beep
    // when push isn't available/permitted.
    if(!hasRealPush) playNotificationSound();
  }
  lastUnreadCount = unread;
  const countEl = document.getElementById('notif-count');
  countEl.hidden = unread===0; countEl.textContent = unread;
  const panel = document.getElementById('notif-panel');
  panel.innerHTML = mine.slice(0,20).map(n=>`<div class="notif-item" data-action="goto-notif" data-id="${n.id}">${n.text}<span class="t">${fmtDateTime(n.ts)}</span></div>`).join('') || '<div class="notif-item">কোনো নোটিফিকেশন নেই।</div>';
}
document.getElementById('sound-toggle-btn').addEventListener('click', toggleSound);
document.getElementById('push-toggle-btn').addEventListener('click', togglePush);

document.getElementById('notif-btn').addEventListener('click', ()=>{
  const panel = document.getElementById('notif-panel');
  panel.hidden = !panel.hidden;
  if(!panel.hidden){
    const user = currentUser();
    const all = notifs().map(n=> n.userId===user.id ? {...n, read:true} : n);
    saveNotifs(all);
    renderNotifBell();
  }
});
document.getElementById('notif-panel').addEventListener('click', (e)=>{
  const item = e.target.closest('[data-action="goto-notif"]');
  if(!item) return;
  const user = currentUser(); if(!user) return;
  const n = notifs().find(x=>x.id===item.dataset.id);
  document.getElementById('notif-panel').hidden = true;
  state.view = n ? viewForNotifType(user, n.type) : 'dashboard';
  buildNav();
  renderView();
});
document.addEventListener('click',(e)=>{
  const panel = document.getElementById('notif-panel');
  if(!panel.hidden && !panel.contains(e.target) && e.target.id!=='notif-btn') panel.hidden = true;
});

/* ==========================================================
   EVENT DELEGATION (actions inside #view + forms)
   ========================================================== */
// track manually opened/closed "➕ যোগ করুন" details panels so they can stay open across
// re-renders within the same screen (see renderView's openForms reset above)
document.getElementById('view').addEventListener('toggle', (e)=>{
  const d = e.target;
  if(d && d.tagName==='DETAILS' && d.dataset.formkey){ state.openForms[d.dataset.formkey] = d.open; }
}, true);

document.getElementById('view').addEventListener('click', async (e)=>{
  // tap-to-reveal: routine subjects / revision rows keep their edit-delete-remind
  // icons hidden until tapped, so the list stays compact on small screens.
  const revealEl = e.target.closest && e.target.closest('[data-tap-reveal]');
  if(revealEl && !e.target.closest('[data-action]')){
    const wasOpen = revealEl.classList.contains('revealed');
    document.querySelectorAll('[data-tap-reveal].revealed').forEach(el=>{ if(el!==revealEl) el.classList.remove('revealed'); });
    revealEl.classList.toggle('revealed', !wasOpen);
    return;
  }
  const btn = e.target.closest('[data-action]');
  const action = btn ? btn.dataset.action : null;
  const id = btn ? btn.dataset.id : null;
  const cls = btn ? btn.dataset.class : null;
  const user = currentUser();

  if(action==='start-complete'){
    state.completingTaskId = id;
    state.completingStatus = btn.dataset.status;
    renderView();
  }
  if(action==='view-photo'){ loadAndShowPhoto(id, btn); }
  if(action==='goto-student-tasks'){ state.view='students'; state.tutorClassFilter='all'; state.tutorStudentFilter=id; state.editingStudentId=null; renderView(); }
  if(action==='pick-tutor-student'){ state.tutorStudentFilter = id || null; renderView(); }
  if(action==='filter-tutor-class'){ state.tutorClassFilter = id; state.tutorStudentFilter = null; renderView(); }
  if(action==='edit-student'){ state.editingStudentId = id; renderView(); }
  if(action==='remove-student'){
    const s = findUser(id);
    if(confirm(`${s.name}-কে সম্পূর্ণ মুছে ফেলবেন? এর সব টাস্ক, রুটিন ও নোটিফিকেশনও মুছে যাবে। এটা ফিরিয়ে আনা যাবে না।`)){
      deleteUserCascade(id);
      toast('শিক্ষার্থী মুছে ফেলা হয়েছে','warn');
      state.tutorStudentFilter=null;
      renderView();
    }
  }
  if(action==='edit-task'){ state.view='assign'; state.editingTaskId = id; renderView(); }
  if(action==='goto-assign-for'){
    state.view='assign'; state.editingTaskId=null;
    state.stickyAssignTarget='student'; state.stickyAssignStudentId=id;
    renderView();
  }
  if(action==='delete-task'){
    if(confirm('এই পড়া/টাস্কটা মুছে ফেলবেন?')){
      saveTasks(tasks().filter(t=>t.id!==id));
      const map = getPhotoMap(); delete map[id]; delete map[id+'_given']; setPhotoMapLocal(map);
      toast('টাস্ক মুছে ফেলা হয়েছে','warn');
      renderView();
    }
  }
  if(action==='goto-child-tasks'){
    state.view='children'; state.guardianActiveChildId = id;
    renderView();
    await triggerGuardianDashRangeFetch(id);
    renderView();
  }
  if(action==='pick-guardian-child'){
    state.guardianActiveChildId = id;
    renderView();
    await triggerGuardianDashRangeFetch(id);
    renderView();
  }
  if(action==='pick-guardian-routine'){ document.getElementById('view').innerHTML = renderGuardianRoutine(user, id); }
  if(action==='pick-tutor-routine'){ state.tutorRoutineStudent = id; state.editingRoutineId=null; renderView(); }
  if(action==='pick-admin-routine'){ state.adminRoutineStudent = id; state.editingRoutineId=null; renderView(); }
  if(action==='edit-routine'){ state.editingRoutineId = id; renderView(); }
  if(action==='delete-routine'){
    if(confirm('এই রুটিন এন্ট্রি মুছে ফেলবেন?')){
      saveRoutine(routine().filter(r=>r.id!==id));
      toast('রুটিন থেকে সরানো হয়েছে','warn');
      renderView();
    }
  }
  if(action==='delete-followup'){
    if(confirm('এই ফলোআপ নোটটা মুছে ফেলবেন?')){
      saveFollowups(followups().filter(f=>f.id!==id));
      toast('নোট মুছে ফেলা হয়েছে','warn');
      renderView();
    }
  }
  if(action==='pick-payment-student'){ state.paymentStudentFilter = id; state.editingPaymentId=null; renderView(); }
  if(action==='pick-guardian-payment'){ state.paymentChildFilter = id; renderView(); }
  if(action==='edit-payment'){ state.editingPaymentId = id; renderView(); }
  if(action==='delete-payment'){
    if(confirm('এই পেমেন্ট রেকর্ডটা মুছে ফেলবেন?')){
      savePayments(payments().filter(p=>p.id!==id));
      toast('পেমেন্ট রেকর্ড মুছে ফেলা হয়েছে','warn');
      renderView();
    }
  }
  if(action==='filter-syllabus-class'){ state.syllabusClassFilter = id; state.editingSyllabusId=null; renderView(); }
  if(action==='edit-syllabus'){ state.editingSyllabusId = id; renderView(); }
  if(action==='delete-subject'){
    if(confirm(`"${id}" বিষয়টা "${cls}" শ্রেণির তালিকা থেকে সরিয়ে ফেলবেন? (আগে দেওয়া টাস্ক/সিলেবাসে এটা থেকেই যাবে, শুধু নতুন করে আর বেছে নেওয়া যাবে না)`)){
      saveSubjectsForClass(cls, getSubjectsForClass(cls).filter(s=>s!==id));
      toast('বিষয় সরানো হয়েছে','warn');
      renderView();
    }
  }
  if(action==='delete-syllabus'){
    if(confirm('এই সিলেবাস আইটেম মুছে ফেলবেন?')){
      saveSyllabus(syllabus().filter(s=>s.id!==id));
      toast('সিলেবাস থেকে সরানো হয়েছে','warn');
      renderView();
    }
  }
  if(action==='edit-user'){
    state.editingUserId = id;
    const u = findUser(id);
    state.adduserSelectedChildIds = (u && u.role==='guardian') ? [...(u.childIds||[])] : [];
    renderView();
  }
  if(action==='filter-admin-users-role'){ state.adminUserRoleFilter = id; renderView(); }
  if(action==='filter-admin-users-class'){ state.adminUserClassFilter = id; renderView(); }
  if(action==='adduser-child-add'){
    state.adduserSelectedChildIds = [...new Set([...(state.adduserSelectedChildIds||[]), id])];
    refreshAdduserChildrenPicker();
  }
  if(action==='adduser-child-remove'){
    state.adduserSelectedChildIds = (state.adduserSelectedChildIds||[]).filter(x=>x!==id);
    refreshAdduserChildrenPicker();
  }
  if(action==='adduser-child-classfilter'){
    state.adduserChildClassFilter = id;
    refreshAdduserChildrenPicker();
  }
  if(action==='remove-user'){
    const u = findUser(id);
    if(u.id===user.id){ toast('নিজের অ্যাকাউন্ট এখান থেকে মোছা যাবে না','warn'); return; }
    if(confirm(`${u.name} (${ROLE_LABEL[u.role]})-কে সম্পূর্ণ মুছে ফেলবেন? সংশ্লিষ্ট সব ডাটাও মুছে যাবে। এটা ফিরিয়ে আনা যাবে না।`)){
      deleteUserCascade(id);
      toast('ইউজার মুছে ফেলা হয়েছে','warn');
      renderView();
    }
  }
  if(action==='pick-child'){ document.getElementById('view').innerHTML = renderRevisionLog(user, id); }
  if(action==='pick-revision-student'){ document.getElementById('view').innerHTML = renderRevisionLog(user, id); }
  if(action==='mark-not-done'){
    const all = tasks();
    const idx = all.findIndex(t=>t.id===id);
    if(idx>-1){
      const t = all[idx];
      const student = findUser(t.studentId);
      t.status = 'pending';
      t.completedDate = null;
      saveTasks(all);
      addNotification(t.studentId, `${user.name} মনে করছেন "${t.subject} — ${t.chapter}" ঠিকমতো সম্পন্ন হয়নি — আবার একবার দেখো।`, 'task');
      toast('আবার "বাকি" হিসেবে চিহ্নিত করা হলো','warn');
      renderView();
    }
  }
  if(action==='remind-revision'){
    const t = tasks().find(t=>t.id===id);
    if(t){
      addNotification(t.studentId, `🔔 রিভিশনের জন্য মনে করিয়ে দেওয়া হলো: "${t.subject} — ${t.chapter}"`, 'task');
      toast('রিমাইন্ডার পাঠানো হয়েছে 🔔','success');
    }
  }
  if(action==='set-revision-range'){ state.revisionRange = id; renderView(); }
  if(action==='set-student-dash-tab'){ state.studentDashTab = id; renderView(); }
  if(action==='set-guardian-task-tab'){ state.guardianTaskTab = id; renderView(); }
  if(action==='set-tutor-task-tab'){ state.tutorTaskTab = id; renderView(); }
  if(action==='set-tutor-dash-tab'){ state.tutorDashTab = id; renderView(); }
  if(action==='set-admin-dash-tab'){ state.adminDashTab = id; renderView(); }
  if(action==='goto-revision'){ state.view='revision'; renderView(); }
  if(action==='msg-user'){ state.view='messages'; state.chatWith=id; renderView(); }
  if(action==='open-chat'){ state.chatWith=id; document.getElementById('view').innerHTML = renderMessages(user); scrollChatBottom(); }
  if(action==='filter-message-role'){ state.messageRoleFilter = id; state.chatWith = null; renderView(); }
  if(action==='set-message-mode'){ state.messagesMode = id; renderView(); }

  // cancel buttons (not data-action, but easiest handled here since they're inside #view)
  if(e.target.id==='student-form-cancel'){ state.editingStudentId=null; renderView(); }
  if(e.target.id==='routine-form-cancel'){ state.editingRoutineId=null; renderView(); }
  if(e.target.id==='syllabus-form-cancel'){ state.editingSyllabusId=null; renderView(); }
  if(e.target.id==='adduser-form-cancel'){ state.editingUserId=null; state.adduserSelectedChildIds=[]; renderView(); }
  if(e.target.id==='cancel-edit-task'){ state.editingTaskId=null; renderView(); }
  if(e.target.id==='complete-form-cancel'){ state.completingTaskId=null; state.completingStatus=null; renderView(); }
  if(e.target.id==='payment-form-cancel'){ state.editingPaymentId=null; renderView(); }
  if(e.target.id==='adduser-reset-password'){
    const f = document.getElementById('adduser-form');
    f.querySelector('[name=password]').value = '1234';
    toast(`পাসওয়ার্ড রিসেট করা হয়েছে: 1234 — সংরক্ষণ করতে "সংরক্ষণ করুন" চাপুন`,'success');
  }
  if(e.target.id==='student-reset-password'){
    const f = document.getElementById('student-form');
    f.querySelector('[name=password]').value = '1234';
    toast(`পাসওয়ার্ড রিসেট করা হয়েছে: 1234 — সংরক্ষণ করতে "সংরক্ষণ করুন" চাপুন`,'success');
  }
  if(e.target.id==='backup-download-btn'){ downloadBackup(); }
});

/* cascade-delete a user: remove their own tasks/routine/notifications/messages,
   and unlink them from any tutor/guardian/student relationship references */
/* keep a guardian's childIds and each linked student's guardianId in sync.
   `all` is the in-memory users array (mutated in place, not yet saved). */
function syncGuardianChildren(all, guardianId, newChildIds){
  const gi = all.findIndex(u=>u.id===guardianId);
  if(gi===-1) return;
  const oldChildIds = all[gi].childIds || [];
  all[gi].childIds = newChildIds;
  // students removed from this guardian's list
  oldChildIds.filter(id=>!newChildIds.includes(id)).forEach(id=>{
    const si = all.findIndex(u=>u.id===id);
    if(si>-1 && all[si].guardianId===guardianId) all[si].guardianId = null;
  });
  // students newly added to this guardian's list
  newChildIds.forEach(id=>{
    const si = all.findIndex(u=>u.id===id);
    if(si>-1) all[si].guardianId = guardianId;
  });
}

function deleteUserCascade(userId){
  const u = findUser(userId);
  if(!u) return;
  const photoMap = getPhotoMap();
  tasks().filter(t=>t.studentId===userId || t.tutorId===userId).forEach(t=> delete photoMap[t.id]);
  setPhotoMapLocal(photoMap);
  saveUsers(users().filter(x=>x.id!==userId).map(x=>{
    if(x.studentIds) x.studentIds = x.studentIds.filter(id=>id!==userId);
    if(x.childIds) x.childIds = x.childIds.filter(id=>id!==userId);
    if(x.tutorId===userId) x.tutorId = null;
    if(x.guardianId===userId) x.guardianId = null;
    return x;
  }));
  saveTasks(tasks().filter(t=>t.studentId!==userId && t.tutorId!==userId));
  saveRoutine(routine().filter(r=>r.studentId!==userId && r.tutorId!==userId));
  saveFollowups(followups().filter(f=>f.studentId!==userId && f.tutorId!==userId));
  savePayments(payments().filter(p=>p.studentId!==userId && p.tutorId!==userId && p.guardianId!==userId));
  saveNotifs(notifs().filter(n=>n.userId!==userId));
  saveMsgs(msgs().filter(m=>m.from!==userId && m.to!==userId));
}

document.getElementById('view').addEventListener('change', async (e)=>{
  if(e.target.name==='photo' && e.target.closest('#complete-form')){
    const form = e.target.closest('#complete-form');
    const taskId = form.dataset.task;
    const previewEl = document.getElementById('photo-preview-'+taskId);
    const file = e.target.files[0];
    if(!file){ form.dataset.photoDataUrl=''; if(previewEl) previewEl.innerHTML=''; return; }
    if(previewEl) previewEl.innerHTML = '<span style="font-size:.8rem;color:var(--text-soft)">ছবি প্রসেস হচ্ছে…</span>';
    const dataUrl = await compressImageFile(file);
    form.dataset.photoDataUrl = dataUrl || '';
    if(previewEl){
      previewEl.innerHTML = dataUrl
        ? `<img src="${dataUrl}" style="max-width:140px;border-radius:8px;border:1px solid var(--paper-line)" />`
        : '<span style="color:var(--danger); font-size:.8rem">ছবি প্রসেস করা যায়নি, আবার চেষ্টা করুন।</span>';
    }
    return;
  }
  if(e.target.name==='assignPhoto' && e.target.closest('#assign-form')){
    const form = e.target.closest('#assign-form');
    const previewEl = document.getElementById('assign-photo-preview');
    const file = e.target.files[0];
    if(!file){ form.dataset.photoDataUrl=''; if(previewEl) previewEl.innerHTML=''; return; }
    if(previewEl) previewEl.innerHTML = '<span style="font-size:.8rem;color:var(--text-soft)">ছবি প্রসেস হচ্ছে…</span>';
    const dataUrl = await compressImageFile(file);
    form.dataset.photoDataUrl = dataUrl || '';
    if(previewEl){
      previewEl.innerHTML = dataUrl
        ? `<img src="${dataUrl}" style="max-width:140px;border-radius:8px;border:1px solid var(--paper-line)" />`
        : '<span style="color:var(--danger); font-size:.8rem">ছবি প্রসেস করা যায়নি, আবার চেষ্টা করুন।</span>';
    }
    return;
  }
  if(e.target.id==='snapshot-date-input'){ state.snapshotDate = e.target.value; renderView(); }
  if(e.target.id==='backup-restore-input'){
    const file = e.target.files[0]; if(!file) return;
    if(!confirm('এটা করলে বর্তমান সব ডাটা মুছে ব্যাকআপ ফাইলের ডাটা দিয়ে প্রতিস্থাপিত হবে। নিশ্চিত?')){ e.target.value=''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const data = JSON.parse(reader.result);
        if(data.users) saveUsers(data.users);
        if(data.tasks) saveTasks(data.tasks);
        if(data.messages) saveMsgs(data.messages);
        if(data.notifications) saveNotifs(data.notifications);
        if(data.syllabus) saveSyllabus(data.syllabus);
        if(data.routine) saveRoutine(data.routine);
        if(data.followups) saveFollowups(data.followups);
        if(data.payments) savePayments(data.payments);
        if(data.photos) setPhotoMapLocal(data.photos);
        if(data.subjects) saveSubjectList(data.subjects);
        toast('ব্যাকআপ থেকে রিস্টোর সম্পন্ন হয়েছে ✅','success');
        renderView();
      }catch(err){ toast('ব্যাকআপ ফাইলটা পড়া যায়নি — সঠিক JSON ফাইল কিনা দেখুন।','warn'); }
    };
    reader.readAsText(file);
  }

  // assign-form dynamic target/class/student -> subject + syllabus refresh
  const form = e.target.closest && e.target.closest('#assign-form');
  if(form){
    if(e.target.name==='assignTarget'){
      const isClass = e.target.value==='class';
      document.getElementById('assign-student-group').hidden = isClass;
      document.getElementById('assign-class-group').hidden = !isClass;
      refreshAssignSubjectOptions(form);
      refreshAssignSyllabusOptions(form);
      refreshTodaysAssignedList(form);
    }
    if(e.target.name==='studentId' || e.target.name==='className'){
      refreshAssignSubjectOptions(form);
      refreshAssignSyllabusOptions(form);
      refreshTodaysAssignedList(form);
    }
  }

  // routine-form: target/class toggles visibility + refreshes subject list + student count
  const rform = e.target.closest && e.target.closest('#routine-form');
  if(rform){
    if(e.target.name==='routineTarget'){
      const isClass = e.target.value==='class';
      const classGroup = document.getElementById('routine-class-group');
      if(classGroup) classGroup.hidden = !isClass;
      state.stickyRoutineTarget = e.target.value;
      refreshRoutineSubjectOptions(rform);
      refreshRoutineClassCount(rform);
    }
    if(e.target.name==='routineClassName'){
      state.stickyRoutineClassName = e.target.value;
      refreshRoutineSubjectOptions(rform);
      refreshRoutineClassCount(rform);
    }
  }

  // subject-form (সিলেবাস ব্যবস্থাপনা): class picker changes which class's subjects are shown
  if(e.target.name==='className' && e.target.closest('#subject-form')){
    state.subjectManageClass = e.target.value;
    renderView();
  }
  // syllabus-form: class picker refreshes its own বিষয় dropdown in place (keeps the typed title)
  if(e.target.name==='className' && e.target.closest('#syllabus-form')){
    const sform = e.target.closest('#syllabus-form');
    const subjSel = sform.querySelector('[name=subject]');
    if(subjSel) subjSel.outerHTML = subjectSelectHtml(getSubjectsForClass(e.target.value), '', {name:'subject'});
  }
  if(e.target.id==='adduser-role'){
    const role = e.target.value;
    document.getElementById('adduser-link-wrap').hidden = role!=='student';
    document.getElementById('adduser-children-wrap').hidden = role!=='guardian';
    document.getElementById('adduser-phone-wrap').hidden = role==='student';
    document.getElementById('adduser-nickname-wrap').hidden = role!=='student';
    document.getElementById('adduser-class-wrap').hidden = role!=='student';
    if(form2IsNewAdduser(e.target)) state.stickyAdduserRole = role;
  }
  if(form2IsNewAdduser(e.target) && e.target.dataset.role==='adduser-class'){
    state.stickyAdduserClassName = e.target.value;
  }
  if(e.target.dataset.role==='broadcast-classfilter'){
    const bform = e.target.closest('#broadcast-form');
    const targetSel = bform.querySelector('[name=target]');
    state.broadcastClassFilter = e.target.value;
    targetSel.innerHTML = broadcastTargetOptionsHtml(currentUser(), e.target.value);
  }
  if(e.target.dataset.role==='payment-class-select'){
    const cls = e.target.value;
    const user = currentUser();
    const studentsInClass = (user.studentIds||[]).map(findUser).filter(Boolean).filter(s=>s.className===cls);
    state.paymentClassFilter = cls;
    state.paymentStudentFilter = studentsInClass[0]?.id || null;
    state.editingPaymentId = null;
    renderView();
  }
  if(e.target.dataset.role==='payment-student-select'){
    state.paymentStudentFilter = e.target.value;
    state.editingPaymentId = null;
    renderView();
  }
  if(e.target.dataset.role==='routine-picker-class'){
    const cls = e.target.value;
    const pickAction = e.target.dataset.pickAction;
    const pool = routineStudentsPoolForUser(currentUser()).filter(s=>s.className===cls);
    const firstId = pool[0]?.id || null;
    if(pickAction==='pick-tutor-routine') state.tutorRoutineStudent = firstId;
    else if(pickAction==='pick-admin-routine') state.adminRoutineStudent = firstId;
    state.editingRoutineId = null;
    renderView();
  }
  if(e.target.dataset.role==='routine-picker-student'){
    const pickAction = e.target.dataset.pickAction;
    if(pickAction==='pick-tutor-routine') state.tutorRoutineStudent = e.target.value;
    else if(pickAction==='pick-admin-routine') state.adminRoutineStudent = e.target.value;
    state.editingRoutineId = null;
    renderView();
  }
  if(e.target.dataset.role==='student-filter-class'){
    state.tutorClassFilter = e.target.value;
    state.tutorStudentFilter = null;
    renderView();
    await triggerTutorTaskRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='student-filter-student'){
    state.tutorStudentFilter = e.target.value || null;
    renderView();
    await triggerTutorTaskRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='revision-picker-class'){
    const cls = e.target.value;
    const user = currentUser();
    const myStudents = (user.studentIds||[]).map(findUser).filter(Boolean);
    const pool = myStudents.filter(s=>s.className===cls);
    state.revisionTutorStudent = pool[0]?.id || null;
    renderView();
  }
  if(e.target.dataset.role==='revision-picker-student'){
    state.revisionTutorStudent = e.target.value;
    renderView();
  }
  if(e.target.dataset.role==='tutor-task-range'){
    state.tutorTaskRange = e.target.value;
    renderView(); // shows "লোড হচ্ছে…" immediately if this range needs a fetch
    await triggerTutorTaskRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='tutor-task-custom-from'){
    state.tutorTaskCustomFrom = e.target.value || null;
    renderView();
    await triggerTutorTaskRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='tutor-task-custom-to'){
    state.tutorTaskCustomTo = e.target.value || null;
    renderView();
    await triggerTutorTaskRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='admin-dash-range'){
    state.adminDashRange = e.target.value;
    renderView();
    await triggerAdminDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='admin-dash-custom-from'){
    state.adminDashCustomFrom = e.target.value || null;
    renderView();
    await triggerAdminDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='admin-dash-custom-to'){
    state.adminDashCustomTo = e.target.value || null;
    renderView();
    await triggerAdminDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='tutor-dash-class'){
    state.tutorDashClassFilter = e.target.value;
    state.tutorDashStudentFilter = null;
    renderView(); // class/student filter doesn't need a new fetch — see triggerTutorDashRangeFetch's comment
  }
  if(e.target.dataset.role==='tutor-dash-student'){
    state.tutorDashStudentFilter = e.target.value || null;
    renderView();
  }
  if(e.target.dataset.role==='tutor-dash-range'){
    state.tutorDashRange = e.target.value;
    renderView();
    await triggerTutorDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='tutor-dash-custom-from'){
    state.tutorDashCustomFrom = e.target.value || null;
    renderView();
    await triggerTutorDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='tutor-dash-custom-to'){
    state.tutorDashCustomTo = e.target.value || null;
    renderView();
    await triggerTutorDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='admin-dash-class'){
    state.adminDashClassFilter = e.target.value;
    state.adminDashStudentFilter = null;
    renderView(); // class/student filter doesn't need a new fetch — see triggerAdminDashRangeFetch's comment
  }
  if(e.target.dataset.role==='admin-dash-student'){
    state.adminDashStudentFilter = e.target.value || null;
    renderView();
  }
  if(e.target.dataset.role==='student-dash-range'){
    state.studentDashRange = e.target.value;
    renderView();
    await triggerStudentDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='student-dash-custom-from'){
    state.studentDashCustomFrom = e.target.value || null;
    renderView();
    await triggerStudentDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='student-dash-custom-to'){
    state.studentDashCustomTo = e.target.value || null;
    renderView();
    await triggerStudentDashRangeFetch();
    renderView();
  }
  if(e.target.dataset.role==='guardian-dash-range'){
    state.guardianDashRange = e.target.value;
    renderView();
    await triggerGuardianDashRangeFetch(state.guardianActiveChildId);
    renderView();
  }
  if(e.target.dataset.role==='guardian-dash-custom-from'){
    state.guardianDashCustomFrom = e.target.value || null;
    renderView();
    await triggerGuardianDashRangeFetch(state.guardianActiveChildId);
    renderView();
  }
  if(e.target.dataset.role==='guardian-dash-custom-to'){
    state.guardianDashCustomTo = e.target.value || null;
    renderView();
    await triggerGuardianDashRangeFetch(state.guardianActiveChildId);
    renderView();
  }
});
function form2IsNewAdduser(el){ const f = el.closest && el.closest('#adduser-form'); return f && !f.dataset.editing; }
function form2IsNewStudentForm(el){ const f = el.closest && el.closest('#student-form'); return f && !f.dataset.editing; }

document.getElementById('view').addEventListener('input', (e)=>{
  if(form2IsNewAdduser(e.target)){
    const f = e.target.closest('#adduser-form');
    const role = f.querySelector('[name=role]').value;
    if(e.target.dataset.role==='adduser-phone' && role!=='student'){
      f.querySelector('[name=username]').value = e.target.value;
    }
    if(e.target.dataset.role==='adduser-nickname' && role==='student'){
      f.querySelector('[name=username]').value = e.target.value;
    }
  }
  if(form2IsNewStudentForm(e.target) && e.target.name==='nickname'){
    e.target.closest('#student-form').querySelector('[name=username]').value = e.target.value;
  }
});
function refreshAssignSyllabusOptions(form){
  const targetSel = form.querySelector('[name=assignTarget]');
  const isClass = targetSel && targetSel.value==='class';
  let className;
  if(isClass){
    className = form.querySelector('[name=className]')?.value;
  }else{
    const studentId = form.querySelector('[name=studentId]')?.value;
    className = findUser(studentId)?.className;
  }
  const sylSel = form.querySelector('[name=syllabusId]');
  if(!sylSel) return;
  const items = syllabusForClass(className);
  const bySubj = {};
  items.forEach(it=>(bySubj[it.subject] ||= []).push(it));
  sylSel.innerHTML = `<option value="">— কোনোটা নয় —</option>` + Object.keys(bySubj).sort().map(subj=>
    `<optgroup label="${subj}">${bySubj[subj].map(it=>`<option value="${it.id}">${it.title}</option>`).join('')}</optgroup>`
  ).join('');
}
/* target/class/student পাল্টালে বিষয়ের তালিকাও সেই শ্রেণির জন্য রিফ্রেশ হবে */
function assignFormClassName(form){
  const targetSel = form.querySelector('[name=assignTarget]');
  const isClass = targetSel && targetSel.value==='class';
  if(isClass) return form.querySelector('[name=className]')?.value;
  const studentId = form.querySelector('[name=studentId]')?.value;
  return findUser(studentId)?.className;
}
function refreshAssignSubjectOptions(form){
  const subjSel = form.querySelector('[name=subject]');
  if(!subjSel) return;
  const className = assignFormClassName(form);
  subjSel.outerHTML = subjectSelectHtml(getSubjectsForClass(className), '', {name:'subject', attrs:'required data-role="assign-subject"'});
}

/* ---------- routine-form: shared for tutor (own students) + admin (all students) ---------- */
function routineStudentsPoolForUser(user){
  if(user.role==='tutor') return (user.studentIds||[]).map(findUser).filter(Boolean);
  if(user.role==='admin') return usersByRole('student');
  return [];
}
function refreshRoutineSubjectOptions(form){
  const subjSel = form.querySelector('[name=subject]');
  if(!subjSel) return;
  const targetSel = form.querySelector('[name=routineTarget]');
  const isClass = targetSel && targetSel.value==='class';
  let className;
  if(isClass){
    className = form.querySelector('[name=routineClassName]')?.value;
  } else {
    className = findUser(form.dataset.student)?.className;
  }
  subjSel.outerHTML = subjectSelectHtml(getSubjectsForClass(className), '', {name:'subject', attrs:'required data-role="routine-subject"'});
}
function refreshRoutineClassCount(form){
  const countEl = document.getElementById('routine-class-count');
  if(!countEl) return;
  const targetSel = form.querySelector('[name=routineTarget]');
  const isClass = targetSel && targetSel.value==='class';
  if(!isClass){ countEl.textContent = ''; return; }
  const pool = routineStudentsPoolForUser(currentUser());
  const cls = form.querySelector('[name=routineClassName]')?.value;
  countEl.textContent = cls ? `এই শ্রেণিতে ${pool.filter(s=>s.className===cls).length} জন শিক্ষার্থী পাবে` : '';
}

function scrollChatBottom(){ const box=document.getElementById('chat-msgs'); if(box) box.scrollTop = box.scrollHeight; }
scrollChatBottom();

document.getElementById('view').addEventListener('submit', (e)=>{
  const user = currentUser();

  if(e.target.id==='assign-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const editingId = e.target.dataset.editing;
    const photoDataUrl = e.target.dataset.photoDataUrl || null;

    if(editingId){
      const all = tasks();
      const idx = all.findIndex(t=>t.id===editingId);
      if(idx>-1){
        Object.assign(all[idx], {
          subject:f.get('subject'), chapter:f.get('chapter'),
          questions:f.get('questions')||'', type:f.get('type'), assignedDate:f.get('assignedDate'),
          dueDate:f.get('dueDate'), syllabusId:f.get('syllabusId')||null
        });
      if(photoDataUrl){ all[idx].hasAssignPhoto = true; savePhotoForTask(editingId+'_given', photoDataUrl); }
        saveTasks(all);
        toast('পড়া আপডেট হয়েছে ✅','success');
      }
      state.editingTaskId = null;
      renderView();
      return;
    }

    const isClass = f.get('assignTarget')==='class';
    const targetStudents = isClass
      ? (user.studentIds||[]).map(findUser).filter(s=>s && s.className===f.get('className'))
      : [findUser(f.get('studentId'))].filter(Boolean);

    if(!targetStudents.length){ toast('কোনো শিক্ষার্থী পাওয়া যায়নি।','warn'); return; }

    const all = tasks();
    targetStudents.forEach(student=>{
      const t = {
        id:uid('t'), studentId:student.id, tutorId:user.id, subject:f.get('subject'),
        chapter:f.get('chapter'), pageFrom:null, pageTo:null,
        questions:f.get('questions')||'', type:f.get('type'), assignedDate:f.get('assignedDate'),
        dueDate:f.get('dueDate'), status:'pending', syllabusId:f.get('syllabusId')||null
      };
      if(photoDataUrl){ t.hasAssignPhoto = true; savePhotoForTask(t.id+'_given', photoDataUrl); }
      all.push(t);
      addNotification(student.id, `নতুন পড়া দেওয়া হয়েছে: ${t.subject} — ${t.chapter}${photoDataUrl?' (ছবিসহ)':''}`, 'task');
      if(student.guardianId) addNotification(student.guardianId, `${student.name}-কে নতুন পড়া দেওয়া হয়েছে: ${t.subject}`, 'task');
    });
    saveTasks(all);
    // remember target/student-or-class/dates for the next entry, so repeated data entry is faster
    state.stickyAssignTarget = f.get('assignTarget');
    if(isClass) state.stickyAssignClassName = f.get('className'); else state.stickyAssignStudentId = f.get('studentId');
    state.stickyAssignedDate = f.get('assignedDate');
    toast(isClass ? `পুরো শ্রেণিকে (${targetStudents.length} জন) পড়া দেওয়া হয়েছে ✍️` : 'পড়া সফলভাবে দেওয়া হয়েছে ✍️','success');
    renderView();
  }

  if(e.target.id==='routine-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const editingId = e.target.dataset.editing;

    if(editingId){
      const all = routine();
      const idx = all.findIndex(r=>r.id===editingId);
      if(idx>-1){ Object.assign(all[idx], { day:f.get('day'), time:f.get('time'), subject:f.get('subject'), note:f.get('note')||'' }); saveRoutine(all); toast('রুটিন আপডেট হয়েছে ✅','success'); }
      state.editingRoutineId = null;
      renderView();
      return;
    }

    const day = f.get('day'), time = f.get('time'), subject = f.get('subject'), note = f.get('note')||'';
    const target = f.get('routineTarget') || 'student';
    state.stickyRoutineDay = day;
    state.stickyRoutineTime = time;
    state.stickyRoutineTarget = target;

    const all = routine();
    if(target==='class'){
      const className = f.get('routineClassName');
      state.stickyRoutineClassName = className;
      const pool = routineStudentsPoolForUser(user).filter(s=>s.className===className);
      pool.forEach(s=>{
        const tutorId = user.role==='tutor' ? user.id : (s.tutorId||null);
        all.push({ id:uid('r'), studentId:s.id, tutorId, day, time, subject, note });
        if(s.guardianId) addNotification(s.guardianId, `${s.name}-এর রুটিনে নতুন ক্লাস যোগ হয়েছে: ${subject} (${day})`, 'task');
        addNotification(s.id, `তোমার রুটিনে নতুন ক্লাস যোগ হয়েছে: ${subject} (${day})`, 'task');
      });
      saveRoutine(all);
      toast(`${pool.length} জন শিক্ষার্থীর রুটিনে যোগ হয়েছে ✅`,'success');
    } else {
      const studentId = e.target.dataset.student;
      const student = findUser(studentId);
      const tutorId = user.role==='tutor' ? user.id : (student?.tutorId||null);
      all.push({ id:uid('r'), studentId, tutorId, day, time, subject, note });
      saveRoutine(all);
      toast('রুটিনে যোগ হয়েছে ✅','success');
      if(student?.guardianId) addNotification(student.guardianId, `${student.name}-এর রুটিনে নতুন ক্লাস যোগ হয়েছে: ${subject} (${day})`, 'task');
      addNotification(studentId, `তোমার রুটিনে নতুন ক্লাস যোগ হয়েছে: ${subject} (${day})`, 'task');
    }
    renderView();
  }

  if(e.target.id==='followup-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const studentId = e.target.dataset.student;
    const student = findUser(studentId);
    const text = (f.get('text')||'').trim();
    if(!text) return;
    const all = followups();
    all.push({ id:uid('fu'), studentId, tutorId:user.id, text, ts:Date.now() });
    saveFollowups(all);
    if(student?.guardianId) addNotification(student.guardianId, `${student.name}-এর ব্যাপারে টিউটরের নতুন ফলোআপ নোট এসেছে`, 'task');
    toast('ফলোআপ নোট যোগ হয়েছে ✅','success');
    renderView();
  }

  if(e.target.id==='payment-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const studentId = e.target.dataset.student;
    const student = findUser(studentId);
    const editingId = e.target.dataset.editing;
    const month = f.get('month');
    const amount = Number(f.get('amount'))||0;
    const note = f.get('note')||'';

    if(editingId){
      const all = payments();
      const idx = all.findIndex(p=>p.id===editingId);
      if(idx>-1){ Object.assign(all[idx], { month, amount, note }); savePayments(all); toast('পেমেন্ট আপডেট হয়েছে ✅','success'); }
      state.editingPaymentId = null;
      renderView();
      return;
    }

    const all = payments();
    all.push({ id:uid('pay'), studentId, tutorId:user.id, guardianId:student?.guardianId||null, month, amount, note, receivedDate:todayISO() });
    savePayments(all);
    if(student?.guardianId){
      addNotification(student.guardianId, `🧾 পেমেন্ট রিসিট — ${student.name} — ${fmtMonth(month)} — ${fmtTaka(amount)} গ্রহণ করা হয়েছে। ধন্যবাদ!`, 'payment');
    }
    toast('পেমেন্ট মার্ক করা হয়েছে ✅','success');
    renderView();
  }

  if(e.target.id==='subject-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const name = (f.get('subjectName')||'').trim();
    const className = f.get('className');
    if(!name) return;
    const list = getSubjectsForClass(className);
    if(list.includes(name)){ toast(`এই বিষয় "${className}" শ্রেণিতে আগে থেকেই আছে।`,'warn'); return; }
    saveSubjectsForClass(className, [...list, name]);
    state.subjectManageClass = className;
    toast(`"${name}" বিষয় "${className}" শ্রেণিতে যোগ হয়েছে ✅`,'success');
    e.target.reset();
    renderView();
  }

  if(e.target.id==='syllabus-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const editingId = e.target.dataset.editing;
    const all = syllabus();
    if(editingId){
      const idx = all.findIndex(s=>s.id===editingId);
      if(idx>-1){ Object.assign(all[idx], { className:f.get('className'), subject:f.get('subject'), title:f.get('title') }); saveSyllabus(all); toast('সিলেবাস আপডেট হয়েছে ✅','success'); }
      state.editingSyllabusId = null;
    } else {
      all.push({ id:uid('syl'), className:f.get('className'), subject:f.get('subject'), title:f.get('title') });
      saveSyllabus(all);
      toast('সিলেবাসে যোগ হয়েছে ✅','success');
      state.syllabusClassFilter = f.get('className');
      state.stickySyllabusClass = f.get('className');
      state.stickySyllabusSubject = f.get('subject');
    }
    renderView();
  }

  if(e.target.id==='student-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const editingId = e.target.dataset.editing;
    const newGuardianId = f.get('guardianId')||null;
    const newPassword = f.get('password'); // blank on edit means "keep unchanged"
    const newUsername = (f.get('username')||'').trim();

    const usernameTaken = users().some(u=>u.id!==editingId && u.username===newUsername);
    if(usernameTaken){
      toast(`"${newUsername}" ইউজারনেমটি অন্য একজন ব্যবহার করছেন — অন্য একটি ইউজারনেম দিন।`,'warn');
      return;
    }

    if(editingId){
      const all = users();
      const idx = all.findIndex(u=>u.id===editingId);
      if(idx>-1){
        const oldGuardianId = all[idx].guardianId;
        Object.assign(all[idx], { name:f.get('name'), username:newUsername, nickname:f.get('nickname')||'', className:f.get('className'), guardianId:newGuardianId });
        if(newPassword) all[idx].password = newPassword;
        if(oldGuardianId!==newGuardianId){
          if(oldGuardianId){ const gi=all.findIndex(u=>u.id===oldGuardianId); if(gi>-1) all[gi].childIds = (all[gi].childIds||[]).filter(id=>id!==editingId); }
          if(newGuardianId){ const gi=all.findIndex(u=>u.id===newGuardianId); if(gi>-1) all[gi].childIds = [...new Set([...(all[gi].childIds||[]), editingId])]; }
        }
        saveUsers(all);
        toast('শিক্ষার্থীর তথ্য আপডেট হয়েছে ✅','success');
      }
      state.editingStudentId = null;
      renderView();
      return;
    }

    const nu = { id:uid('u'), role:'student', name:f.get('name'), nickname:f.get('nickname')||'', username:newUsername, password:f.get('password')||'1234', className:f.get('className'), tutorId:user.id, guardianId:newGuardianId };
    const all = users();
    all.push(nu);
    const ti = all.findIndex(x=>x.id===user.id);
    if(ti>-1) all[ti].studentIds = [...(all[ti].studentIds||[]), nu.id];
    if(newGuardianId){ const gi = all.findIndex(x=>x.id===newGuardianId); if(gi>-1) all[gi].childIds = [...new Set([...(all[gi].childIds||[]), nu.id])]; }
    saveUsers(all);
    state.stickyStudentClassName = nu.className;
    toast(`${nu.name} যুক্ত হয়েছে ✅ (ইউজারনেম: ${nu.username}, পাসওয়ার্ড: ${nu.password})`,'success');
    e.target.reset();
    renderView();
  }

  if(e.target.id==='complete-form'){
    e.preventDefault();
    const taskId = e.target.dataset.task;
    const status = e.target.dataset.status;
    const note = e.target.querySelector('[name=note]').value.trim();
    const photoDataUrl = e.target.dataset.photoDataUrl || null;
    const percentEl = e.target.querySelector('[name=percent]');
    const percent = percentEl ? Number(percentEl.value)||null : null;
    completeTask(taskId, status, note, photoDataUrl, percent);
  }

  if(e.target.id==='change-password-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const current = f.get('current'), new1 = f.get('new1'), new2 = f.get('new2');
    if(current !== user.password){ toast('বর্তমান পাসওয়ার্ড ঠিক নেই।','warn'); return; }
    if(new1 !== new2){ toast('নতুন পাসওয়ার্ড দুইবার একই লিখুন।','warn'); return; }
    const all = users();
    const idx = all.findIndex(u=>u.id===user.id);
    if(idx>-1){ all[idx].password = new1; saveUsers(all); toast('পাসওয়ার্ড পরিবর্তন হয়েছে ✅','success'); e.target.reset(); }
  }

  if(e.target.id==='guardian-task-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const studentId = e.target.dataset.student;
    const student = findUser(studentId);
    const t = {
      id:uid('t'), studentId, tutorId:student?.tutorId||null, subject:f.get('subject'),
      chapter:f.get('chapter'), pageFrom:null, pageTo:null, questions:f.get('questions')||'',
      type:'পড়া', assignedDate:todayISO(), dueDate:f.get('dueDate'), status:'pending', source:'guardian'
    };
    const all = tasks(); all.push(t); saveTasks(all);
    addNotification(studentId, `তোমার অভিভাবক একটা এক্সট্রা কাজ দিয়েছেন: ${t.subject} — ${t.chapter}`, 'task');
    if(student?.tutorId) addNotification(student.tutorId, `${student.name}-এর অভিভাবক একটা এক্সট্রা টাস্ক যোগ করেছেন: ${t.subject}`, 'task');
    toast('এক্সট্রা টাস্ক যোগ হয়েছে ✅','success');
    e.target.reset();
    renderView();
  }

  if(e.target.id==='broadcast-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const target = f.get('target');
    const text = (f.get('text')||'').trim();
    if(!text) return;
    const recipients = broadcastRecipients(user, target);
    if(!recipients.length){ toast('এই তালিকায় কেউ নেই।','warn'); return; }
    const all = msgs();
    recipients.forEach(r=>{
      all.push({id:uid('m'), from:user.id, to:r.id, text, ts:Date.now()});
      addNotification(r.id, `${user.name}: ${text.slice(0,40)}`, 'msg');
    });
    saveMsgs(all);
    toast(`${recipients.length} জনকে বার্তা পাঠানো হয়েছে ✅`,'success');
    e.target.reset();
  }

  if(e.target.id==='chat-form'){
    e.preventDefault();
    const input = document.getElementById('chat-text');
    const text = input.value.trim(); if(!text) return;
    const all = msgs(); all.push({id:uid('m'), from:user.id, to:state.chatWith, text, ts:Date.now()}); saveMsgs(all);
    addNotification(state.chatWith, `${user.name}: ${text.slice(0,40)}`, 'msg');
    input.value='';
    document.getElementById('view').innerHTML = renderMessages(user);
    scrollChatBottom();
  }

  if(e.target.id==='adduser-form'){
    e.preventDefault();
    const f = new FormData(e.target);
    const editingId = e.target.dataset.editing;
    const newPassword = f.get('password'); // blank on edit means "keep unchanged"
    const newUsername = (f.get('username')||'').trim();

    const usernameTaken = users().some(u=>u.id!==editingId && u.username===newUsername);
    if(usernameTaken){
      toast(`"${newUsername}" ইউজারনেমটি অন্য একজন ব্যবহার করছেন — অন্য একটি ইউজারনেম দিন।`,'warn');
      return;
    }

    if(editingId){
      const all = users();
      const idx = all.findIndex(u=>u.id===editingId);
      if(idx>-1){
        const oldTutorId = all[idx].tutorId;
        Object.assign(all[idx], { name:f.get('name'), username:newUsername });
        if(newPassword) all[idx].password = newPassword;
        if(all[idx].role==='student'){
          all[idx].nickname = f.get('nickname')||all[idx].nickname;
          all[idx].className = f.get('className')||all[idx].className;
          const newTutorId = f.get('tutorId')||null;
          all[idx].tutorId = newTutorId;
          if(oldTutorId!==newTutorId){
            if(oldTutorId){ const ti=all.findIndex(u=>u.id===oldTutorId); if(ti>-1) all[ti].studentIds=(all[ti].studentIds||[]).filter(id=>id!==editingId); }
            if(newTutorId){ const ti=all.findIndex(u=>u.id===newTutorId); if(ti>-1) all[ti].studentIds=[...new Set([...(all[ti].studentIds||[]), editingId])]; }
          }
        } else {
          all[idx].phone = f.get('phone')||all[idx].phone;
        }
        if(all[idx].role==='guardian'){
          syncGuardianChildren(all, editingId, f.getAll('childIds'));
        }
        saveUsers(all);
        toast('ইউজার আপডেট হয়েছে ✅','success');
      }
      state.editingUserId = null;
      state.adduserSelectedChildIds = [];
      renderView();
      return;
    }

    const role = f.get('role');
    const nu = { id:uid('u'), role, name:f.get('name'), username:newUsername, password:f.get('password')||'1234' };
    if(role==='student'){
      nu.tutorId = f.get('tutorId')||null; nu.guardianId=null;
      nu.className = f.get('className')||CLASSES[0];
      nu.nickname = f.get('nickname')||'';
    } else {
      nu.phone = f.get('phone')||'';
    }
    if(role==='tutor') nu.studentIds = [];
    if(role==='guardian') nu.childIds = [];
    const all = users(); all.push(nu);
    if(role==='student' && nu.tutorId){
      const ti = all.findIndex(x=>x.id===nu.tutorId);
      if(ti>-1){ all[ti].studentIds = [...(all[ti].studentIds||[]), nu.id]; }
    }
    if(role==='guardian'){
      syncGuardianChildren(all, nu.id, f.getAll('childIds'));
    }
    saveUsers(all);
    state.stickyAdduserRole = role;
    if(role==='student') state.stickyAdduserClassName = nu.className;
    state.adduserSelectedChildIds = [];
    toast(`${nu.name} যুক্ত হয়েছে ✅ (ইউজারনেম: ${nu.username}, পাসওয়ার্ড: ${nu.password})`,'success');
    renderView();
  }
});

/* ==========================================================
   PWA: install prompt + service worker
   ========================================================== */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); deferredPrompt = e;
  document.getElementById('install-btn').hidden = false;
});
document.getElementById('install-btn').addEventListener('click', async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('install-btn').hidden = true;
});
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{ /* offline file:// context, ignore */ });
  });
  // Clicking a system notification (see notificationclick in sw.js) posts this
  // message to an already-open tab so we can jump straight to the right screen.
  navigator.serviceWorker.addEventListener('message', (e)=>{
    if(e.data && e.data.type==='notification-click' && currentUser()){
      state.view = e.data.view || 'dashboard';
      buildNav();
      renderView();
    }
  });
}
// If the SW had to open a brand-new window/tab for the click (no tab was open),
// it does so via ?view=xxx — honour that on first boot, then clean the URL.
(function applyNotificationDeepLink(){
  const params = new URLSearchParams(window.location.search);
  const v = params.get('view');
  if(v){ state.pendingDeepLinkView = v; history.replaceState(null, '', window.location.pathname); }
})();

/* ---------- go (cloud-aware startup) ---------- */
const resetBtn = document.getElementById('reset-data-btn');
if(resetBtn) resetBtn.addEventListener('click', ()=>{
  if(confirm('এই ডিভাইসের লোকাল কপি মুছে আবার ক্লাউড থেকে/নতুন করে শুরু করবেন?')){
    localStorage.clear();
    location.reload();
  }
});

function updateSyncBadge(){
  const badge = document.getElementById('sync-badge');
  if(!badge) return;
  // cloudSyncHasError (see cloud-push-failed listener below) means the initial
  // connection succeeded (so this would otherwise still show 🌐) but an actual
  // write/read to Firestore is failing — e.g. expired security rules, revoked
  // domain authorization, or a quota issue. Without this, a task the tutor
  // adds can silently never reach Firestore while the badge keeps claiming
  // "live sync on", and nobody finds out until a student says "my reading
  // never arrived".
  if(cloudSyncHasError){
    badge.textContent = '⚠️'; badge.title = 'ক্লাউডে সেভ/সিঙ্ক ব্যর্থ হচ্ছে — এই পরিবর্তন অন্য ডিভাইসে নাও পৌঁছাতে পারে। ইন্টারনেট ও Firebase সেটিংস (Security Rules / Authorized domains) চেক করুন।';
    badge.classList.add('offline');
    return;
  }
  if(window.CloudSync && window.CloudSync.connected){
    badge.textContent = '🌐'; badge.title = 'লাইভ সিঙ্ক চালু — সবার ডিভাইসে আপডেট হচ্ছে';
    badge.classList.remove('offline');
  } else {
    badge.textContent = '📴'; badge.title = 'অফলাইন মোড — এই ডিভাইসেই শুধু সেভ হচ্ছে';
    badge.classList.add('offline');
  }
}

let appStarted = false;
function startApp(){
  if(appStarted) return; appStarted = true;
  const statusEl = document.getElementById('cloud-status');
  try{
    if(window.CloudSync && window.CloudSync.connected){
      if(window.CloudSync.needsSeed){
        seed(true);              // cloud was empty — create the baseline demo data once
        window.CloudSync.markSeeded();
      }
      // else: real shared data was already pulled into localStorage by firebase-sync.js
    } else {
      seed();                    // offline / firebase unreachable — local-only fallback
    }
  }catch(e){ showFatalError('ডেমো ডাটা তৈরি করা যায়নি: ' + e.message); }

  if(statusEl) statusEl.remove();
  updateSyncBadge();
  try{ boot(); }catch(e){ showFatalError('অ্যাপ চালু করা যায়নি: ' + e.message + '\n' + (e.stack||'')); }
}

// live updates arriving from another device
window.addEventListener('cloud-update', (e)=>{
  if(e.detail && e.detail.key) DB.invalidate(e.detail.key);
  updateSyncBadge();
  if(!document.getElementById('app').hidden){ renderView(); renderNotifBell(); }
});

// a push/read to Firestore actually failed even though we're "connected" —
// this is the case the old code missed silently (see badge comment above).
let lastCloudErrorToastAt = 0;
window.addEventListener('cloud-push-failed', (e)=>{
  cloudSyncHasError = true;
  updateSyncBadge();
  // don't spam a toast per failed record — at most once every 20s
  const now = Date.now();
  if(now - lastCloudErrorToastAt > 20000){
    lastCloudErrorToastAt = now;
    toast('⚠️ ক্লাউডে সেভ ব্যর্থ হচ্ছে — এই পরিবর্তন হয়তো অন্য ডিভাইসে পৌঁছাচ্ছে না। ইন্টারনেট/Firebase সেটিংস চেক করুন।', 'warn');
  }
});
window.addEventListener('cloud-push-ok', ()=>{
  if(cloudSyncHasError){ cloudSyncHasError = false; updateSyncBadge(); }
});

if(window.CloudSync) window.CloudSync.onReady(startApp);
window.addEventListener('cloud-ready', startApp);
setTimeout(startApp, 4500); // absolute fallback if firebase-sync.js never loads at all
