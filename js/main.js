/* ==========================================================================
   main.js — সাইটের কনফিগ, রেন্ডারিং, নেভিগেশন, "কিনুন" মডাল
   ---------------------------------------------------------------
   এই ফাইলের একদম উপরের SITE_CONFIG অবজেক্টটাই একমাত্র জায়গা যেখানে আপনাকে
   নিজের নাম-নম্বর-লিংক বসাতে হবে। বাকি কোড এমনিতেই কাজ করবে।
   ========================================================================== */

const SITE_CONFIG = {
  siteName: 'অ্যাপবাজার',
  ownerName: 'আপনার নাম / প্রতিষ্ঠানের নাম',
  tagline: 'স্থানীয় ব্যবসা ও প্রতিষ্ঠানের জন্য তৈরি, ব্যবহার-বান্ধব ওয়েব অ্যাপ',
  email: 'you@example.com',
  whatsappNumber: '8801XXXXXXXXX',   // দেশের কোড-সহ, শুরুতে + বা ০ ছাড়া
  messengerUsername: '',             // আপনার Facebook Page-এর ইউজারনেম, যেমনঃ 'apps.bazaar'
                                      // (আপনার পেজের লিংক facebook.com/apps.bazaar হলে
                                      // এখানে শুধু 'apps.bazaar' বসান) — খালি রাখলে
                                      // "কিনুন" মডালে মেসেঞ্জার অপশন দেখাবে না।
                                      // ⚠️ এটা একটা Facebook PAGE-এর ইউজারনেম হতে হবে,
                                      // ব্যক্তিগত প্রোফাইল দিয়ে কাজ করে না।
  bkashNumber: '01XXXXXXXXX',
  nagadNumber: '01XXXXXXXXX',
  facebook: '#',
  socialLinks: [
    { label:'Facebook', icon:'f', url:'#' },
    { label:'YouTube',  icon:'▶', url:'#' },
  ],

  /* ------------------------------------------------------------------
     অর্ডার ব্যাকআপ (ঐচ্ছিক, কিন্তু জোরালোভাবে সুপারিশ করা হচ্ছে)
     ------------------------------------------------------------------
     সমস্যাটা যা সমাধান করে: এখন কাস্টমার ফর্ম পূরণ করলে সেটা শুধু WhatsApp-এ
     একটা মেসেজ খুলে দেয় — কিন্তু কাস্টমার যদি ভুলে "Send" না চাপে, সেই
     অর্ডারটা কোথাও থাকবে না, একদম হারিয়ে যাবে। নিচের দুটোর যেকোনো একটা
     (বা দুটোই) কনফিগার করলে, "Send" চাপুক বা না চাপুক, ফর্ম সাবমিট করা
     মাত্রই ডাটাটা ব্যাকআপ হিসেবে সেভ হয়ে যাবে — কোনো কোড লেখা লাগবে না,
     শুধু নিচের ফাঁকা জায়গাগুলো পূরণ করুন। দুটোই ফাঁকা রাখলে এই ফিচারটা
     এমনিই বন্ধ থাকবে, সাইট আগের মতোই (শুধু WhatsApp-নির্ভর) কাজ করবে।

     ১) Formspree (সবচেয়ে দ্রুত সেটআপ, ~৫ মিনিট):
        ক) https://formspree.io -এ ফ্রি অ্যাকাউন্ট খুলুন
        খ) "New Form" বানান (নাম যা খুশি দিন)
        গ) যে endpoint URL দেখাবে (যেমনঃ https://formspree.io/f/mgvzxxxx)
           সেটা নিচের formspreeEndpoint-এ বসিয়ে দিন
        ঘ) প্রতিটা সাবমিশনের ইমেইল আপনার ইনবক্সেও চলে আসবে, আর Formspree
           ড্যাশবোর্ডেও (formspree.io ড্যাশবোর্ড) তালিকা আকারে দেখা যাবে —
           এটাই সবচেয়ে সহজ "অ্যাডমিন প্যানেল", কোনো কোড ছাড়াই।
        ফ্রি প্ল্যানে মাসে ৫০টা সাবমিশন পর্যন্ত চলে — শুরুর জন্য যথেষ্ট।
  */
  formspreeEndpoint: '', // যেমনঃ 'https://formspree.io/f/mgvzxxxx'

  /* ২) Google Form (ডাটা সরাসরি Google Sheets-এ জমা হয়, স্প্রেডশিটে দেখতে
        চাইলে এটা সুবিধাজনক):
        ক) একটা নতুন Google Form বানান, এই প্রশ্নগুলো (ঠিক এই ক্রমে না
           হলেও চলবে) রাখুন: নাম, মোবাইল, অ্যাপের নাম, পেমেন্ট মাধ্যম,
           ট্রানজেকশন আইডি
        খ) ফর্মটা "Send" করার সময় লিংক-আইকনে ক্লিক করে নিজের লিংকটা কপি
           করুন, শেষের "/viewform" অংশটা "/formResponse" দিয়ে বদলে
           googleFormUrl-এ বসান
        গ) প্রতিটা প্রশ্নের নিজস্ব entry নম্বর বের করতে — ফর্মের উপরের
           ডান দিকের "⋮" মেনু থেকে "Get pre-filled link" চাপুন, প্রতিটা
           প্রশ্নে যেকোনো একটা টেস্ট উত্তর দিয়ে "Get link" চাপুন — এরপর যে
           লিংকটা পাবেন তাতে entry.123456789=আপনার-টেস্ট-উত্তর এভাবে
           প্রতিটা প্রশ্নের entry নম্বর দেখা যাবে — সেগুলো নিচে বসান।
  */
  googleFormUrl: '', // যেমনঃ 'https://docs.google.com/forms/d/e/xxxxxxxxxxxxxxxx/formResponse'
  googleFormFields: {
    name:   '', // যেমনঃ 'entry.123456789'
    phone:  '',
    app:    '',
    method: '',
    txn:    '',
  },
};

