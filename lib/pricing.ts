/** Single source of truth for prices. Product page, cart, checkout and admin MUST all call this. All money is integer cents (SGD). */
export const TROY_OZ_GRAMS = 31.1034768;
export type WeightUnit = 'g' | 'oz' | 'kg';
export type PricingMode = 'AUTO' | 'MANUAL';

export interface PricingProduct {
  weight: number; weightUnit: WeightUnit;
  purity: number;            // fraction of pure metal, e.g. 0.9999
  pricingMode: PricingMode;
  dealerPremiumCents: number; productPremiumCents: number;
  markupPct: number;         // % of base metal value
  discountCents: number;
  manualPriceCents?: number | null;
}
export interface PriceBreakdown {
  mode: PricingMode; grams: number; spotCentsPerGram: number;
  baseCents: number; dealerPremiumCents: number; productPremiumCents: number;
  markupCents: number; discountCents: number; finalCents: number;
}

export function toGrams(weight: number, unit: WeightUnit): number {
  if (!(weight > 0)) throw new RangeError('weight must be > 0');
  if (unit === 'g') return weight;
  if (unit === 'kg') return weight * 1000;
  return weight * TROY_OZ_GRAMS; // troy ounce, not avoirdupois
}
export const spotPerOzToPerGramCents = (centsPerOz: number) => centsPerOz / TROY_OZ_GRAMS;

export class MarketUnavailableError extends Error { constructor() { super('Market price unavailable'); } }

/** spotCentsPerGram is null when the market is unavailable: AUTO then refuses to price (never serves stale or invented prices). */
export function calculateProductPrice(p: PricingProduct, spotCentsPerGram: number | null): PriceBreakdown {
  const grams = toGrams(p.weight, p.weightUnit);
  if (p.pricingMode === 'MANUAL') {
    if (p.manualPriceCents == null || p.manualPriceCents < 0) throw new Error('MANUAL pricing requires manualPriceCents');
    return { mode: 'MANUAL', grams, spotCentsPerGram: spotCentsPerGram ?? 0, baseCents: 0, dealerPremiumCents: 0,
      productPremiumCents: 0, markupCents: 0, discountCents: 0, finalCents: Math.round(p.manualPriceCents) };
  }
  if (spotCentsPerGram == null || !(spotCentsPerGram > 0)) throw new MarketUnavailableError();
  const baseCents = Math.round(spotCentsPerGram * grams * p.purity);
  const markupCents = Math.round(baseCents * (p.markupPct / 100));
  const finalCents = Math.max(0, baseCents + p.dealerPremiumCents + p.productPremiumCents + markupCents - p.discountCents);
  return { mode: 'AUTO', grams, spotCentsPerGram, baseCents, dealerPremiumCents: p.dealerPremiumCents,
    productPremiumCents: p.productPremiumCents, markupCents, discountCents: p.discountCents, finalCents };
}

export interface LineInput { unitCents: number; quantity: number }
export function orderTotals(lines: LineInput[], deliveryCents = 0) {
  let subtotal = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new RangeError('invalid quantity');
    subtotal += l.unitCents * l.quantity;
  }
  return { subtotalCents: subtotal, deliveryCents, totalCents: subtotal + deliveryCents };
}
export function validateStock(stock: number, qty: number, preorder: boolean): boolean {
  return Number.isInteger(qty) && qty > 0 && (preorder || qty <= stock);
}
/** Checkout: client-sent prices are ignored. Honour the locked price only until the lock expires. */
export function checkPriceLock(lockedCents: number, lockExpiresAt: Date, now: Date, currentCents: number) {
  if (now > lockExpiresAt) return { ok: false as const, reason: 'LOCK_EXPIRED' as const, currentCents };
  return { ok: true as const, chargeCents: lockedCents };
}
