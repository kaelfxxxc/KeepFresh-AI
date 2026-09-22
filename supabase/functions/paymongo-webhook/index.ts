// paymongo-webhook
// PayMongo's server-to-server notification that a Checkout Session was paid.
//
// This endpoint is PUBLIC. It has to be — PayMongo calls it from their
// infrastructure and cannot present a Supabase JWT, which is why it is the one
// function here deployed with `verify_jwt = false`. Its ONLY gate is the
// signature check below, so that check is the first thing that happens and
// nothing is parsed, logged or written before it passes.
//
// The signature is a hex HMAC-SHA256 of the raw request body, keyed with the
// endpoint's own secret, compared in constant time against the whole
// `Paymongo-Signature` header. It must be computed over the bytes PayMongo sent:
// parsing the JSON and re-serialising it changes those bytes and breaks the
// check, so `req.text()` is read first and `JSON.parse` runs only afterwards.
//
// Responses:
//   200  handled, or understood and deliberately not acted on
//   401  signature missing or wrong
//   503  this deployment has no webhook secret configured yet
//
// A 200 for events we do not act on is deliberate: PayMongo retries non-2xx
// responses, and retrying will not turn an event we do not handle into one we
// do. See supabase/README.md.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { json } from '../_shared/cors.ts';
import {
  paidPaymentFromSession,
  paymongoWebhookSecret,
  settlePaidCheckout,
  signWebhookBody,
  timingSafeEqualHex,
} from '../_shared/paymongo.ts';

/** The one event that means money arrived. */
const PAID_EVENT = 'checkout_session.payment.paid';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  const secret = paymongoWebhookSecret();
  if (!secret) {
    // Fail closed. An unconfigured deployment must never treat an unverified
    // request as genuine — a 503 makes PayMongo retry once the secret is set,
    // which is exactly what we want.
    console.error('paymongo-webhook: PAYMONGO_WEBHOOK_SECRET is not set; refusing to process');
    return json({ ok: false, error: 'webhook_not_configured' }, 503);
  }

  // Raw body FIRST — the signature is over these exact bytes.
  const rawBody = await req.text();

  const header = req.headers.get('paymongo-signature') ?? req.headers.get('Paymongo-Signature');
  if (!header) {
    console.warn('paymongo-webhook: request with no Paymongo-Signature header');
    return json({ ok: false, error: 'missing_signature' }, 401);
  }

  const expected = await signWebhookBody(rawBody, secret);
  if (!timingSafeEqualHex(expected, header)) {
    // Never log the expected digest: on a deployment whose secret is wrong that
    // value is a working signature for anyone who reads the logs.
    console.warn('paymongo-webhook: signature mismatch — request rejected');
    return json({ ok: false, error: 'invalid_signature' }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn('paymongo-webhook: verified request but body was not JSON');
    return json({ ok: true, handled: false, reason: 'unparseable_body' }, 200);
  }

  const event = extractEvent(payload);

  if (event.name !== PAID_EVENT) {
    // Authentic, understood, not ours to act on. Acknowledged so it is not
    // retried forever.
    return json({ ok: true, handled: false, event: event.name ?? 'unknown' }, 200);
  }

  if (!event.session) {
    console.warn('paymongo-webhook: paid event with no checkout session in the payload');
    return json({ ok: true, handled: false, reason: 'no_session' }, 200);
  }

  const paid = paidPaymentFromSession(event.session);

  let result;
  try {
    result = await settlePaidCheckout({
      checkoutSessionId: typeof event.session.id === 'string' ? event.session.id : null,
      referenceNumber:
        typeof event.session?.attributes?.reference_number === 'string'
          ? event.session.attributes.reference_number
          : null,
      // The webhook payload carries the payment itself, so both are known here.
      // `settlePaidCheckout` falls back to the session's own scan when absent.
      paymentId: paid?.paymentId ?? null,
      paymentMethod: paid?.method ?? null,
      raw: event.session,
    });
  } catch (error) {
    // A 500 makes PayMongo retry, which is right: the payment is real and we
    // failed to record it. Idempotency means the retry is free.
    console.error('paymongo-webhook: settle failed', error);
    return json({ ok: false, error: 'settle_failed' }, 500);
  }

  console.log('paymongo-webhook: settled', {
    outcome: result.outcome,
    sessionId: event.session.id,
    planId: result.planId,
  });

  // `not_found` is reported as 200: the request was genuine, but it is about a
  // session this database has no record of — almost always a session created
  // against a different environment's keys. Retrying will not help.
  return json({ ok: true, handled: result.outcome !== 'not_found', ...result }, 200);
});

/**
 * Read the event name and the Checkout Session out of a webhook payload.
 *
 * PayMongo's documentation shows two shapes for the same notification, so this
 * accepts both rather than betting on one:
 *
 *   Hosted Checkout page:
 *     { data: { type: 'checkout_session.payment.paid', data: { id: 'cs_…', … } } }
 *
 *   Events page:
 *     { data: { attributes: { type: 'checkout_session.payment.paid',
 *                             data: { id: 'cs_…', … } } } }
 *
 * Half of this function is therefore shape-sniffing, and it is written to fail
 * towards "no session found" (a no-op, 200) rather than towards acting on
 * something it misread.
 */
function extractEvent(payload: any): { name: string | null; session: any | null } {
  const outer = payload?.data ?? {};

  const name =
    asString(outer?.type) ??
    asString(outer?.attributes?.type) ??
    asString(payload?.event_type);

  // Shape A — the session sits directly under `data`.
  if (looksLikeSession(outer?.data)) {
    return { name, session: outer.data };
  }

  // Shape B — one level deeper, under `data.attributes`.
  if (looksLikeSession(outer?.attributes?.data)) {
    return { name, session: outer.attributes.data };
  }

  // Shape C — no envelope at all; the body IS the resource.
  if (looksLikeSession(outer)) {
    return { name, session: outer };
  }

  return { name, session: null };
}

function looksLikeSession(value: any): boolean {
  return !!value && typeof value === 'object' && typeof value.id === 'string';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