/* ---------- ছোট হেল্পার ---------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
function fmtTaka(n){ return n===0 ? 'ফ্রি' : `৳${Number(n).toLocaleString('bn-BD')}`; }
/* originalPrice দেওয়া থাকলে ও price-এর চেয়ে বেশি হলে ছাড়ের শতাংশ বের করে, নাহলে null */
function discountPercent(p){
  if(!p.originalPrice || p.originalPrice<=p.price) return null;
  return Math.round((1 - p.price/p.originalPrice)*100);
}
/* billing অনুযায়ী দামের পাশে যে ছোট লেজুড় বসবে — যেমন ৳৫০০/মাস */
const BILLING_SUFFIX = { monthly:'/মাস', yearly:'/বছর', onetime:'' };
function billingSuffix(p){ return BILLING_SUFFIX[p.billing] || ''; }
/* installment দেওয়া থাকলে "৩ কিস্তিতে ৳১০০০ করে" ধরনের লাইন বানায় */
function installmentText(p){
  const ins = p.installment;
  if(!ins || !ins.count || !ins.amount) return null;
  const count = Number(ins.count).toLocaleString('bn-BD');
  return `অথবা ${count} কিস্তিতে ${fmtTaka(ins.amount)} করে`;
}
function priceRowHtml(p, big){
  const disc = discountPercent(p);
  const nowCls = big ? 'price-big' : 'app-price';
  const ins = installmentText(p);
  return `
    <div class="${nowCls}">
      ${fmtTaka(p.price)}<span class="price-suffix">${billingSuffix(p)}</span> ${p.priceNote?`<small>${p.priceNote}</small>`:''}
      ${disc!==null ? `<div class="price-was">${fmtTaka(p.originalPrice)}${billingSuffix(p)}</div>` : ''}
      ${ins ? `<div class="price-installment">🗓️ ${ins}</div>` : ''}
    </div>`;
}
function getParam(name){ return new URLSearchParams(window.location.search).get(name); }

