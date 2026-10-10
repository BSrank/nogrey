/* NoGrey — общ фронтенд скрипт (header/footer, количка, данни, снимки, връзка с Apps Script) */

// ⚠️ След деплой на Code.gs като Web App — постави тук URL-а му.
const GOOGLE_SHEETS_CONFIG = {
  webAppUrl: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE'
};

const BGN_RATE = 1.95583;
const CART_KEY = 'nogrey_cart';
const PROMO_KEY = 'nogrey_promo';
const MAX_GALLERY = 12;

const CATEGORY_LABELS = { shampoo: 'Оцветяващ шампоан', serum: 'Серум', set: 'Комплект' };

const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#eef3ef"/>' +
  '<rect x="160" y="110" width="80" height="190" rx="18" fill="#1f4d3a"/><rect x="178" y="88" width="44" height="26" rx="5" fill="#143528"/>' +
  '<rect x="170" y="170" width="60" height="50" rx="6" fill="#fbfaf7"/></svg>'
);

/* ---------- Помощни ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) { return (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace('.', ','); }
function eur(n) { return money(n) + ' €'; }
function bgn(n) { return money(n) + ' лв.'; }
function toBgn(e) { return Math.round(Number(e || 0) * BGN_RATE * 100) / 100; }
function productBgn(p) { return Number(p.priceBgn) > 0 ? Number(p.priceBgn) : toBgn(p.price); }
function qs(name) { return new URLSearchParams(location.search).get(name); }

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Данни (products.json) ---------- */
let STORE = null;
async function loadStore() {
  if (STORE) return STORE;
  try {
    const r = await fetch('products.json?v=' + Date.now(), { cache: 'no-store' });
    STORE = await r.json();
  } catch (e) {
    STORE = { products: [], settings: {}, urgency: {} };
  }
  STORE.products = (STORE.products || []);
  STORE.settings = STORE.settings || {};
  STORE.urgency = STORE.urgency || {};
  return STORE;
}
function activeProducts() { return (STORE.products || []).filter(p => p.active !== false); }
function findProduct(id) { return (STORE.products || []).find(p => String(p.id) === String(id)); }
function urgencyCount(id) {
  const u = STORE.urgency || {};
  if (!u.enabled) return null;
  const n = Number((u.items || {})[id]);
  return n > 0 ? n : null;
}
function showNewBadge(p) { return STORE.settings.showNewListings !== false && p.isNewListing; }

