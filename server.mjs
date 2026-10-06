// Rizan shop server. Run: ADMIN_EMAIL=admin@rizan.store ADMIN_PASSWORD='Rizan@sg2026' node server.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { hashPassword, verifyPassword, signSession, verifySession, makeRateLimiter } from './lib/auth.ts';
import { calculateProductPrice, MarketUnavailableError, TROY_OZ_GRAMS } from './lib/pricing.ts';

const ROOT = path.dirname(new URL(import.meta.url).pathname), DATA = path.join(ROOT, 'data'), UP = path.join(DATA, 'uploads'), DBF = path.join(DATA, 'db.json');
fs.mkdirSync(UP, { recursive: true });
const PORT = Number(process.env.PORT ?? 3000), HTTPS = (process.env.APP_URL ?? '').startsWith('https');
const SF = path.join(DATA, 'secret.txt');
const SECRET = process.env.AUTH_SECRET ?? (fs.existsSync(SF) ? fs.readFileSync(SF, 'utf8') : (() => { const s = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(SF, s, { mode: 0o600 }); return s; })());

/* ---------- storage (JSON file, atomic writes) ---------- */
const seed = (name, weight, unit, mfr) => ({ name, weight, weightUnit: unit, manufacturer: mfr, metal: 'gold', category: 'bar', purity: 0.9999, image: '', stock: null, soldOut: false, active: true, pricingMode: 'AUTO', premiumCents: 0, discountCents: 0, manualPriceCents: null });
const SEED = [seed('Argor-Heraeus 1g Gold Bar', 1, 'g', 'Argor-Heraeus'), seed('PAMP 1g Gold Bar', 1, 'g', 'PAMP'), seed('PAMP 2.5g Gold Bar', 2.5, 'g', 'PAMP'),
  seed('PAMP 5g Gold Bar', 5, 'g', 'PAMP'), seed('PAMP 10g Gold Bar', 10, 'g', 'PAMP'), seed('PAMP Half Ounce Gold Bar', 0.5, 'oz', 'PAMP'), seed('1 Gram Gold Bar', 1, 'g', '')];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : {
  users: [], orders: [], audit: [], spot: { gold: null, silver: null, prevGold: null, prevSilver: null, updatedAt: null },
  products: SEED.map((p) => ({ id: crypto.randomUUID(), slug: slug(p.name), createdAt: new Date().toISOString(), ...p })) };
const save = () => { fs.writeFileSync(DBF + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(DBF + '.tmp', DBF); };
if (!db.users.length) {
  const { ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env;
  if (e && p) { db.users.push({ id: crypto.randomUUID(), email: e.toLowerCase(), passwordHash: hashPassword(p), role: 'SUPER_ADMIN' }); console.log('Admin created:', e); }
  else console.log('No admin yet. Restart with ADMIN_EMAIL and ADMIN_PASSWORD (12+ chars) set.');
}
save();

/* ---------- pricing glue (uses the one central engine) ---------- */
const spotPerGramCents = (metal) => { const v = db.spot[metal]; return v ? Math.round(v * 100) : null; };
const available = (p) => p.active && !p.soldOut && (p.stock == null || p.stock > 0);
function priceOf(p) {
  try { return calculateProductPrice({ weight: p.weight, weightUnit: p.weightUnit, purity: p.purity, pricingMode: p.pricingMode, dealerPremiumCents: 0, productPremiumCents: p.premiumCents,
    markupPct: 0, discountCents: p.discountCents, manualPriceCents: p.manualPriceCents }, spotPerGramCents(p.metal)).finalCents; }
  catch (e) { if (e instanceof MarketUnavailableError) return null; throw e; }
}
const pub = (p) => ({ id: p.id, slug: p.slug, name: p.name, metal: p.metal, category: p.category, manufacturer: p.manufacturer, weight: p.weight, weightUnit: p.weightUnit,
  purity: p.purity, image: p.image, description: p.description ?? '', available: available(p), priceCents: priceOf(p),
  stockLeft: p.stock != null && p.stock > 0 && p.stock <= 10 ? p.stock : null }); // exact stock is only shown when it is low

/* ---------- http helpers ---------- */
const send = (res, code, obj, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(obj)); };
const readBody = (req, max = 6e6) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy(); } else c.push(d); });
  req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c)) : {}); } catch { no(new Error('bad json')); } }); });
