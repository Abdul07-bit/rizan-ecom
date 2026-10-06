/* Shared helpers for /product, /cart, /checkout, /thank-you. Loaded before each page's own script. */
const RZ = {
  // Flip to true once your payment gateway is wired in (changes the wording on the confirmation page).
  paymentConnected: false,
};
const OZ = 31.1034768;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sgd = (n) => 'S$' + Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grams = (p) => (p.weightUnit === 'g' ? p.weight : p.weightUnit === 'kg' ? p.weight * 1000 : p.weight * OZ);
const fmtWeight = (p) => `${p.weight}${p.weightUnit === 'oz' ? ' oz' : ' ' + p.weightUnit}`;
const fineness = (p) => (p.purity * 1000).toFixed(1);
/* Most we let a customer put in the cart. The server still checks real stock when the order is placed. */
const maxQty = (p) => (p.stockLeft != null ? p.stockLeft : 99);

/* ---- cart (localStorage, shape { productId: qty }, same key the home page uses) ---- */
const Cart = {
  key: 'rz_cart',
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key) || '{}'), out = {};
      for (const [id, q] of Object.entries(raw || {})) if (Number.isInteger(q) && q > 0) out[id] = q;
      return out;
    } catch { return {}; }
  },
  write(c) { try { localStorage.setItem(this.key, JSON.stringify(c)); } catch {} Cart.badge(); },
  add(id, q = 1, max = 99) { const c = this.read(); c[id] = Math.min(max, (c[id] || 0) + q); this.write(c); return c[id]; },
  set(id, q) { const c = this.read(); if (q < 1) delete c[id]; else c[id] = q; this.write(c); },
  remove(id) { const c = this.read(); delete c[id]; this.write(c); },
  clear() { this.write({}); },
  count() { return Object.values(this.read()).reduce((a, b) => a + b, 0); },
  badge() { const el = $('cc'); if (el) el.textContent = Cart.count(); },
};
addEventListener('storage', (e) => { if (e.key === Cart.key) { Cart.badge(); if (typeof onCartChanged === 'function') onCartChanged(); } });

/* ---- data ---- */
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
const getProducts = () => getJSON('/api/products');

/* ---- toast ---- */
let toastTimer;
function toast(html, ms = 3200) {
  const t = $('toast'); t.innerHTML = html; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/* ---- page chrome: ticker, header, footer ---- */
function mountChrome() {
  document.body.insertAdjacentHTML('afterbegin', `
<div class="tk" role="region" aria-label="Live gold and silver prices"><div class="live off" id="live"><i></i><span id="lt">Offline</span></div><div class="tkr" id="tkr"><span>Market price temporarily unavailable</span></div></div>
<header class="h"><div class="wrap nav">
  <a href="/" aria-label="Rizan Jewellery home"><img src="/logo.png" alt="Rizan Jewellery"></a>
  <ul><li><a href="/?m=gold#shop">Gold</a></li><li><a href="/?m=silver#shop">Silver</a></li><li><a href="/#footer">Contact</a></li></ul>
  <a class="btn g" href="/cart" aria-label="Open cart">Cart <span id="cc">0</span></a>
</div></header>`);
  document.body.insertAdjacentHTML('beforeend', `
<footer id="footer"><div class="wrap fl"><span>&copy; ${new Date().getFullYear()} Rizan Jewellery Pte Ltd, Singapore</span>
<span><a href="mailto:singapore@rizanjewellery.com">singapore@rizanjewellery.com</a> &middot; <a href="tel:+6583890997">+65 8389 0997</a></span></div></footer>
<div id="toast" role="status" aria-live="polite"></div>`);
  Cart.badge(); market(); setInterval(market, 30000);
}
async function market() {
  const arrow = (p) => (p >= 0 ? '↑ ' : '↓ ') + Math.abs(p).toFixed(2) + '%';
  try {
    const m = await getJSON('/api/market');
    const mk = (k, l) => { const x = m[k], c = x.changePct >= 0 ? 'up' : 'dn'; return `<span><b>${l}</b> ${sgd(x.sgdPerGram)}/g <span class="${c}">${arrow(x.changePct)}</span></span>`; };
    $('live').classList.remove('off'); $('lt').textContent = m.source === 'live' ? 'Live' : 'Manual';
    $('tkr').innerHTML = mk('gold', 'GOLD 999.9') + mk('silver', 'SILVER 999');
  } catch {
    $('live').classList.add('off'); $('lt').textContent = 'Offline';
    $('tkr').innerHTML = '<span>Market price temporarily unavailable</span>';
  }
}