/* ---------- Снимки: imageMain + imagePrefix (вариант zenairpods) ---------- */
function checkImageExists(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
// Паралелна проверка: главна + {prefix}.1.jpg … {prefix}.12.jpg; спира след 2 поредни неуспешни.
async function buildGallery(p) {
  const candidates = [];
  if (p.imageMain) candidates.push(p.imageMain);
  const prefix = (p.imagePrefix || '').trim();
  const numbered = [];
  if (prefix) for (let i = 1; i <= MAX_GALLERY; i++) numbered.push(`${prefix}.${i}.jpg`);
  const results = await Promise.all([...candidates, ...numbered].map(checkImageExists));
  const out = [];
  if (p.imageMain && results[0]) out.push(p.imageMain);
  let misses = 0;
  const offset = candidates.length;
  for (let i = 0; i < numbered.length; i++) {
    if (results[offset + i]) { out.push(numbered[i]); misses = 0; }
    else { misses++; if (misses >= 2) break; }
  }
  return out.length ? out : [PLACEHOLDER_IMG];
}
function mainImage(p) { return p.imageMain || PLACEHOLDER_IMG; }
function imgTag(src, alt, cls) {
  return `<img src="${esc(src)}" alt="${esc(alt)}" ${cls ? `class="${cls}"` : ''} loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">`;
}

/* ---------- Apps Script ---------- */
function scriptReady() { return /^https:\/\/script\.google\.com\//.test(GOOGLE_SHEETS_CONFIG.webAppUrl); }
async function apiGet(params) {
  if (!scriptReady()) throw new Error('Бекендът още не е свързан (webAppUrl).');
  const url = GOOGLE_SHEETS_CONFIG.webAppUrl + '?' + new URLSearchParams(params).toString();
  const r = await fetch(url);
  return r.json();
}
// text/plain → без CORS preflight; Code.gs парсва тялото ръчно като JSON.
async function apiPost(body) {
  if (!scriptReady()) throw new Error('Бекендът още не е свързан (webAppUrl).');
  const r = await fetch(GOOGLE_SHEETS_CONFIG.webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  });
  return r.json();
}

/* ---------- Количка ---------- */
function getCart() { return lsGet(CART_KEY, []); }
function saveCart(c) { lsSet(CART_KEY, c); updateCartCount(); }
function addToCart(id, qty) {
  const c = getCart();
  const row = c.find(x => String(x.id) === String(id));
  if (row) row.qty += qty; else c.push({ id: String(id), qty });
  saveCart(c);
  renderDrawer();
  toast('Добавено в количката');
}
function setQty(id, qty) {
  let c = getCart();
  c = c.map(x => String(x.id) === String(id) ? { ...x, qty: Math.max(1, qty) } : x);
  saveCart(c); renderDrawer();
}
function removeFromCart(id) {
  saveCart(getCart().filter(x => String(x.id) !== String(id)));
  renderDrawer();
}
function cartLines() {
  return getCart().map(x => {
    const p = findProduct(x.id);
    if (!p || p.active === false) return null;
    return { p, qty: x.qty, eur: Number(p.price) * x.qty, bgn: productBgn(p) * x.qty };
  }).filter(Boolean);
}
function cartTotals() {
  const lines = cartLines();
  return {
    lines,
    count: lines.reduce((a, l) => a + l.qty, 0),
    eur: lines.reduce((a, l) => a + l.eur, 0),
    bgn: lines.reduce((a, l) => a + l.bgn, 0)
  };
}
function updateCartCount() {
  const el = document.querySelector('.cart-count');
  if (el && STORE) el.textContent = cartTotals().count;
}
function openCart() { renderDrawer(); document.body.classList.add('cart-open'); }
function closeCart() { document.body.classList.remove('cart-open'); }

function renderDrawer() {
  const body = document.getElementById('drawer-body');
  const foot = document.getElementById('drawer-foot');
  if (!body || !STORE) return;
  const t = cartTotals();
  if (!t.lines.length) {
    body.innerHTML = '<div class="empty-state">Количката е празна.<br><br><a class="btn ghost" href="products.html">Разгледай продуктите</a></div>';
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = t.lines.map(l => `
    <div class="line-item">
      ${imgTag(mainImage(l.p), l.p.name)}
      <div>
        <div class="name">${esc(l.p.name)}</div>
        <div class="muted" style="font-size:.85rem">${eur(l.p.price)} / ${bgn(productBgn(l.p))}</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
          <div class="qty"><button onclick="setQty('${esc(l.p.id)}',${l.qty - 1})">−</button><input value="${l.qty}" readonly><button onclick="setQty('${esc(l.p.id)}',${l.qty + 1})">+</button></div>
          <button class="remove" onclick="removeFromCart('${esc(l.p.id)}')">Премахни</button>
        </div>
      </div>
      <div style="font-weight:800">${eur(l.eur)}</div>
    </div>`).join('');
  const thr = Number(STORE.settings.freeShippingThreshold || 0);
  const shipNote = thr > 0 ? (t.eur >= thr ? 'Безплатна доставка ✓' : `Още ${eur(thr - t.eur)} до безплатна доставка`) : 'Доставка по тарифа на Econt';
  foot.innerHTML = `
    <div class="totals">
      <div><span>Междинна сума</span><span>${eur(t.eur)}</span></div>
      <div class="muted" style="font-size:.88rem"><span>${shipNote}</span><span></span></div>
      <div class="grand"><span>Общо</span><span>${eur(t.eur)} <small class="muted">/ ${bgn(t.bgn)}</small></span></div>
    </div>
    <a class="btn block" href="checkout.html">Към поръчката</a>
    <p class="muted" style="font-size:.82rem;text-align:center;margin:10px 0 0">Плащане с наложен платеж при получаване</p>`;
}

/* ---------- Header / Footer ---------- */
function renderChrome(active) {
  const s = STORE.settings;
  const name = s.storeName || 'NoGrey';
  const head = document.getElementById('site-header');
  if (head) head.outerHTML = `
    <div class="announce">${esc(s.announcement || '')}</div>
    <header class="site-header">
      <div class="container">
        <a class="logo" href="index.html"><span class="logo-mark">N</span>${esc(name)}</a>
        <nav class="nav" id="nav">
          <a href="index.html" class="${active === 'home' ? 'active' : ''}">Начало</a>
          <a href="products.html" class="${active === 'products' ? 'active' : ''}">Продукти</a>
          <a href="index.html#how">Как действа</a>
          <a href="index.html#reviews">Ревюта</a>
          <a href="index.html#contact">Контакт</a>
        </nav>
        <button class="menu-toggle" aria-label="Меню" onclick="document.getElementById('nav').classList.toggle('open')">☰</button>
        <button class="cart-btn" onclick="openCart()" aria-label="Количка">Количка <span class="cart-count">0</span></button>
      </div>
    </header>
    <div class="drawer-backdrop" onclick="closeCart()"></div>
    <aside class="drawer" aria-label="Количка">
      <div class="drawer-head"><h3 style="margin:0">Твоята количка</h3><button onclick="closeCart()" aria-label="Затвори">×</button></div>
      <div class="drawer-body" id="drawer-body"></div>
      <div class="drawer-foot" id="drawer-foot"></div>
    </aside>`;
  const foot = document.getElementById('site-footer');
  if (foot) foot.outerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="cols">
          <div>
            <h4>${esc(name)}</h4>
            <p>Оцветяващи шампоани и серуми против бяла коса и брада. Доставка с Econt в цяла България, плащане при получаване.</p>
          </div>
          <div><h4>Магазин</h4><ul>
            <li><a href="products.html">Всички продукти</a></li>
            <li><a href="products.html?cat=shampoo">Шампоани</a></li>
            <li><a href="products.html?cat=serum">Серуми</a></li>
          </ul></div>
          <div><h4>Информация</h4><ul>
            <li><a href="terms.html">Условия и наложен платеж</a></li>
            <li><a href="index.html#contact">Контакт</a></li>
            ${s.contactMode === 'phone' && s.phone ? `<li><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></li>` : ''}
          </ul></div>
        </div>
        <div class="footer-bottom">
          © ${new Date().getFullYear()} ${esc(s.siteDomain || 'nogrey.store')}. Този сайт използва само технически необходими бисквитки (за количката), без проследяване.
        </div>
      </div>
    </footer>`;
  updateCartCount();
  renderDrawer();
}

/* ---------- Продуктова карта ---------- */
function productCard(p) {
  const u = urgencyCount(p.id);
  const sale = Number(p.comparePrice) > Number(p.price);
  return `
    <a class="p-card" href="product.html?id=${encodeURIComponent(p.id)}">
      <div class="p-img">
        ${imgTag(mainImage(p), p.name)}
        <div class="badges">
          ${showNewBadge(p) ? '<span class="badge">Ново</span>' : ''}
          ${sale ? `<span class="badge sale">−${Math.round((1 - p.price / p.comparePrice) * 100)}%</span>` : ''}
          ${u ? `<span class="badge urgent">Само ${u} бр. налични</span>` : ''}
        </div>
      </div>
      <div class="p-body">
        ${p.category ? `<div class="eyebrow">${esc(CATEGORY_LABELS[p.category] || p.category)}</div>` : ''}
        <h3>${esc(p.name)}</h3>
        ${(p.previewFeatures || []).length ? `<ul class="p-feats">${p.previewFeatures.slice(0, 3).map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <div class="price">
          <span class="now">${eur(p.price)}</span>
          <span class="bgn">${bgn(productBgn(p))}</span>
          ${sale ? `<span class="old">${eur(p.comparePrice)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

/* ---------- Ревюта ---------- */
function starStr(n) { n = Math.max(0, Math.min(5, Number(n) || 5)); return '★'.repeat(n) + '☆'.repeat(5 - n); }
// Снимка от Google Drive (клиентски ревюта) — публичен thumbnail линк
function driveImg(id, w) { return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w || 1200}`; }

// r: {text, author|name, rating, courier?, verified?, photos?: [url]}
function reviewCard(r) {
  const photos = (r.photos || []).filter(Boolean);
  const meta = r.verified ? 'Потвърден купувач' : (r.courier ? 'Доставено с ' + esc(r.courier) : '');
  return `<div class="review">
    <div class="stars">${starStr(r.rating || 5)}</div>
    <p style="margin:10px 0 0">${esc(r.text)}</p>
    ${photos.length ? `<div class="review-photos">${photos.map(src => `<button type="button" onclick="openLightbox('${esc(src)}')" aria-label="Увеличи снимката"><img src="${esc(src)}" alt="Снимка от клиент" loading="lazy" onerror="this.closest('button').remove()"></button>`).join('')}</div>` : ''}
    <div class="who">${esc(r.author || r.name || 'Клиент')}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>`;
}

function openLightbox(src) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox'; lb.className = 'lightbox';
    lb.innerHTML = '<button class="lb-close" aria-label="Затвори">×</button><img alt="">';
    lb.addEventListener('click', () => lb.classList.remove('open'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('open'); });
    document.body.appendChild(lb);
  }
  lb.querySelector('img').src = src;
  lb.classList.add('open');
}

// Преоразмерява до max px и конвертира в JPG (ползва се за ревюта и в админа)
async function fileToJpeg(file, max = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`Форматът на „${file.name}“ не се поддържа от браузъра. Запази я като JPG или PNG.`));
      i.src = url;
    });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', quality);
    return { url: dataUrl, b64: dataUrl.split(',')[1] };
  } finally { URL.revokeObjectURL(url); }
}

async function initPage(active) {
  await loadStore();
  renderChrome(active);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCart(); });
  return STORE;
}
