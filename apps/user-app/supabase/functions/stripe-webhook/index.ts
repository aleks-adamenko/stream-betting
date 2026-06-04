// stripe-webhook — receives `checkout.session.*` and
// `payment_intent.payment_failed` events from Stripe and translates
// them into RPC calls that flip top_up_attempts rows.
//
// Critical configuration:
//   • `verify_jwt = false` in supabase/config.toml — Stripe doesn't
//     send a Supabase JWT, signatures live in `stripe-signature`.
//   • Service-role Supabase client — the RPCs called here are
//     locked to service_role only (clients can't mint sessions and
//     credit themselves).
//   • Raw request body for signature verification — we read it via
//     `req.text()` BEFORE parsing JSON; Stripe's signature is
//     calculated over the unmodified body bytes.

import { jsonResponse } from "../_shared/cors.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import {
  stripe,
  getWebhookSecret,
  type Stripe,
} from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  // Read the raw body BEFORE any parsing — signature verification is
  // calculated over the exact bytes Stripe sent.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    // constructEventAsync (vs constructEvent) uses WebCrypto under
    // the hood, which is the path that works on Deno. The sync
    // version requires Node crypto and silently fails here.
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      getWebhookSecret(),
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  const db = serviceRoleClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Defensive: only credit when payment actually succeeded.
        // `checkout.session.completed` does fire for paid sessions,
        // but if Stripe ever extends the event for unpaid completions
        // (e.g. mode='setup'), this check keeps the credit gated.
        if (session.payment_status !== "paid") {
          console.warn(
            `Skipping completed session ${session.id} with payment_status=${session.payment_status}`,
          );
          break;
        }
        const { data, error } = await db.rpc("complete_top_up_attempt", {
          p_session_id: session.id,
        });
        if (error) {
          console.error("complete_top_up_attempt failed:", error);
          // 500 → Stripe will retry. Make sure complete_top_up_attempt
          // stays idempotent so retries don't double-credit.
          return new Response(`RPC error: ${error.message}`, { status: 500 });
        }
        console.log("complete_top_up_attempt:", data);
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const { error } = await db.rpc("mark_top_up_attempt_failed", {
          p_session_id: session.id,
          p_status: "expired",
        });
        if (error) {
          console.error("mark_top_up_attempt_failed (expired) failed:", error);
          return new Response(`RPC error: ${error.message}`, { status: 500 });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        // PaymentIntents aren't 1:1 with our session table, but Stripe
        // attaches the parent checkout session id to the PI via
        // expand=['checkout_session'] OR we can derive it from
        // metadata. Easier path: ignore PI failures here and rely on
        // checkout.session.expired which fires when Stripe gives up on
        // the session. Logged for ops visibility only.
        const pi = event.data.object as Stripe.PaymentIntent;
        console.log(
          `payment_intent.payment_failed pi=${pi.id} amount=${pi.amount} — not acted on (session.expired handles cleanup)`,
        );
        break;
      }

      default:
        // Stripe sends a lot of unrelated events to one endpoint if
        // you don't filter. We only signed up for three in the
        // dashboard config, so this default is a defence in depth.
        console.log(`Ignoring event ${event.type}`);
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response(
      `Handler error: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 500 },
    );
  }

  // Stripe needs a 2xx within ~10s or it retries. JSON body isn't
  // required, just the status.
  return jsonResponse({ received: true });
});
