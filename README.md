# Rizan shop: storefront + admin dashboard (zero dependencies, Node 22.9+)

## Quick start
1. `cp .env.example .env` and set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters).
2. `npm start`
3. Shop: http://localhost:3000   Admin: http://localhost:3000/admin

Forgot the admin password? Add `ADMIN_RESET=1` to `.env`, restart once, then remove it.
Tests: `npm test`.

## Customer flow
Home `/` → Product `/product/<slug>` → Cart `/cart` → Checkout `/checkout` → Confirmation `/thank-you`.
Prices are always recomputed on the server. If the market moved while the customer was checking out, they are shown the new total and nothing is ordered until they confirm. Orders start as AWAITING_PAYMENT and stock is reduced when placed.

## Admin (`/admin`)
- **Overview**: revenue, orders awaiting payment, orders to fulfil, products needing attention, live/manual price status.
- **Products**: search, filter, one-click Sold out / Back in stock; click a row to edit everything (photo, price mode, premium, discount, stock, visibility) or **+ Add product**.
- **Orders**: filter by status, open an order for customer and delivery details, advance with one click. **Cancelling returns stock.**
- **Market rates**: gold and silver are fetched live every 30s (needs outbound internet). The rates you type are only a fallback if the feed is down 5+ minutes; with neither, the shop shows "Price unavailable". The ticker says "Manual" when fallback rates are in use.
- **Activity**: log of every price, stock and status change.

## Before going live
- **Payment is not connected.** Search `PAYMENT INTEGRATION POINT` in `public/checkout.html`; create the gateway session there, mark orders PAID from the gateway's webhook, then set `RZ.paymentConnected = true` in `public/shop.js`.
- Serve behind HTTPS and set `APP_URL=https://yourdomain` (enables Secure cookies).
- Seeded products are the gold bars from rizanjewellery.sg: no photos, premium 0, purity 999.9. Check prices, premiums and stock in Admin → Products.
- Back up `data/db.json` and `data/uploads/`. Single JSON file storage suits one server; move to a database if you scale out.

## Files
`server.mjs` API + static server · `lib/pricing.ts` single price engine · `lib/auth.ts` sessions and passwords · `public/` pages · `data/` database and uploads.
