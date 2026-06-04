// Front-end binding for the `create-checkout-session` edge function.
//
// Called by the user-app Coins CheckoutModal when a signed-in user
// clicks "Pay with Stripe" on a pack. The edge function returns a
// Stripe-hosted Checkout URL; we hand off to it via
// `window.location.assign` so back-navigation lands the user on
// `/coins?session_id=…` (success) or `/coins?canceled=1` (cancel).
//
// We deliberately don't open Stripe in a new tab — Stripe's hosted
// page handles 3DS challenges inline and that flow gets weird across
// tabs. Single-tab redirect is the recommended pattern.

import { supabase } from "@/integrations/supabase/client";

export async function createCheckoutSession(coinPackId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke(
    "create-checkout-session",
    { body: { coin_pack_id: coinPackId } },
  );
  if (error) throw error;
  const url = (data as { url?: string } | null)?.url;
  if (!url) {
    throw new Error("Checkout session did not return a URL");
  }
  // Use assign so the back button still works (replace would
  // overwrite the entry — bad if the user wants to come back to
  // /coins to pick a different pack).
  window.location.assign(url);
}
