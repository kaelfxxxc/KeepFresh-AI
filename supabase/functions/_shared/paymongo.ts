// PayMongo shared helpers.
//
// Everything PayMongo-shaped lives here so the three functions
// (paymongo-checkout, paymongo-verify, paymongo-webhook) only carry the part
// that is actually about *them*: who is asking, and what they are allowed to
// learn from the answer.
//
// The two rules this file enforces:
//
//   1. THE SECRET KEY NEVER LEAVES THE SERVER. It is read from the function's
//      environment and used only to build an HTTP Basic header. No response
//      body this file produces ever contains it.
//
//   2. ACTIVATION IS IDEMPOTENT BECAUSE THE DATABASE SAYS SO, not because the
//      code is careful. `settlePaidCheckout()` claims a checkout row with a
//      conditional UPDATE and only proceeds when that UPDATE matched a row. A
//      replayed webhook, or a webhook racing the app's "check again", finds the
//      row already claimed and stops. PayMongo retries webhooks; two deliveries
//      of the same payment must never buy two periods.
//
// API contract (verified against https://docs.paymongo.com):
//   * Create:  POST https://api.paymongo.com/v2/checkout_sessions
//              Basic auth, secret key as the username, empty password.
//   * Amounts are in CENTAVOS. ₱99 is 9900.
//   * Maya's identifier is 'paymaya', not 'maya'.
//   * Read:    GET  https://api.paymongo.com/v1/checkout_sessions/{id}
//   * Webhook: 'checkout_session.payment.paid'
//   * Signature: hex HMAC-SHA256 of the RAW body, compared against the whole
//                `Paymongo-Signature` header. There are no t=/li= segments.

import { supabaseAdmin } from './supabase.ts';

const PAYMONGO_API = 'https://api.paymongo.com';

/**
 * PayMongo's own identifiers for what we sell.
 *
 * QR Ph earns its place beside the two wallets for a reason that is not about
 * preference: a method has to be ACTIVATED on the PayMongo account before the
 * hosted page will render it, and a session that asks only for methods the
 * account does not have produces a payment page with nothing on it. QR Ph is the
 * one method switched on by account activation alone — the e-wallets have to be
 * requested and approved first, which takes days. QR Ph is also payable by
 * scanning with the GCash or Maya app, so it reaches the same two wallets while
 * their own activation is pending.
 */
export const PAYMONGO_METHODS = ['gcash', 'paymaya', 'qrph'] as const;

/** The methods we can record. Mirrors the CHECK on payment_method_used. */
export type PaymongoMethod = (typeof PAYMONGO_METHODS)[number];

/** How long we wait on PayMongo before giving up. */
const REQUEST_TIMEOUT_MS = 20_000;

export class PaymongoNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`paymongo_not_configured:${missing}`);
    this.name = 'PaymongoNotConfiguredError';
  }
}

export function paymongoSecretKey(): string | null {
  return Deno.env.get('PAYMONGO_SECRET_KEY')?.trim() || null;
}

export function paymongoWebhookSecret(): string | null {
  return Deno.env.get('PAYMONGO_WEBHOOK_SECRET')?.trim() || null;
}

/**
 * A plan, as much of it as the payment paths care about.
 *
 * `price_php` comes from the database and is turned into the amount we charge.
 * The client never sends a price — see paymongo-checkout.
 */
export interface PaymongoPlan {
  id: string;
  name: string;
  price_php: number;
  duration_days: number;
  tier: string;
  is_active: boolean;
}

/** Plan ids that can be bought. The same allowlist subscription-verify uses. */
export function isPurchasablePlan(plan: PaymongoPlan | null | undefined): plan is PaymongoPlan {
  if (!plan) return false;
  return (
    plan.is_active === true &&
    (plan.tier === 'premium' || plan.tier === 'pro') &&
    Number(plan.price_php) > 0 &&
    Number(plan.duration_days) > 0
  );
}

/** ₱ → centavos. Rounded, because PayMongo takes integers only. */
export function toCentavos(pricePhp: number): number {
  return Math.round(Number(pricePhp) * 100);
}

/* ------------------------------------------------------------ the HTTP layer */

interface PaymongoResult<T = any> {
  ok: boolean;
  status: number;
  body: T | null;
}

/**
 * Call PayMongo with the secret key.
 *
 * Throws `PaymongoNotConfiguredError` when the deployment has no secret key, so
 * the caller can answer "this server cannot take payments" instead of "your
 * payment failed". Those are different problems and the user deserves to be
 * told which one they have.
 */
