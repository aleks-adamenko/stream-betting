// Display-only FX rates from AUD → other currencies, for the user-app
// Coins page. Stripe still charges AUD; these numbers exist so a
// visitor sees a familiar amount alongside the AUD charge label.
//
// v1 ships a hand-curated static table. Operator bumps the rates when
// any pair drifts more than ~5% from spot. A future revision can swap
// the table for a fetched + cached API response (e.g.
// exchangerate.host) without changing call-sites — the public surface
// of this file is stable.

/**
 * AUD → currency multiplier. AUD self-rate is 1 by definition.
 *
 * Last updated: 4 June 2026. Bump these when any rate drifts
 * meaningfully — the absolute precision doesn't matter (we add an
 * "estimate" caveat next to the localized price), only that the
 * order of magnitude is right.
 */
export const FX_RATES_FROM_AUD = {
  AUD: 1,
  USD: 0.65,
  EUR: 0.6,
  GBP: 0.51,
  NZD: 1.08,
  CAD: 0.89,
  JPY: 102,
  SGD: 0.87,
} as const;

export type SupportedCurrency = keyof typeof FX_RATES_FROM_AUD;

/**
 * Region → display currency. Picks one currency per country we want
 * to show a localized estimate for; everything else falls back to AUD.
 * Region resolution is via `Intl.Locale.maximize().region` — derived
 * from `navigator.language`, no geo-IP needed.
 */
const REGION_TO_CURRENCY: Record<string, SupportedCurrency> = {
  AU: "AUD",
  US: "USD",
  GB: "GBP",
  // Major Eurozone members. Stripe formats the same € whether the
  // visitor is in DE, FR, ES, etc., so we don't need to enumerate
  // every member — but listing them explicitly keeps the table self-
  // documenting and easy to audit.
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  IE: "EUR",
  PT: "EUR",
  BE: "EUR",
  AT: "EUR",
  FI: "EUR",
  GR: "EUR",
  NZ: "NZD",
  CA: "CAD",
  JP: "JPY",
  SG: "SGD",
};

/**
 * Resolve the visitor's display currency from the browser locale.
 * SSR-safe: when `navigator` isn't defined (Node, Vercel build step),
 * falls back to AUD.
 */
export function detectCurrency(): SupportedCurrency {
  if (typeof navigator === "undefined" || !navigator.language) return "AUD";
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return (region && REGION_TO_CURRENCY[region]) ?? "AUD";
  } catch {
    return "AUD";
  }
}

/**
 * Format an AUD-cents amount as a localized currency string in the
 * visitor's preferred currency. Uses `Intl.NumberFormat` against
 * `navigator.language`, so the result respects local conventions
 * (separator, position of the symbol, etc.).
 *
 * Examples (against the $10 AUD pack):
 *   en-AU + AUD → "A$10.00"
 *   en-US + USD → "$6.50"
 *   de-DE + EUR → "6,00 €"
 *   ja-JP + JPY → "￥1,020"
 */
export function localPriceLabel(
  audCents: number,
  currency: SupportedCurrency = detectCurrency(),
): string {
  const localAmount = (audCents / 100) * FX_RATES_FROM_AUD[currency];
  const locale =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en-AU";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    // JPY has no minor unit. Everything else gets two decimals.
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(localAmount);
}

/**
 * Format an AUD-cents amount as the explicit AUD label that matches
 * what Stripe will show on its hosted checkout — used for the
 * "Charged in AUD $X.XX" caveat and the "Pay AUD $X.XX with Stripe"
 * button so the handoff to Stripe never surprises the user.
 *
 * Always uses `en-AU` for predictable formatting regardless of the
 * visitor's locale — this string represents the merchant's charge,
 * not the visitor's local currency.
 */
export function audChargeLabel(audCents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(audCents / 100);
}
