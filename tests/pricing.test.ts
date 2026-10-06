import test from 'node:test'; import assert from 'node:assert/strict';
import { calculateProductPrice, toGrams, orderTotals, validateStock, checkPriceLock, spotPerOzToPerGramCents, MarketUnavailableError, TROY_OZ_GRAMS } from '../lib/pricing.ts';
const base = { weight: 1, weightUnit: 'g' as const, purity: 1, pricingMode: 'AUTO' as const, dealerPremiumCents: 0, productPremiumCents: 0, markupPct: 0, discountCents: 0 };
test('troy ounce conversion', () => { assert.equal(toGrams(1, 'oz'), 31.1034768); assert.equal(toGrams(1, 'kg'), 1000); });
test('oz price to per-gram', () => { assert.equal(Math.round(spotPerOzToPerGramCents(TROY_OZ_GRAMS * 17000)), 17000); });
test('1g at S$170/g + 22 dealer + 8 product = S$200', () => {
  assert.equal(calculateProductPrice({ ...base, dealerPremiumCents: 2200, productPremiumCents: 800 }, 17000).finalCents, 20000); });
test('markup pct and discount', () => {
  const b = calculateProductPrice({ ...base, weight: 10, markupPct: 1, discountCents: 1000 }, 17000);
  assert.equal(b.baseCents, 170000); assert.equal(b.markupCents, 1700); assert.equal(b.finalCents, 170700); });
test('purity scales base value', () => { assert.equal(calculateProductPrice({ ...base, purity: 0.9999 }, 17000).baseCents, 16998); });
test('silver 1oz uses troy grams', () => { assert.equal(calculateProductPrice({ ...base, weightUnit: 'oz' }, 300).baseCents, Math.round(300 * TROY_OZ_GRAMS)); });
test('final price never negative', () => { assert.equal(calculateProductPrice({ ...base, discountCents: 99999 }, 100).finalCents, 0); });
test('manual price works when market is down', () => {
  assert.equal(calculateProductPrice({ ...base, pricingMode: 'MANUAL', manualPriceCents: 55555 }, null).finalCents, 55555); });
test('AUTO refuses without market price', () => { assert.throws(() => calculateProductPrice(base, null), MarketUnavailableError); });
test('manual requires a price', () => { assert.throws(() => calculateProductPrice({ ...base, pricingMode: 'MANUAL' }, 1)); });
test('order totals', () => { assert.deepEqual(orderTotals([{ unitCents: 20000, quantity: 2 }, { unitCents: 500, quantity: 1 }], 1000), { subtotalCents: 40500, deliveryCents: 1000, totalCents: 41500 }); });
test('order rejects bad quantity', () => { assert.throws(() => orderTotals([{ unitCents: 1, quantity: 0 }])); });
test('stock validation', () => { assert.ok(validateStock(5, 5, false)); assert.ok(!validateStock(5, 6, false)); assert.ok(validateStock(0, 3, true)); assert.ok(!validateStock(5, 1.5, false)); });
test('price lock expiry', () => {
  const exp = new Date('2026-10-05T10:02:00Z');
  assert.equal(checkPriceLock(20000, exp, new Date('2026-10-05T10:01:00Z'), 20500).ok, true);
  assert.equal(checkPriceLock(20000, exp, new Date('2026-10-05T10:03:00Z'), 20500).ok, false); });