export async function paymongoFetch(
  path: string,
  init: RequestInit = {}
): Promise<PaymongoResult> {
  const key = paymongoSecretKey();
  if (!key) throw new PaymongoNotConfiguredError('PAYMONGO_SECRET_KEY');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${PAYMONGO_API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        // Basic auth with the secret key as the username and no password —
        // hence the trailing colon.
        Authorization: `Basic ${btoa(`${key}:`)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // A gateway error page rather than JSON. Keep it for the log, but do
        // not pretend it is a document.
        body = { raw: text.slice(0, 2000) };
      }
    }

    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------- checkout sessions */

export interface CreatedCheckoutSession {
  checkoutSessionId: string;
  checkoutUrl: string;
  livemode: boolean;
  raw: unknown;
}

/**
 * Create a Checkout Session and return the page to send the customer to.
 *
 * One line item, quantity 1: what is being sold here is a period of a plan at a
 * fixed price, so there is nothing to multiply.
 */
export async function createCheckoutSession(params: {
  planName: string;
  amountCentavos: number;
  referenceNumber: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<{ ok: true; session: CreatedCheckoutSession } | { ok: false; detail: string }> {
  const result = await paymongoFetch('/v2/checkout_sessions', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              name: params.planName,
              amount: params.amountCentavos,
              currency: 'PHP',
              quantity: 1,
            },
          ],
          // See PAYMONGO_METHODS for why QR Ph is in here too. Adding 'card'
          // later is one string.
          payment_method_types: [...PAYMONGO_METHODS],
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          reference_number: params.referenceNumber,
          send_email_receipt: true,
          metadata: params.metadata,
        },
      },
    }),
  });

  const attributes = result.body?.data?.attributes;
  const id = result.body?.data?.id;
  const checkoutUrl = attributes?.checkout_url;

  if (!result.ok || typeof id !== 'string' || typeof checkoutUrl !== 'string') {
    // PayMongo explains itself in `errors[].detail`. Pass that through — it is
    // the difference between "your account is not live yet" and "try again".
    const detail =
      result.body?.errors?.[0]?.detail ??
      result.body?.errors?.[0]?.code ??
      `PayMongo returned HTTP ${result.status}.`;
    console.error('paymongo: create session failed', result.status, JSON.stringify(result.body));
    return { ok: false, detail: String(detail) };
  }

  return {
    ok: true,
    session: {
      checkoutSessionId: id,
      checkoutUrl,
      livemode: attributes?.livemode === true,
      raw: result.body,
    },
  };
}

/**
 * Re-read a session from PayMongo.
 *
 * v2 first, falling back to v1 on a 404. Sessions are created on v2 and the
 * retrieve reference is documented on v1, so which one answers is a detail of
 * PayMongo's current deployment rather than something worth failing a payment
 * over. Both return the same `data.attributes` shape, which is all we read.
 */
export async function getCheckoutSession(checkoutSessionId: string): Promise<PaymongoResult> {
  const path = `/checkout_sessions/${encodeURIComponent(checkoutSessionId)}`;
  const v2 = await paymongoFetch(`/v2${path}`, { method: 'GET' });
  if (v2.ok || v2.status !== 404) return v2;
  return paymongoFetch(`/v1${path}`, { method: 'GET' });
}

/**
 * The one place that decides whether a Checkout Session has been paid.
 *
 * A session carries `attributes.payments[]`, one entry per attempt, and a
 * payment's `status` is `'paid'` once the money is in. That is the same field
 * the `checkout_session.payment.paid` webhook payload shows, so the webhook
 * path and the "check again" path agree by construction rather than by luck.
 *
 * Deliberately NOT keyed on the session's own `status`: the API reference gives
 * `"active"` as an example without enumerating the values, and reading a field
 * whose full set of values is unknown is how you end up activating on a state
 * you did not mean to.
 */
export function paidPaymentFromSession(session: any): { paymentId: string | null; method: string | null } | null {
  const payments = session?.attributes?.payments;
  if (!Array.isArray(payments)) return null;

  for (const payment of payments) {
    if (payment?.attributes?.status !== 'paid') continue;
    return {
      paymentId: typeof payment.id === 'string' ? payment.id : null,
      method: typeof payment?.attributes?.source?.type === 'string' ? payment.attributes.source.type : null,
    };
  }
  return null;
}

/* --------------------------------------------------------------- activation */

async function loadPlan(planId: string): Promise<PaymongoPlan | null> {
  const { data, error } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, name, price_php, duration_days, tier, is_active')
    .eq('id', planId)
    .maybeSingle();
  if (error) throw error;
  return (data as PaymongoPlan) ?? null;
}

export interface SettleResult {
  outcome: 'activated' | 'already_paid' | 'not_found' | 'plan_unavailable';
  userId?: string;
  planId?: string;
  subscriptionId?: string;
  periodEnd?: string;
  detail?: string;
}

/**
 * Turn a paid Checkout Session into a live subscription. The single writer.
 *
 * Callable from both the webhook and the app's "check again" path, and safe to
 * call twice: the claim in step 3 is what makes it so.
 *
 * @param lookup  Either id identifies the attempt. The webhook has the
 *                `reference_number` (we set it) as well as the session id; the
 *                verify path only knows the session id.
 */
export async function settlePaidCheckout(lookup: {
  checkoutSessionId?: string | null;
  referenceNumber?: string | null;
  paymentId?: string | null;
  paymentMethod?: string | null;
  raw: unknown;
}): Promise<SettleResult> {
  // 1. Find the attempt this is about.
  //
  // The session id is tried first and `reference_number` second, because the
  // reference is the more reliable of the two: it is ours, it is NOT NULL, and
  // PayMongo echoes it back in every payment notification. A session id can be
  // absent from our row entirely — that is the case where the create call
  // answered but the row could not be updated afterwards — and matching on it
  // alone would then lose a payment we have already taken.
  const record = await findAttempt(lookup.checkoutSessionId, lookup.referenceNumber);
  if (!record) {
    const tried = lookup.checkoutSessionId ?? lookup.referenceNumber;
    return { outcome: 'not_found', detail: `No checkout attempt for ${tried ?? 'a payload with no identifiers'}.` };
  }

  // 2. Load and re-check the plan BEFORE claiming, so a bad plan leaves the row
  //    claimable rather than burning it.
  const plan = await loadPlan(record.plan_id);
  if (!isPurchasablePlan(plan)) {
    await supabaseAdmin
      .from('paymongo_checkout_sessions')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', record.id);
    return { outcome: 'plan_unavailable', planId: record.plan_id };
  }

  // 3. Claim it. This is the idempotency guarantee: a second delivery of the
  //    same payment updates zero rows and therefore activates nothing. Doing it
  //    as a conditional UPDATE rather than a read-then-write means two
  //    concurrent deliveries cannot both win.
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('paymongo_checkout_sessions')
    .update({
      status: 'paid',
      checkout_session_id: record.checkout_session_id ?? lookup.checkoutSessionId ?? null,
      payment_id: lookup.paymentId ?? null,
      payment_method_used: normalizeMethod(lookup.paymentMethod),
      paid_at: now,
      raw_payload: lookup.raw as any,
      updated_at: now,
    })
    .eq('id', record.id)
    .neq('status', 'paid')
    .select('id');

  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    return { outcome: 'already_paid', userId: record.user_id, planId: plan.id };
  }

  // 4. Write the subscription.
  const activation = await activateSubscription({
    userId: record.user_id,
    plan,
    checkoutSessionId: record.checkout_session_id ?? lookup.checkoutSessionId ?? record.reference_number,
    paymentId: lookup.paymentId ?? null,
    paymentMethod: normalizeMethod(lookup.paymentMethod),
    raw: lookup.raw,
  });

  await supabaseAdmin
    .from('paymongo_checkout_sessions')
    .update({ subscription_id: activation.subscriptionId, updated_at: new Date().toISOString() })
    .eq('id', record.id);

  return {
    outcome: 'activated',
    userId: record.user_id,
    planId: plan.id,
    subscriptionId: activation.subscriptionId,
    periodEnd: activation.periodEnd,
  };
}

/**
 * Find the checkout attempt a payment is about.
 *
 * Session id first, `reference_number` second — see the note at the call site
 * for why the order matters and why the fallback is not optional.
 */
async function findAttempt(
  checkoutSessionId: string | null | undefined,
  referenceNumber: string | null | undefined
): Promise<{ id: string; user_id: string; plan_id: string; checkout_session_id: string | null; reference_number: string } | null> {
  const columns = 'id, user_id, plan_id, checkout_session_id, reference_number';

  if (checkoutSessionId) {
    const { data, error } = await supabaseAdmin
      .from('paymongo_checkout_sessions')
      .select(columns)
      .eq('checkout_session_id', checkoutSessionId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (referenceNumber) {
    const { data, error } = await supabaseAdmin
      .from('paymongo_checkout_sessions')
      .select(columns)
      .eq('reference_number', referenceNumber)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  return null;
}

/**
 * Map PayMongo's `source.type` onto the values the column allows.
 *
 * QR Ph needs no special case, only a place in the union: the hosted-checkout
 * webhook sample reports it in exactly the same field the wallets use, as
 * `"source": { "type": "qrph" }`.
 *
 * 'maya' is accepted as an alias because the wallet renamed itself from PayMaya
 * and older payloads still carry the old name. Anything unrecognised becomes
 * NULL rather than failing the settle: the method is a nice-to-have on the row,
 * the full payload is kept beside it, and a payment already taken must not be
 * refused over a label.
 */
function normalizeMethod(method: string | null | undefined): PaymongoMethod | null {
  const value = (method ?? '').trim().toLowerCase();
  if (value === 'gcash') return 'gcash';
  if (value === 'paymaya' || value === 'maya') return 'paymaya';
  if (value === 'qrph') return 'qrph';
  return null;
}

/**
 * The write itself, modelled on `activate()` in subscription-verify.
 *
 * A user has at most one live subscription (a partial unique index enforces it),
 * so a purchase updates the existing row rather than inserting a second one.
 * The guard trigger permits this only because a service-role call carries no
 * auth.uid().
 *
 * PERIOD RULE — the part worth reading twice:
 *   * Same plan, still inside the paid period  ->  add the new days to the END
 *     of it. A renewal must never burn days the customer already paid for.
 *   * Anything else — first purchase, a lapsed period, or a different plan —
 *     starts now. An upgrade should take effect immediately, not after the old
 *     plan runs out.
 *
 * `auto_renew` is FALSE because this is a one-time Checkout Session: there is no
 * mandate on file and nothing will be charged again. When the period ends the
 * existing `expire_stale_subscriptions()` cron lapses the account to the free
 * floor, which is exactly what it already does for a store-billed plan that
 * stops renewing. `cancel_at_period_end` stays false — nobody cancelled.
 */
async function activateSubscription(params: {
  userId: string;
  plan: PaymongoPlan;
  checkoutSessionId: string;
  paymentId: string | null;
  paymentMethod: PaymongoMethod | null;
  raw: unknown;
}): Promise<{ subscriptionId: string; periodEnd: string }> {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('user_subscriptions')
    .select('id, plan_id, started_at, current_period_end')
    .eq('user_id', params.userId)
    .in('status', ['trialing', 'active', 'past_due'])
    .maybeSingle();
  if (lookupError) throw lookupError;

  const now = new Date();
  const currentEnd = existing?.current_period_end ? new Date(existing.current_period_end) : null;
  const samePlan = existing?.plan_id === params.plan.id;
  const extendsCurrent = samePlan && currentEnd !== null && currentEnd.getTime() > now.getTime();

  const periodStart = extendsCurrent ? currentEnd! : now;
  const periodEnd = new Date(periodStart.getTime() + params.plan.duration_days * 86_400_000);

  const row = {
    user_id: params.userId,
    plan_id: params.plan.id,
    status: 'active' as const,
    started_at: extendsCurrent && existing?.started_at ? existing.started_at : now.toISOString(),
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
    auto_renew: false,
    canceled_at: null,
    provider: 'paymongo',
    provider_subscription_id: params.checkoutSessionId,
    provider_verified_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  let subscriptionId: string;

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('user_subscriptions')
      .update(row)
      .eq('id', existing.id);
    if (error) throw error;
    subscriptionId = existing.id;
  } else {
    const { data, error } = await supabaseAdmin
      .from('user_subscriptions')
      .insert(row)
      .select('id')
      .single();
    if (error) throw error;
    subscriptionId = data.id;
  }

  // The audit trail. Every activation leaves one of these, so "what did this
  // customer actually pay for" is answerable without reading PayMongo.
  const { error: receiptError } = await supabaseAdmin
    .from('subscription_provider_receipts')
    .insert({
      subscription_id: subscriptionId,
      user_id: params.userId,
      provider: 'paymongo',
      provider_subscription_id: params.checkoutSessionId,
      purchase_token: params.paymentId ?? params.checkoutSessionId,
      receipt: {
        planId: params.plan.id,
        checkoutSessionId: params.checkoutSessionId,
        paymentId: params.paymentId,
        paymentMethod: params.paymentMethod,
        durationDays: params.plan.duration_days,
      },
      verification_status: 'verified',
      verified_at: now.toISOString(),
      raw_response: params.raw as any,
    });
  // A missing receipt row must not undo a payment the customer has made; it is
  // logged and support can reconcile from the session row, which carries the
  // same identifiers.
  if (receiptError) {
    console.error('paymongo: receipt insert failed', receiptError, { subscriptionId });
  }

  return { subscriptionId, periodEnd: periodEnd.toISOString() };
}

/* -------------------------------------------------------- webhook signature */

/**
 * Hex HMAC-SHA256 of the raw body.
 *
 * The body must be the bytes PayMongo sent. Any JSON parse-then-restringify
 * changes the byte representation and breaks this — which is why the webhook
 * reads `req.text()` first and only parses after verifying.
 */
export async function signWebhookBody(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The early return on length leaks only the length, which is fixed at 64 for a
 * hex SHA-256 digest, so no secret is revealed by it.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a.trim().toLowerCase());
  const right = new TextEncoder().encode(b.trim().toLowerCase());
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}
