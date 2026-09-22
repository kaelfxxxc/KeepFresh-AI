// paymongo-checkout
// Creates a PayMongo Checkout Session for a plan and hands the app a URL to open.
//
// This function takes money but grants nothing. It writes a 'created' row that
// records what the attempt is for, and that row is what the webhook and the
// "check again" path later turn into a subscription. Nothing here can activate a
// plan, and nothing here trusts the client with a price.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/paymongo-checkout \
//     -H "Authorization: Bearer <user access token>" \
//     -d '{"planId":"household_premium_monthly"}'
//
// Responses:
//   { ok: true,  checkout_url, checkout_session_id, reference_number, amount_centavos }
//   { ok: false, error: 'verification_not_configured', configured: false }  503
//   { ok: false, error: 'invalid_plan' | 'invalid_request' | ... }
//
// Secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   PAYMONGO_SECRET_KEY   sk_live_... (or sk_test_... while testing)
//   PAYMONGO_WEBHOOK_SECRET   the endpoint's signing secret, for paymongo-webhook
// See supabase/README.md.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin, userIdFromRequest } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';
import {
  PaymongoNotConfiguredError,
  createCheckoutSession,
  isPurchasablePlan,
  paymongoSecretKey,
  toCentavos,
  type PaymongoPlan,
} from '../_shared/paymongo.ts';

/**
 * Where PayMongo sends the customer's browser when the payment page is done.
 *
 * These are the app's own scheme, not a website: the checkout screen is a
 * WebView, and it watches for a navigation to one of these to know the hosted
 * page has finished. A web URL here would load a page the app cannot see the
 * outcome of.
 */
const SUCCESS_URL = 'keepfreshai://checkout/success';
const CANCEL_URL = 'keepfreshai://checkout/cancel';

const NOT_CONFIGURED_MESSAGE =
  'Payments are not set up on the server yet, so no plan was activated and you have not been charged.';

serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405, corsHeaders);
  }

  const userId = await userIdFromRequest(req);
  if (!userId) {
    return json({ ok: false, error: 'unauthenticated' }, 401, corsHeaders);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_request', message: 'Body must be JSON.' }, 400, corsHeaders);
  }

  const planId = String(body?.planId ?? '').trim();
  if (!planId) {
    return json(
      { ok: false, error: 'invalid_request', message: 'planId is required.' },
      400,
      corsHeaders
    );
  }

  // Fail loudly before anything is written. An unconfigured deployment must not
  // leave a trail of orphan checkout rows behind it.
  if (!paymongoSecretKey()) {
    return json(
      {
        ok: false,
        error: 'verification_not_configured',
        configured: false,
        message: NOT_CONFIGURED_MESSAGE,
      },
      503,
      corsHeaders
    );
  }

  // The plan must exist and be one of the two tiers that can actually be bought.
  //
  // The SAME allowlist `subscription-verify` uses, for the same reason: the
  // catalogue also holds the permanent free floor (tier 'free') and the free
  // trials (tier 'free_trial'), and both are granted by the server. Accepting
  // either here would let a client buy its way into a free plan.
  const { data: planRow, error: planError } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, name, price_php, duration_days, tier, is_active')
    .eq('id', planId)
    .maybeSingle();

  if (planError) {
    console.error('paymongo-checkout: plan lookup failed', planError);
    return json({ ok: false, error: 'lookup_failed' }, 500, corsHeaders);
  }

  const plan = planRow as PaymongoPlan | null;
  if (!isPurchasablePlan(plan)) {
    return json(
      { ok: false, error: 'invalid_plan', message: 'That plan cannot be purchased.' },
      400,
      corsHeaders
    );
  }

  // The amount is computed HERE, from the database, and never accepted from the
  // request. A client that posts its own price is ignored, not corrected.
  const amountCentavos = toCentavos(plan.price_php);
  const referenceNumber = makeReferenceNumber();

  // The attempt is recorded BEFORE PayMongo is called. If the create call then
  // times out with the session actually made, the webhook can still find this
  // row — `reference_number` travels with the session, so nothing is lost.
  const { data: attempt, error: insertError } = await supabaseAdmin
    .from('paymongo_checkout_sessions')
    .insert({
      user_id: userId,
      plan_id: plan.id,
      amount_centavos: amountCentavos,
      currency: 'PHP',
      reference_number: referenceNumber,
      status: 'created',
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('paymongo-checkout: attempt insert failed', insertError);
    return json({ ok: false, error: 'lookup_failed' }, 500, corsHeaders);
  }

  try {
    const created = await createCheckoutSession({
      planName: plan.name,
      amountCentavos,
      referenceNumber,
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
      metadata: {
        // Both identifiers are attached so a session found in the PayMongo
        // dashboard points straight back at a user and a plan.
        user_id: userId,
        plan_id: plan.id,
        attempt_id: attempt.id,
      },
    });

    if (!created.ok) {
      await supabaseAdmin
        .from('paymongo_checkout_sessions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', attempt.id);

      return json(
        {
          ok: false,
          error: 'checkout_failed',
          message: 'PayMongo could not open a checkout page. Nothing has been charged — please try again.',
          detail: created.detail,
        },
        502,
        corsHeaders
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from('paymongo_checkout_sessions')
      .update({
        checkout_session_id: created.session.checkoutSessionId,
        raw_payload: created.session.raw as any,
        updated_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);

    // Even this failing is survivable: the webhook matches on
    // `reference_number`, which PayMongo already has.
    if (updateError) {
      console.error('paymongo-checkout: could not store checkout_session_id', updateError, {
        attemptId: attempt.id,
      });
    }

    return json(
      {
        ok: true,
        checkout_url: created.session.checkoutUrl,
        checkout_session_id: created.session.checkoutSessionId,
        reference_number: referenceNumber,
        amount_centavos: amountCentavos,
        plan_id: plan.id,
        plan_name: plan.name,
        // Surfaced so the app can warn loudly if live keys are ever used while
        // the app itself is a development build.
        livemode: created.session.livemode,
      },
      200,
      corsHeaders
    );
  } catch (error) {
    if (error instanceof PaymongoNotConfiguredError) {
      return json(
        {
          ok: false,
          error: 'verification_not_configured',
          configured: false,
          message: NOT_CONFIGURED_MESSAGE,
        },
        503,
        corsHeaders
      );
    }

    console.error('paymongo-checkout: create session threw', error);
    await supabaseAdmin
      .from('paymongo_checkout_sessions')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', attempt.id);

    return json(
      {
        ok: false,
        error: 'checkout_failed',
        message: 'We could not reach PayMongo. Nothing has been charged — please try again.',
      },
      502,
      corsHeaders
    );
  }
});

/**
 * A reference PayMongo echoes back to us in the webhook.
 *
 * Ours, random, and unique per attempt — it is the key a webhook with no other
 * context uses to find the user and the plan it is about. Never derived from
 * anything the client sent.
 */
function makeReferenceNumber(): string {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
  return `KF-${random}`;
}