function toast(msg){
  let el = $('#toast');
  if(!el){ el = document.createElement('div'); el.id='toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(()=> el.classList.remove('show'), 2600);
}

/* অর্ডার-ব্যাকআপ: WhatsApp-এ "Send" চাপা হোক বা না হোক, ফর্ম সাবমিট হওয়া
   মাত্রই (কনফিগার করা থাকলে) Formspree/Google Form-এ ডাটা পাঠিয়ে দেয় —
   ব্যর্থ হলেও নীরবে ব্যর্থ হয়, কখনো WhatsApp ফ্লো আটকায় না। */
function submitOrderBackup(data){
  const cfg = SITE_CONFIG;
  if(cfg.formspreeEndpoint){
    fetch(cfg.formspreeEndpoint, {
      method:'POST',
      headers:{ 'Accept':'application/json', 'Content-Type':'application/json' },
      body: JSON.stringify(data)
    }).catch(()=>{ /* ব্যাকআপ ব্যর্থ হলেও চুপচাপ উপেক্ষা করি — WhatsApp-ই প্রধান পথ */ });
  }
  if(cfg.googleFormUrl && cfg.googleFormFields){
    const hasAnyEntry = Object.values(cfg.googleFormFields).some(v=>v);
    if(hasAnyEntry){
      const body = new URLSearchParams();
      Object.entries(cfg.googleFormFields).forEach(([key, entryId])=>{
        if(entryId) body.append(entryId, data[key] || '');
      });
      // Google Forms-এর formResponse এন্ডপয়েন্ট CORS রেসপন্স দেয় না, তাই
      // mode:'no-cors' — রেসপন্স পড়া যাবে না, কিন্তু সাবমিশন ঠিকই হয়ে যায়।
      fetch(cfg.googleFormUrl, { method:'POST', mode:'no-cors', body }).catch(()=>{});
    }
  }
}

/* ---------- হেডার/ফুটার/সাধারণ চেরোম বসানো (প্রতিটা পেজে একই রাখতে) ---------- */
function paintChrome(activePage){
  $$('[data-site-name]').forEach(el=> el.textContent = SITE_CONFIG.siteName);
  $$('[data-owner-name]').forEach(el=> el.textContent = SITE_CONFIG.ownerName);
  $$('[data-year]').forEach(el=> el.textContent = new Date().getFullYear());
  $$('[data-email]').forEach(el=> { el.textContent = SITE_CONFIG.email; el.href = 'mailto:'+SITE_CONFIG.email; });
  $$('[data-whatsapp-link]').forEach(el=> el.href = waLink('আসসালামু আলাইকুম, আমি '+SITE_CONFIG.siteName+' সম্পর্কে জানতে চাই।'));
  $$(`.main-nav a[data-page]`).forEach(a=>{
    a.classList.toggle('active', a.dataset.page===activePage);
  });

  const toggle = $('.nav-toggle');
  const nav = $('.main-nav');
  if(toggle && nav){
    toggle.addEventListener('click', ()=>{
      const open = nav.style.display === 'flex';
      nav.style.display = open ? '' : 'flex';
      if(!open){
        nav.style.cssText = 'display:flex; position:absolute; top:78px; left:0; right:0; background:#FFFCF6; flex-direction:column; padding:14px 20px; gap:4px; border-bottom:2px solid var(--border);';
      }
    });
  }
}

function waLink(text){
  return `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(text)}`;
}
function messengerLink(text){
  return `https://m.me/${SITE_CONFIG.messengerUsername}?text=${encodeURIComponent(text)}`;
}

/* ---------- অ্যাপ কার্ড / থাম্বনেইল রেন্ডার ---------- */
const ACCENT_GRADIENTS = {
  pink:   'linear-gradient(135deg, #FF3E70, #FF9AAE)',
  teal:   'linear-gradient(135deg, #04A777, #6FE3BE)',
  yellow: 'linear-gradient(135deg, #FFB627, #FFDD94)',
  violet: 'linear-gradient(135deg, #7B5CFA, #C6B7FF)',
};
/* thumbnail ছবি দেওয়া থাকলে সেটা দেখাবে, না দিলে emoji+রঙিন গ্র্যাডিয়েন্টে ফিরে যাবে */
function thumbStyle(p){
  return p.thumbnail
    ? `background-image:url('${p.thumbnail}'); background-size:cover; background-position:center;`
    : `background:${ACCENT_GRADIENTS[p.accent]||ACCENT_GRADIENTS.pink};`;
}
/* বিভিন্ন ফরম্যাটের ইউটিউব লিংক (watch?v=, youtu.be/, shorts/, ইতিমধ্যে embed) থেকে
   embed URL বানায় — কোনোটা না মিললে null ফেরত দেয়, তখন এমবেড না করে শুধু বাটন দেখাই */
function youtubeEmbedUrl(url){
  if(!url) return null;
  const patterns = [
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
  ];
  for(const re of patterns){
    const m = url.match(re);
    if(m) return `https://www.youtube.com/embed/${m[1]}`;
  }
  return null;
}

function appCardHtml(p){
  const soon = p.status==='soon';
  return `
  <div class="app-card ${soon?'soon':''}">
    <a href="app.html?slug=${p.slug}" class="app-thumb ${p.thumbnail?'has-image':''}" style="${thumbStyle(p)}">
      ${p.thumbnail? '' : (p.icon||'📦')}
      ${!soon && discountPercent(p)!==null ? `<span class="tag pink discount-badge">${discountPercent(p)}% ছাড়</span>` : ''}
      <span class="tag ${soon?'soon':p.accent} thumb-tag">${soon? 'শীঘ্রই আসছে' : (CATEGORIES.find(c=>c.id===p.category)||{}).label||''}</span>
    </a>
    <div class="app-body">
      <h3><a href="app.html?slug=${p.slug}">${p.name}</a></h3>
      <p class="app-tagline">${p.tagline}</p>
      <div class="app-meta-row">
        ${soon ? `<div class="app-price">—</div>` : priceRowHtml(p, false)}
        <div class="app-actions">
          ${soon
            ? `<span class="tag soon">প্রিভিউ</span>`
            : `<a class="btn btn-outline btn-sm" href="app.html?slug=${p.slug}">দেখুন</a>`}
        </div>
      </div>
    </div>
  </div>`;
}

function renderGrid(container, list){
  if(!container) return;
  if(!list.length){ container.innerHTML = `<div class="empty-note">এই ফিল্টারে কোনো অ্যাপ পাওয়া যায়নি।</div>`; return; }
  container.innerHTML = list.map(appCardHtml).join('');
}

/* ---------- হোমপেজ: ফিচারড অ্যাপ ---------- */
/* Fisher-Yates শাফল — মূল PRODUCTS অ্যারে অক্ষত রেখে একটা এলোমেলো কপি ফেরত দেয়,
   যাতে হোমপেজে প্রতিবার ভিন্ন অ্যাপ আগে দেখা যায় (সব অ্যাপই সমান সুযোগ পায়) */
function shuffled(arr){
  const a = arr.slice();
  for(let i=a.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initHomeApps(){
  const track = $('#featured-apps-track');
  if(!track) return;
  const list = shuffled(PRODUCTS);
  track.innerHTML = list.map(p=>`<div class="carousel-item">${appCardHtml(p)}</div>`).join('');

  const prev = $('#featured-prev'), next = $('#featured-next'), dotsWrap = $('#featured-dots');

  /* এক "পেজ" = ট্র্যাকের দৃশ্যমান প্রস্থ (ডেস্কটপে ৩টা কার্ড, ট্যাবে ২টা, মোবাইলে ১টা —
     CSS-ই ঠিক করে দেয়, তাই এখানে হার্ডকোড করা লাগে না) */
  const pageCount = ()=> Math.max(1, Math.ceil(track.scrollWidth / track.clientWidth));
  const currentPage = ()=> Math.round(track.scrollLeft / track.clientWidth);

  function renderDots(){
    if(!dotsWrap) return;
    const total = pageCount();
    if(total<=1){ dotsWrap.innerHTML=''; return; }
    const cur = currentPage();
    dotsWrap.innerHTML = Array.from({length:total}, (_,i)=>
      `<button class="carousel-dot ${i===cur?'active':''}" data-page="${i}" aria-label="পেজ ${i+1}"></button>`).join('');
  }
  function updateArrows(){
    if(!prev || !next) return;
    const maxScroll = track.scrollWidth - track.clientWidth - 2; // ২px সহনশীলতা
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= maxScroll;
  }
  function scrollByPage(dir){
    track.scrollBy({ left: dir * track.clientWidth, behavior:'smooth' });
  }

  prev?.addEventListener('click', ()=> scrollByPage(-1));
  next?.addEventListener('click', ()=> scrollByPage(1));
  dotsWrap?.addEventListener('click', (e)=>{
    const dot = e.target.closest('.carousel-dot'); if(!dot) return;
    track.scrollTo({ left: Number(dot.dataset.page) * track.clientWidth, behavior:'smooth' });
  });
  track.addEventListener('scroll', ()=>{
    clearTimeout(track._t);
    track._t = setTimeout(()=>{ renderDots(); updateArrows(); }, 90);
  });
  window.addEventListener('resize', ()=>{ renderDots(); updateArrows(); });

  renderDots(); updateArrows();
}

/* ---------- ক্যাটালগ পেজ: সার্চ + ক্যাটাগরি ফিল্টার ---------- */
function initCatalog(){
  const grid = $('#catalog-grid');
  const chipRow = $('#category-strip');
  const searchInput = $('#catalog-search');
  if(!grid || !chipRow) return;

  chipRow.innerHTML = `<button class="category-chip active" data-cat="all">সব</button>` +
    CATEGORIES.map(c=>`<button class="category-chip" data-cat="${c.id}">${c.label}</button>`).join('');

  let activeCat = 'all';
  function apply(){
    const q = (searchInput?.value||'').trim().toLowerCase();
    const list = PRODUCTS.filter(p=>{
      const matchCat = activeCat==='all' || p.category===activeCat;
      const matchQ = !q || (p.name+p.tagline).toLowerCase().includes(q);
      return matchCat && matchQ;
    });
    renderGrid(grid, list);
  }
  chipRow.addEventListener('click', (e)=>{
    const btn = e.target.closest('.category-chip'); if(!btn) return;
    activeCat = btn.dataset.cat;
    $$('.category-chip', chipRow).forEach(b=>b.classList.toggle('active', b===btn));
    apply();
  });
  searchInput?.addEventListener('input', apply);
  apply();
}

/* ---------- ডিটেইল পেজ ---------- */
function initDetailPage(){
  const root = $('#app-detail-root');
  if(!root) return;
  const slug = getParam('slug');
  const p = PRODUCTS.find(x=>x.slug===slug);
  if(!p){
    root.innerHTML = `<div class="empty-note">এই অ্যাপটা খুঁজে পাওয়া যায়নি। <a href="apps.html">সব অ্যাপ দেখুন →</a></div>`;
    document.title = 'পাওয়া যায়নি — ' + SITE_CONFIG.siteName;
    return;
  }
  document.title = `${p.name} — ${SITE_CONFIG.siteName}`;
  const soon = p.status==='soon';
  const catLabel = (CATEGORIES.find(c=>c.id===p.category)||{}).label||'';

  root.innerHTML = `
    <div class="detail-hero">
      <div class="detail-thumb ${p.thumbnail?'has-image':''}" style="${thumbStyle(p)}">${p.thumbnail? '' : (p.icon||'📦')}</div>
      <div class="detail-info">
        <span class="tag ${soon?'soon':p.accent}">${soon?'শীঘ্রই আসছে':catLabel}</span>
        <h1>${p.name}</h1>
        <p style="font-size:1.08rem">${p.tagline}</p>
        <div class="detail-actions" style="margin-bottom:6px">
          ${p.demoUrl && !soon ? `<a class="btn btn-outline" href="${p.demoUrl}" target="_blank" rel="noopener">🔍 লাইভ ডেমো দেখুন</a>` : ''}
          ${p.youtubeUrl ? `<a class="btn btn-outline" href="${p.youtubeUrl}" target="_blank" rel="noopener">▶️ ইউটিউবে দেখুন</a>` : ''}
        </div>
        <div class="price-box">
          ${soon
            ? `<p style="margin:0">এই অ্যাপটা এখনো তৈরি হচ্ছে — মুক্তি পেলে সবার আগে জানতে যোগাযোগ করে রাখতে পারেন।</p>`
            : priceRowHtml(p, true)}
          <div class="detail-actions">
            ${soon
              ? `<a class="btn btn-dark btn-block" href="${waLink('আসসালামু আলাইকুম, \"'+p.name+'\" অ্যাপটা মুক্তি পেলে আমাকে জানাবেন।')}" target="_blank" rel="noopener">🔔 মুক্তি পেলে জানাতে বলুন</a>`
              : `<button class="btn btn-primary btn-block" id="open-buy-btn">🛒 কিনুন</button>`}
          </div>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div>
        <h2>বিস্তারিত</h2>
        ${p.description.split('\n\n').map(para=>`<p>${para}</p>`).join('')}
        ${youtubeEmbedUrl(p.youtubeUrl) ? `
        <h2 style="margin-top:34px">🎥 কাজের নমুনা / কীভাবে চালাতে হয়</h2>
        <div class="video-embed">
          <iframe src="${youtubeEmbedUrl(p.youtubeUrl)}" title="${p.name} ডেমো ভিডিও" frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>` : ''}
      </div>
      <div>
        ${p.features && p.features.length ? `
        <h2>যা যা থাকছে</h2>
        <ul class="feature-list">
          ${p.features.map(f=>`<li><span class="ic">✓</span>${f}</li>`).join('')}
        </ul>` : ''}
      </div>
    </div>
  `;

  if(!soon){
    $('#open-buy-btn')?.addEventListener('click', ()=> openBuyModal(p));
  }
}

/* ---------- "কিনুন" মডাল ---------- */
function ensureModal(){
  if($('#buy-modal')) return;
  const hasMessenger = !!SITE_CONFIG.messengerUsername;
  const el = document.createElement('div');
  el.id = 'buy-modal';
  el.className = 'modal-overlay';
  el.innerHTML = `
    <div class="modal-box">
      <button class="modal-close" id="buy-modal-close">✕</button>
      <h3 id="buy-modal-title">কিনুন</h3>
      <p class="modal-app-name" id="buy-modal-appname"></p>
      <div class="buy-tabs">
        <button class="buy-tab active" data-tab="whatsapp">💬 WhatsApp</button>
        ${hasMessenger ? `<button class="buy-tab" data-tab="messenger">📩 মেসেঞ্জার</button>` : ''}
        <button class="buy-tab" data-tab="manual">💳 bKash/Nagad</button>
      </div>
      <div class="pay-panel active" data-panel="whatsapp">
        <div class="wa-preview" id="wa-preview-text"></div>
        <form id="whatsapp-order-form">
          <div class="form-field"><label>আপনার নাম</label><input type="text" name="name" required /></div>
          <div class="form-field"><label>মোবাইল নম্বর (ঐচ্ছিক)</label><input type="tel" name="phone" /></div>
          <button class="btn btn-teal btn-block" type="submit">💬 WhatsApp-এ পাঠান</button>
        </form>
      </div>
      ${hasMessenger ? `
      <div class="pay-panel" data-panel="messenger">
        <div class="wa-preview" id="msg-preview-text"></div>
        <form id="messenger-order-form">
          <div class="form-field"><label>আপনার নাম</label><input type="text" name="name" required /></div>
          <div class="form-field"><label>মোবাইল নম্বর (ঐচ্ছিক)</label><input type="tel" name="phone" /></div>
          <button class="btn btn-dark btn-block" type="submit">📩 মেসেঞ্জারে পাঠান</button>
        </form>
        <p class="pay-note">মেসেঞ্জার খুলে গেলে বার্তাটা আগে থেকেই লেখা থাকবে — শুধু Send চাপুন। কোনো কারণে লেখা না এলে, নিজে থেকে অ্যাপের নাম উল্লেখ করে একটা মেসেজ পাঠিয়ে দিন।</p>
      </div>` : ''}
      <div class="pay-panel" data-panel="manual">
        <div class="pay-number-box">
          <div><span class="method">bKash (Personal/Send Money)</span><b id="bkash-number-text"></b></div>
          <button class="copy-btn" data-copy-target="bkash-number-text">কপি</button>
        </div>
        <div class="pay-number-box">
          <div><span class="method">Nagad (Personal/Send Money)</span><b id="nagad-number-text"></b></div>
          <button class="copy-btn" data-copy-target="nagad-number-text">কপি</button>
        </div>
        <p class="pay-note">উপরের নম্বরে টাকা পাঠিয়ে নিচের ফর্মটা পূরণ করুন — অর্ডার কনফার্ম করে দ্রুত যোগাযোগ করা হবে।</p>
        <form id="manual-order-form">
          <div class="form-field"><label>আপনার নাম</label><input type="text" name="name" required /></div>
          <div class="form-field"><label>মোবাইল নম্বর</label><input type="tel" name="phone" required /></div>
          <div class="form-field"><label>পেমেন্ট মাধ্যম</label>
            <select name="method"><option>bKash</option><option>Nagad</option></select>
          </div>
          <div class="form-field"><label>ট্রানজেকশন আইডি</label><input type="text" name="txn" required /></div>
          <button class="btn btn-primary btn-block" type="submit">✅ অর্ডার সাবমিট করুন</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (e)=>{ if(e.target===el) closeBuyModal(); });
  $('#buy-modal-close').addEventListener('click', closeBuyModal);

  $$('.buy-tab', el).forEach(tab=>{
    tab.addEventListener('click', ()=>{
      $$('.buy-tab', el).forEach(t=>t.classList.toggle('active', t===tab));
      $$('.pay-panel', el).forEach(p=>p.classList.toggle('active', p.dataset.panel===tab.dataset.tab));
    });
  });
  $$('.copy-btn', el).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const text = $('#'+btn.dataset.copyTarget).textContent;
      navigator.clipboard?.writeText(text).then(()=> toast('নম্বর কপি হয়েছে ✅')).catch(()=>{});
    });
  });
  $('#whatsapp-order-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get('name'), phone = f.get('phone')||'';
    const appName = $('#buy-modal-appname').dataset.appName || '';
    const appPrice = $('#buy-modal-appname').dataset.appPrice || '';
    const msg = `আসসালামু আলাইকুম, আমি "${appName}" অ্যাপটা (${appPrice}) কিনতে চাই।\nনাম: ${name}${phone?`\nমোবাইল: ${phone}`:''}`;
    submitOrderBackup({ name, phone, app: appName, method:'WhatsApp', txn:'' });
    window.open(waLink(msg), '_blank');
    toast('WhatsApp খুলে যাচ্ছে — বার্তাটা পাঠাতে ভুলবেন না! ✅');
    e.target.reset();
    closeBuyModal();
  });
  $('#messenger-order-form')?.addEventListener('submit', (e)=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get('name'), phone = f.get('phone')||'';
    const appName = $('#buy-modal-appname').dataset.appName || '';
    const appPrice = $('#buy-modal-appname').dataset.appPrice || '';
    const msg = `আসসালামু আলাইকুম, আমি "${appName}" অ্যাপটা (${appPrice}) কিনতে চাই।\nনাম: ${name}${phone?`\nমোবাইল: ${phone}`:''}`;
    submitOrderBackup({ name, phone, app: appName, method:'Messenger', txn:'' });
    window.open(messengerLink(msg), '_blank');
    toast('মেসেঞ্জার খুলে যাচ্ছে — বার্তাটা পাঠাতে ভুলবেন না! ✅');
    e.target.reset();
    closeBuyModal();
  });
  $('#manual-order-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const name = f.get('name'), phone = f.get('phone'), method = f.get('method'), txn = f.get('txn');
    const appName = $('#buy-modal-appname').dataset.appName || '';
    const msg = `অর্ডার নিশ্চিতকরণ\nঅ্যাপ: ${appName}\nনাম: ${name}\nমোবাইল: ${phone}\nপেমেন্ট: ${method}\nট্রানজেকশন আইডি: ${txn}`;
    submitOrderBackup({ name, phone, app: appName, method, txn });
    window.open(waLink(msg), '_blank');
    toast('অর্ডার তথ্য পাঠানো হয়েছে — শীঘ্রই যোগাযোগ করা হবে ✅');
    e.target.reset();
    closeBuyModal();
  });
}
function openBuyModal(product){
  ensureModal();
  // দাম + billing লেজুড় (যেমন ৳৫০০/মাস) — কিস্তির তথ্য থাকলে সেটাও বার্তায় যোগ হয়,
  // যাতে অর্ডারের মেসেজ দেখেই বোঝা যায় কোন প্যাকেজে কিনতে চাইছে
  const priceText = fmtTaka(product.price) + billingSuffix(product);
  const ins = installmentText(product);
  $('#buy-modal-appname').textContent = product.name + ' — ' + priceText + (product.priceNote?' ('+product.priceNote+')':'') + (ins? ' · '+ins : '');
  $('#buy-modal-appname').dataset.appName = product.name;
  $('#buy-modal-appname').dataset.appPrice = priceText + (ins? ' ('+ins+')' : '');
  $('#bkash-number-text').textContent = SITE_CONFIG.bkashNumber;
  $('#nagad-number-text').textContent = SITE_CONFIG.nagadNumber;
  const previewText = `আপনি কিনছেন: ${product.name} — ${priceText}${ins? '\n'+ins : ''}`;
  $('#wa-preview-text').textContent = previewText;
  const msgPreview = $('#msg-preview-text');
  if(msgPreview) msgPreview.textContent = previewText;
  $('#buy-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeBuyModal(){
  $('#buy-modal')?.classList.remove('open');
  document.body.style.overflow = '';
}

/* ---------- বুট ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  const page = document.body.dataset.page || '';
  paintChrome(page);
  initHomeApps();
  initCatalog();
  initDetailPage();

  // "কিনুন" বাটন — হোম/ক্যাটালগ কার্ড থেকেও যদি সরাসরি খোলার দরকার হয়
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-buy-slug]');
    if(!btn) return;
    const p = PRODUCTS.find(x=>x.slug===btn.dataset.buySlug);
    if(p) openBuyModal(p);
  });
});
