// src/lib/billing/stripe.ts
//
// Lazy-initialized Stripe client.
//
// Why lazy: instantiating `new Stripe(key!)` at module top level crashes
// `next build` and any server boot when STRIPE_SECRET_KEY is missing (dev
// environments, CI, etc). Lazy init defers the failure to the call site
// so routes that don't touch Stripe keep working.

import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set it in your .env before calling Stripe APIs."
    );
  }
  cached = new Stripe(key);
  return cached;
}

export function getStripeOrNull(): Stripe | null {
  try {
    return getStripe();
  } catch {
    return null;
  }
}
