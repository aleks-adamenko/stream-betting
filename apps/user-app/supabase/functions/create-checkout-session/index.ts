// create-checkout-session — called by the user-app Coins page when a
// signed-in user clicks "Pay" on a pack tile.
//
// Flow:
//   1. Verify the JWT and resolve the caller's user_id (via requireUser).
//   2. Read coin_pack_id from the body.
//   3. Call `create_top_up_attempt(coin_pack_id)` — this is the
//      authoritative price resolver. Coins + price come from the DB,
//      never the client. Returns { attempt_id, coins, cash_cents,
//      stripe_product_id, user_id }.
//   4. Create a Stripe Checkout Session with:
//        • mode: 'payment' (one-time, not subscription)
//        • line_items: price_data anchored to the operator's prod_… —
//          we never use Stripe Prices, so admin can re-price in our DB
//          without touching Stripe.
//        • metadata.attempt_id — so the webhook can map session → attempt
//          even if Stripe ever changes what's in `client_reference_id`.
//        • success_url / cancel_url include {CHECKOUT_SESSION_ID}
//          so the redirect-return page can show "Processing…" until
//          the webhook lands.
//   5. Stash the session id back on the attempt via
//      `attach_stripe_session`. From this point the webhook can
//      complete the row.
//   6. Return { url } — the user-app calls
//      `window.location.assign(url)` to hand off to Stripe.

import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { userScopedClient } from "../_shared/supabase.ts";
import { stripe, getAppBaseUrl } from "../_shared/stripe.ts";

interface CreateCheckoutBody {
  coin_pack_id?: string;
}

interface AttemptRow {
  attempt_id: string;
  user_id: string;
  coins: number;
  cash_cents: number;
  stripe_product_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const user = await requireUser(req);

    const body = (await req.json().catch(() => ({}))) as CreateCheckoutBody;
    const coinPackId = body.coin_pack_id;
    if (!coinPackId || typeof coinPackId !== "string") {
      throw new HttpError(400, "Missing coin_pack_id");
    }

    // create_top_up_attempt + attach_stripe_session need `auth.uid()`
    // to identify the user (they're SECURITY DEFINER but read
    // auth.uid() inside). Use a user-scoped client carrying the
    // caller's JWT — service_role would resolve to auth.uid() = null
    // and fail the auth check.
    const authHeader = req.headers.get("Authorization")!;
    const userDb = userScopedClient(authHeader);

    const { data: attempt, error: attemptErr } = await userDb.rpc(
      "create_top_up_attempt",
      { p_coin_pack_id: coinPackId },
    );
    if (attemptErr) {
      throw new HttpError(400, attemptErr.message);
    }
    const a = attempt as unknown as AttemptRow;
    if (!a?.attempt_id) {
      throw new HttpError(500, "Failed to create attempt row");
    }
    // Defensive cross-check: the RPC returns the user_id it stamped on
    // the row; refuse to proceed if the JWT-resolved user disagrees.
    // Should never happen — but if it does, we don't want to mint a
    // Stripe Session against the wrong account.
    if (a.user_id !== user.id) {
      throw new HttpError(500, "Attempt user mismatch");
    }

    const baseUrl = getAppBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      // Apple Pay / Google Pay come along for the ride automatically
      // when the request comes from a supporting browser — Stripe
      // doesn't need an extra opt-in for the wallet flows in Checkout.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "aud",
            unit_amount: a.cash_cents,
            // Anchor to the operator-pasted prod_… so reporting in the
            // Stripe dashboard groups by product. We pass unit_amount
            // alongside so the operator can re-price in admin
            // Settings without touching Stripe at all.
            product: a.stripe_product_id,
          },
        },
      ],
      success_url: `${baseUrl}/coins?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/coins?canceled=1`,
      client_reference_id: a.attempt_id,
      metadata: {
        attempt_id: a.attempt_id,
        user_id: a.user_id,
        coins: String(a.coins),
        cash_cents: String(a.cash_cents),
      },
    });

    if (!session.url) {
      throw new HttpError(500, "Stripe returned a session with no URL");
    }

    // Persist the session id back on the attempt. Once this is set
    // the webhook can map session → attempt.
    const { error: attachErr } = await userDb.rpc("attach_stripe_session", {
      p_attempt_id: a.attempt_id,
      p_session_id: session.id,
    });
    if (attachErr) {
      // If we fail to attach, the webhook won't be able to find the
      // attempt. Try to expire the Stripe session so the user can't
      // somehow complete a payment we can't credit.
      void stripe.checkout.sessions.expire(session.id).catch(() => {});
      throw new HttpError(500, `Failed to attach session: ${attachErr.message}`);
    }

    return jsonResponse({ url: session.url, session_id: session.id });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message }, { status: err.status });
    }
    console.error("create-checkout-session error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
});