const cookie = (req, k) => req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith(k + '='))?.slice(k.length + 1);
const sameOrigin = (req) => { const o = req.headers.origin; try { return !!o && new URL(o).host === req.headers.host; } catch { return false; } };
const admin = (req) => { const s = verifySession(cookie(req, 'rizan_session'), SECRET); return s && db.users.find((u) => u.id === s.uid) || null; };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const loginLimit = makeRateLimiter(5, 15 * 60_000), DUMMY = hashPassword('placeholder-password-123');
const num = (v, f, { min = 0, max = 1e9, int = false } = {}) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new Error(`invalid ${f}`); return n; };
const cents = (v, f) => Math.round(num(v, f) * 100);
const log = (u, action, detail, reason) => db.audit.unshift({ at: new Date().toISOString(), by: u.email, action, detail, reason: reason || '' }) && db.audit.splice(500);

/* ---------- routes ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m === 'GET' && p === '/api/market') {
    const s = db.spot; if (!s.gold || !s.silver) return send(res, 503, { error: 'MARKET_UNAVAILABLE' });
    const q = (v, prev) => ({ sgdPerGram: v, sgdPerOz: v * TROY_OZ_GRAMS, changePct: prev ? ((v - prev) / prev) * 100 : 0 });
    return send(res, 200, { gold: q(s.gold, s.prevGold), silver: q(s.silver, s.prevSilver), updatedAt: s.updatedAt, source: 'manual' });
  }
  if (m === 'GET' && p === '/api/products') return send(res, 200, db.products.filter((x) => x.active).map(pub));
  const sm = m === 'GET' && /^\/api\/products\/([\w-]+)$/.exec(p);
  if (sm) { const x = db.products.find((y) => y.active && y.slug === sm[1]); return x ? send(res, 200, pub(x)) : send(res, 404, { error: 'NOT_FOUND' }); }
  if (m !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'BAD_ORIGIN' });

  if (m === 'POST' && p === '/api/orders') { // prices are recomputed here; client prices are never read
    const b = await readBody(req), c = b.customer ?? {}, a = b.address ?? {};
    for (const [k, v] of Object.entries({ name: c.name, email: c.email, phone: c.phone, line1: a.line1, postalCode: a.postalCode })) if (typeof v !== 'string' || v.trim().length < 2) return send(res, 400, { error: 'MISSING_' + k.toUpperCase() });
    if (!/^\S+@\S+\.\S+$/.test(c.email)) return send(res, 400, { error: 'MISSING_EMAIL' });
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return send(res, 400, { error: 'EMPTY_CART' });
    const lines = [];
    for (const it of b.items) {
      const pr = db.products.find((x) => x.id === it.id), q = it.qty;
      if (!pr || !Number.isInteger(q) || q < 1 || q > 1000) return send(res, 400, { error: 'BAD_ITEM' });
      if (!available(pr) || (pr.stock != null && q > pr.stock)) return send(res, 409, { error: 'UNAVAILABLE', product: pr.name });
      const unit = priceOf(pr); if (unit == null) return send(res, 409, { error: 'PRICE_UNAVAILABLE', product: pr.name });
      lines.push({ pr, q, unit });
    }
    const total = lines.reduce((s, l) => s + l.unit * l.q, 0);
    // The page shows the customer a total. If the market moved since, tell them the new one instead of charging a surprise.
    if (b.expectedTotalCents != null && b.expectedTotalCents !== total) return send(res, 409, { error: 'PRICE_CHANGED', totalCents: total });
    for (const l of lines) if (l.pr.stock != null) l.pr.stock -= l.q;
    const o = { id: crypto.randomUUID(), number: 'RZ-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
      status: 'AWAITING_PAYMENT', createdAt: new Date().toISOString(), customer: { name: c.name.trim(), email: c.email.trim(), phone: c.phone.trim() },
      address: { line1: a.line1.trim(), line2: (a.line2 ?? '').trim(), postalCode: a.postalCode.trim() },
      items: lines.map((l) => ({ productId: l.pr.id, name: l.pr.name, qty: l.q, unitCents: l.unit })), totalCents: total };
    db.orders.unshift(o); save(); return send(res, 201, { number: o.number, totalCents: total });
  }
  if (m === 'POST' && p === '/api/admin/login') {
    const b = await readBody(req).catch(() => ({})); const ip = req.socket.remoteAddress ?? '?';
    if (!loginLimit(`${ip}:${String(b.email).toLowerCase()}`)) return send(res, 429, { error: 'TOO_MANY_ATTEMPTS' });
    const u = db.users.find((x) => x.email === String(b.email).toLowerCase());
    const ok = verifyPassword(String(b.password ?? ''), u?.passwordHash ?? DUMMY) && !!u;
    if (!ok) return send(res, 401, { error: 'INVALID_CREDENTIALS' });
    const age = 8 * 3600, t = signSession({ uid: u.id, exp: Date.now() + age * 1000 }, SECRET);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `rizan_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${HTTPS ? '; Secure' : ''}` });
  }
  if (!p.startsWith('/api/admin/')) return send(res, 404, { error: 'NOT_FOUND' });
  const u = admin(req);
  if (p === '/api/admin/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'rizan_session=; Max-Age=0; Path=/' });
  if (!u) return send(res, 401, { error: 'SESSION_EXPIRED' });

  if (m === 'GET' && p === '/api/admin/state') return send(res, 200, { spot: db.spot, products: db.products.map((x) => ({ ...x, finalCents: priceOf(x), available: available(x) })), orders: db.orders, audit: db.audit.slice(0, 40) });
  const b = m === 'GET' ? {} : await readBody(req);
  if (m === 'PUT' && p === '/api/admin/spot') {
    const g = num(b.gold, 'gold', { min: 0.01 }), s = num(b.silver, 'silver', { min: 0.01 }), o = db.spot;
    db.spot = { gold: g, silver: s, prevGold: o.gold, prevSilver: o.silver, updatedAt: new Date().toISOString() };
    log(u, 'SPOT_UPDATE', `gold ${o.gold}->${g}/g, silver ${o.silver}->${s}/g`, b.reason); save(); return send(res, 200, { ok: true });
  }
  if (m === 'POST' && p === '/api/admin/upload') {
    const mm = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl ?? ''); if (!mm) return send(res, 400, { error: 'IMAGE_TYPE' });
    const buf = Buffer.from(mm[2], 'base64'); if (buf.length > 4e6) return send(res, 400, { error: 'IMAGE_TOO_LARGE' });
    const f = crypto.randomBytes(12).toString('hex') + '.' + (mm[1] === 'jpeg' ? 'jpg' : mm[1]); fs.writeFileSync(path.join(UP, f), buf); return send(res, 200, { url: '/uploads/' + f });
  }
  const edit = (pr, x) => {
    const set = {};
    if ('name' in x) set.name = String(x.name).trim().slice(0, 120) || (() => { throw new Error('invalid name'); })();
    if ('metal' in x) { if (!['gold', 'silver'].includes(x.metal)) throw new Error('invalid metal'); set.metal = x.metal; }
    if ('category' in x) { if (!['bullion', 'coin', 'bar'].includes(x.category)) throw new Error('invalid category'); set.category = x.category; }
    if ('manufacturer' in x) set.manufacturer = String(x.manufacturer).slice(0, 80);
    if ('description' in x) set.description = String(x.description).trim().slice(0, 2000);
    if ('weight' in x) set.weight = num(x.weight, 'weight', { min: 0.0001 });
    if ('weightUnit' in x) { if (!['g', 'oz', 'kg'].includes(x.weightUnit)) throw new Error('invalid unit'); set.weightUnit = x.weightUnit; }
    if ('purity' in x) set.purity = num(x.purity, 'purity', { min: 0.1, max: 1 });
    if ('premium' in x) set.premiumCents = cents(x.premium, 'premium');
    if ('discount' in x) set.discountCents = cents(x.discount, 'discount');
    if ('pricingMode' in x) { if (!['AUTO', 'MANUAL'].includes(x.pricingMode)) throw new Error('invalid mode'); set.pricingMode = x.pricingMode; }
    if ('manualPrice' in x) set.manualPriceCents = x.manualPrice === '' || x.manualPrice == null ? null : cents(x.manualPrice, 'manualPrice');
    if ('stock' in x) set.stock = x.stock === '' || x.stock == null ? null : num(x.stock, 'stock', { int: true });
    if ('soldOut' in x) set.soldOut = !!x.soldOut;
    if ('active' in x) set.active = !!x.active;
    if ('image' in x) { if (x.image && !/^\/uploads\/[a-f0-9]+\.(png|jpg|webp)$/.test(x.image)) throw new Error('invalid image'); set.image = x.image; }
    const next = { ...pr, ...set };
    if (next.pricingMode === 'MANUAL' && next.manualPriceCents == null) throw new Error('Manual mode needs a manual price');
    return next;
  };
  try {
    if (m === 'POST' && p === '/api/admin/product') {
      const pr = edit({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), metal: 'gold', category: 'bar', weightUnit: 'g', purity: 0.9999, image: '', stock: null, soldOut: false, active: true,
        pricingMode: 'AUTO', premiumCents: 0, discountCents: 0, manualPriceCents: null, manufacturer: '' }, b);
      if (!b.name) throw new Error('name required'); pr.slug = slug(pr.name) + '-' + pr.id.slice(0, 4); db.products.push(pr);
      log(u, 'PRODUCT_CREATE', pr.name, b.reason); save(); return send(res, 201, { id: pr.id });
    }
    const pm = /^\/api\/admin\/product\/([\w-]+)$/.exec(p);
    if (m === 'PATCH' && pm) {
      const i = db.products.findIndex((x) => x.id === pm[1]); if (i < 0) return send(res, 404, { error: 'NOT_FOUND' });
      const before = db.products[i], oldPrice = priceOf(before), next = edit(before, b); db.products[i] = next;
      log(u, 'PRODUCT_UPDATE', `${next.name}: price ${oldPrice == null ? 'n/a' : oldPrice / 100} -> ${priceOf(next) == null ? 'n/a' : priceOf(next) / 100}; premium ${before.premiumCents / 100} -> ${next.premiumCents / 100}; soldOut ${before.soldOut} -> ${next.soldOut}`, b.reason);
      save(); return send(res, 200, { finalCents: priceOf(next) });
    }
    const om = /^\/api\/admin\/order\/([\w-]+)$/.exec(p);
    if (m === 'PATCH' && om) {
      const o = db.orders.find((x) => x.id === om[1]); if (!o) return send(res, 404, { error: 'NOT_FOUND' });
      if (!['AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'].includes(b.status)) throw new Error('invalid status');
      log(u, 'ORDER_STATUS', `${o.number}: ${o.status} -> ${b.status}`, b.reason); o.status = b.status; save(); return send(res, 200, { ok: true });
    }
  } catch (e) { return send(res, 400, { error: 'INVALID', message: e.message }); }
  return send(res, 404, { error: 'NOT_FOUND' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const PAGES = { '/': 'index.html', '/admin': 'admin.html', '/cart': 'cart.html', '/checkout': 'checkout.html', '/thank-you': 'thank-you.html' };
    let f = PAGES[url.pathname] ?? (/^\/product\/[\w-]+$/.test(url.pathname) ? 'product.html' : url.pathname.slice(1));
    const base = f.startsWith('uploads/') ? DATA : path.join(ROOT, 'public'), full = path.normalize(path.join(base, f));
    if (!full.startsWith(base) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream', 'Cache-Control': f.startsWith('uploads/') ? 'public, max-age=86400' : 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) { send(res, e.message === 'too large' ? 413 : 500, { error: 'SERVER_ERROR' }); }
}).listen(PORT, () => console.log('Rizan shop on http://localhost:' + PORT + '  (admin: /admin)'));
