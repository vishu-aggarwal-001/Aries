// Subscription plans. aiCreditUsd is what a business can spend on Claude per 30-day period
// (your cost); the price is what you charge. Tune both here.
export interface Plan { key: string; label: string; priceUsd: number; aiCreditUsd: number; agents: number; businesses: number; stripePrice?: string; blurb: string }

export const PLANS: Plan[] = [
  { key: "trial", label: "Free trial", priceUsd: 0, aiCreditUsd: 3, agents: 4, businesses: 1, blurb: "14 days to see your crew work" },
  { key: "starter", label: "Starter", priceUsd: 49, aiCreditUsd: 15, agents: 5, businesses: 1, stripePrice: process.env.STRIPE_PRICE_STARTER, blurb: "A small crew for one business" },
  { key: "growth", label: "Growth", priceUsd: 149, aiCreditUsd: 55, agents: 12, businesses: 2, stripePrice: process.env.STRIPE_PRICE_GROWTH, blurb: "A full team running every day" },
  { key: "scale", label: "Scale", priceUsd: 399, aiCreditUsd: 170, agents: 40, businesses: 5, stripePrice: process.env.STRIPE_PRICE_SCALE, blurb: "Multiple brands, heavy volume" },
];
export const TRIAL_DAYS = 14;
export const PERIOD_MS = 30 * 864e5;
export const planOf = (key: string) => PLANS.find(p => p.key === key) ?? PLANS[0];

export interface BillingInfo { plan: string; label: string; usageUsd: number; creditUsd: number; periodEnds: number; active: boolean; reason?: string }
export function billingInfo(row: { plan: string; plan_until: number | null; usage_usd: number; period_start: number }): BillingInfo {
  const p = planOf(row.plan);
  const expired = row.plan_until != null && Date.now() > row.plan_until;
  const over = row.usage_usd >= p.aiCreditUsd;
  return {
    plan: p.key, label: p.label, usageUsd: row.usage_usd, creditUsd: p.aiCreditUsd, periodEnds: row.period_start + PERIOD_MS,
    active: !expired && !over,
    reason: expired ? (p.key === "trial" ? "Your free trial has ended" : "Your subscription has lapsed") : over ? "This month's AI credit is used up" : undefined,
  };
}
