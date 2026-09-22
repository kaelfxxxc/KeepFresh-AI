// paymongo-verify
// "Has my checkout been paid?" — the app asking, after the hosted page closes.
//
// The webhook is the authoritative path and is the one that normally activates
// the plan. This function exists because the webhook can lag the redirect by a
// second or two, has to be registered by hand, and can never reach a local
// `supabase start`. Without it, a customer whose payment went through would sit
// looking at an unchanged screen until something else refreshed it.
//
// It grants nothing on the client's say-so. The client sends a session id, and
// this function asks PayMongo directly — the same GET the dashboard would do —
// and only activates if PayMongo says a payment on that session is paid.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/paymongo-verify \
//     -H "Authorization: Bearer <user access token>" \
//     -d '{"checkoutSessionId":"cs_xxx"}'
//
// Responses:
//   { ok: true,  status: 'activated',    entitlements, period_end }
//   { ok: true,  status: 'already_paid', entitlements }            — nothing to do
//   { ok: true,  status: 'pending',      message }                 — not paid yet
//   { ok: false, error: 'not_found' }                              — not this user's session
//   { ok: false, error: 'verification_not_configured', configured: false }  503

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin, userIdFromRequest } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';
import {
  PaymongoNotConfiguredError,
  getCheckoutSession,
  paidPaymentFromSession,
  paymongoSecretKey,
  settlePaidCheckout,
} from '../_shared/paymongo.ts';

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

  const checkoutSessionId = String(body?.checkoutSessionId ?? '').trim();
  if (!checkoutSessionId) {
    return json(
      { ok: false, error: 'invalid_request', message: 'checkoutSessionId is required.' },
      400,
      corsHeaders
    );
  }

  if (!paymongoSecretKey()) {
    return json(
      { ok: false, error: 'verification_not_configured', configured: false, message: NOT_CONFIGURED_MESSAGE },
      503,
      corsHeaders
    );
  }

  // Ownership first, and it is the lookup — not a check after one. Asking for
  // another user's session id gets the same answer as asking for one that does
  // not exist, so this cannot be used to probe who bought what.
  const { data: record, error: lookupError } = await supabaseAdmin
    .from('paymongo_checkout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('checkout_session_id', checkoutSessionId)
    .maybeSingle();

  if (lookupError) {
    console.error('paymongo-verify: lookup failed', lookupError);
    return json({ ok: false, error: 'lookup_failed' }, 500, corsHeaders);
  }
  if (!record) {
    return json(
      { ok: false, error: 'not_found', message: 'That checkout could not be found for this account.' },
      404,
      corsHeaders
    );
  }

  try {
    // Ask PayMongo. The answer to "did this get paid" comes from them, never
    // from anything the caller sent.
    const response = await getCheckoutSession(checkoutSessionId);

    if (!response.ok) {
      console.error('paymongo-verify: session read failed', response.status, JSON.stringify(response.body));
      return json(
        {
          ok: false,
          error: 'verification_failed',
          configured: true,
          message: 'Could not reach PayMongo to confirm that payment. Try again in a moment.',
        },
        502,
        corsHeaders
      );
    }

    const session = response.body?.data ?? null;
    const paid = paidPaymentFromSession(session);

    if (!paid) {
      // Genuinely not paid yet — the customer may still be on the hosted page,
      // or the wallet may still be clearing. Nothing is written.
      return json(
        {
          ok: true,
          status: 'pending',
          message: 'PayMongo has not recorded a payment for this checkout yet.',
        },
        200,
        corsHeaders
      );
    }

    const settled = await settlePaidCheckout({
      checkoutSessionId,
      referenceNumber:
        typeof session?.attributes?.reference_number === 'string'
          ? session.attributes.reference_number
          : null,
      paymentId: paid.paymentId,
      paymentMethod: paid.method,
      raw: session,
    });

    // Hand back recalculated entitlements either way, so the app can render the
    // new plan without a second round trip. They come from the same RPC the
    // database enforces with, never from anything the client sent.
    const { data: entitlements } = await supabaseAdmin.rpc('get_user_entitlements', {
      p_user_id: userId,
    });

    if (settled.outcome === 'activated') {
      return json(
        {
          ok: true,
          status: 'activated',
          period_end: settled.periodEnd,
          plan_id: settled.planId,
          entitlements: entitlements ?? null,
        },
        200,
        corsHeaders
      );
    }

    if (settled.outcome === 'already_paid') {
      // The webhook got there first, which is the normal case. Still a success
      // from the customer's point of view.
      return json(
        { ok: true, status: 'already_paid', entitlements: entitlements ?? null },
        200,
        corsHeaders
      );
    }

    // `not_found` or `plan_unavailable`. PayMongo says it is paid but we cannot
    // turn it into a subscription, which needs a human — the payment is real and
    // is recorded on PayMongo's side.
    console.error('paymongo-verify: paid but not settled', settled);
    return json(
      {
        ok: false,
        error: 'activation_failed',
        configured: true,
        message:
          'Your payment went through, but we could not activate the plan automatically. Please contact support — you will not be charged twice.',
      },
      200,
      corsHeaders
    );
  } catch (error) {
    if (error instanceof PaymongoNotConfiguredError) {
      return json(
        { ok: false, error: 'verification_not_configured', configured: false, message: NOT_CONFIGURED_MESSAGE },
        503,
        corsHeaders
      );
    }

    console.error('paymongo-verify failed', error);
    return json(
      {
        ok: false,
        error: 'verification_failed',
        configured: true,
        message: 'Could not confirm that payment just now. Try again in a moment.',
      },
      502,
      corsHeaders
    );
  }
});
