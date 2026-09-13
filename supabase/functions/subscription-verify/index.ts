// subscription-verify
// Server-side purchase verification. The ONLY path that can turn a paid plan on.
//
// The app never activates a subscription from the client. It sends the store's
// purchase evidence here; this function verifies it against the store, and only
// then writes the subscription row. A client that lies about a purchase gets a
// receipt row marked 'invalid' and no entitlement, because the guard trigger on
// user_subscriptions rejects plan changes that are not made by a server-side
// (no auth.uid()) call.
//
//   curl -X POST https://<ref>.supabase.co/functions/v1/subscription-verify \
//     -H "Authorization: Bearer <user access token>" \
//     -d '{"provider":"google_play","planId":"household_premium_monthly",
//          "productId":"keepfresh_household_premium_monthly",
//          "purchaseToken":"<token from Google Play Billing>"}'
//
// Responses:
//   { ok: true,  status: 'activated',            subscription, plan }
//   { ok: true,  status: 'pending_verification',  message }   — store says "not yet"
//   { ok: false, status: 'invalid',               error }     — store rejected it
//   { ok: false, error: 'verification_not_configured', provider }
//   { ok: false, error: 'invalid_plan' | 'invalid_request' | ... }
//
// IMPORTANT: when a provider's secrets are absent this function returns
// 'verification_not_configured' and activates NOTHING. It never falls back to
// trusting the client — an unverified purchase must fail loudly, not quietly
// succeed.
//
// Secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   Google Play:  GOOGLE_PLAY_PACKAGE_NAME, GOOGLE_SERVICE_ACCOUNT_JSON
//   App Store:    APPLE_BUNDLE_ID, APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
// See supabase/README.md for how to obtain each one.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { supabaseAdmin, userIdFromRequest } from '../_shared/supabase.ts';
import { corsHeaders, json, handleOptions } from '../_shared/cors.ts';

type Provider = 'google_play' | 'app_store';

/** What a provider tells us about a purchase, once it has been checked. */
interface VerifiedPurchase {
  /** The store's own id for this subscription, kept for support and refunds. */
  providerSubscriptionId: string;
  /** When the paid period began, per the store. */
  periodStart: Date;
  /** When it ends — i.e. when the entitlement lapses if it is not renewed. */
  periodEnd: Date;
  /** True when the store has taken money (or granted a trial) for this period. */
  entitled: boolean;
  /** Why not, when `entitled` is false. Shown to the user, so keep it plain. */
  reason?: string;
  /** The store's raw answer, stored for audit. Never returned to the client. */
  raw: unknown;
}

/** Raised when a provider has no credentials configured on this deployment. */
class NotConfiguredError extends Error {
  constructor(readonly provider: Provider) {
    super(`verification_not_configured:${provider}`);
  }
}

/** Raised when the store answered, and the answer was "this is not valid". */
class RejectedError extends Error {}

// ============================================================================
// Google Play
// ============================================================================
// Verification is a two-step, server-to-server exchange:
//   1. sign a JWT with the service account's private key and trade it for an
//      OAuth access token scoped to the Android Publisher API;
//   2. ask Google directly whether that purchase token is a live subscription.
// Because step 2 is authenticated as our own service account, Google's answer
// is authoritative — nothing the client sent is trusted beyond the token, and a
// fabricated token simply comes back 400/404.

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

async function googleAccessToken(account: ServiceAccount): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );

  const assertion = `${header}.${claims}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`google_oauth_failed:${response.status}:${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  if (!payload?.access_token) throw new Error('google_oauth_failed:no_access_token');
  return payload.access_token as string;
}

async function verifyGooglePlay(
  productId: string,
  purchaseToken: string
): Promise<VerifiedPurchase> {
  const packageName = Deno.env.get('GOOGLE_PLAY_PACKAGE_NAME');
  const rawAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!packageName || !rawAccount) throw new NotConfiguredError('google_play');

  let account: ServiceAccount;
  try {
    account = JSON.parse(rawAccount);
  } catch {
    throw new Error('google_service_account_json_malformed');
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('google_service_account_json_incomplete');
  }

  const accessToken = await googleAccessToken(account);

  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(packageName)}/purchases/subscriptions/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });

  // 400/404 mean the token is not a real purchase for this product. 401/403
  // mean our own credentials are wrong — a configuration fault, not a bad
  // purchase, so it must not be reported to the user as a failed payment.
  if (response.status === 400 || response.status === 404) {
    throw new RejectedError('google_play: purchase token not recognised');
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`google_play_lookup_failed:${response.status}:${detail.slice(0, 300)}`);
  }

  const purchase = await response.json();

  // paymentState: 0 pending, 1 received, 2 free trial, 3 deferred.
  // Only 1 and 2 represent an entitlement we can act on today.
  const paymentState = Number(purchase?.paymentState ?? -1);
  const entitled = paymentState === 1 || paymentState === 2;

  const startMillis = Number(purchase?.startTimeMillis ?? Date.now());
  const expiryMillis = Number(purchase?.expiryTimeMillis ?? 0);

  return {
    providerSubscriptionId: String(purchase?.orderId ?? purchaseToken),
    periodStart: new Date(startMillis),
    periodEnd: expiryMillis > 0 ? new Date(expiryMillis) : new Date(Date.now() + 86_400_000),
    entitled,
    reason: entitled
      ? undefined
      : paymentState === 0
        ? 'Your payment is still being processed by Google Play.'
        : 'Google Play has not confirmed this purchase yet.',
    raw: purchase,
  };
}

// ============================================================================
// App Store
// ============================================================================
// The App Store Server API is authenticated with our own ES256 key, so a 200
// from it is Apple telling us, on an authenticated channel, what this
// transaction's status is. We read the subscription's latest transaction from
// that answer rather than trusting anything the app sent.
//
// Hardening note: the response's `signedTransactionInfo` is a JWS. Its payload
// is trusted here because of the authenticated channel above; a deployment that
// also wants offline-verifiable receipts should additionally validate the x5c
// chain against Apple's root CA before trusting the payload.

function derToRawEcdsa(der: Uint8Array): Uint8Array {
  // WebCrypto emits a DER SEQUENCE of two INTEGERs; JWS wants the raw r||s pair.
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('apple_signature_malformed');
  // Long-form length is possible but ES256 signatures never need it.
  let length = der[offset++];
  if (length & 0x80) {
    const byteCount = length & 0x7f;
    length = 0;
    for (let i = 0; i < byteCount; i += 1) length = (length << 8) | der[offset++];
  }

  const readInteger = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error('apple_signature_malformed');
    const size = der[offset++];
    const value = der.slice(offset, offset + size);
    offset += size;
    // Strip the leading zero DER adds to keep the value positive.
    return value.length > 32 && value[0] === 0 ? value.slice(1) : value;
  };

  const r = readInteger();
  const s = readInteger();
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function appleToken(): Promise<string> {
  const issuerId = Deno.env.get('APPLE_ISSUER_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  const bundleId = Deno.env.get('APPLE_BUNDLE_ID');
  if (!issuerId || !keyId || !privateKey || !bundleId) throw new NotConfiguredError('app_store');

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: issuerId,
      iat: issuedAt,
      exp: issuedAt + 1200, // Apple rejects anything beyond 60 minutes.
      aud: 'appstoreconnect-v1',
      bid: bundleId,
    })
  );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );

  return `${header}.${claims}.${base64url(derToRawEcdsa(new Uint8Array(signature)))}`;
}

/** Reads a JWS payload without verifying it — see the hardening note above. */
function decodeJwsPayload<T>(jws: string): T | null {
  try {
    const [, payload] = jws.split('.');
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(padded)) as T;
  } catch {
    return null;
  }
}

interface AppleTransactionInfo {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
}

async function verifyAppStore(transactionId: string): Promise<VerifiedPurchase> {
  const token = await appleToken();

  // Sandbox and production are separate hosts; a sandbox purchase is rejected
  // by the production host, so try production first and fall back.
  const hosts = [
    'https://api.storekit.itunes.apple.com',
    'https://api.storekit-sandbox.itunes.apple.com',
  ];

  let lastStatus = 0;
  let body: any = null;
  let host = hosts[0];

  for (host of hosts) {
    const response = await fetch(`${host}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    lastStatus = response.status;
    if (response.ok) {
      body = await response.json();
      break;
    }
    // 404 means "not on this host" — try the next one. Anything else is real.
    if (response.status !== 404 && response.status !== 401) {
      const detail = await response.text();
      throw new Error(`app_store_lookup_failed:${response.status}:${detail.slice(0, 300)}`);
    }
  }

  if (!body) {
    if (lastStatus === 401) throw new Error('app_store_auth_failed: check APPLE_KEY_ID / APPLE_PRIVATE_KEY');
    throw new RejectedError('app_store: transaction not recognised');
  }

  // data[].lastTransactions[] carries one entry per subscription in the group;
  // take the most recent expiry, which is the period currently in force.
  const transactions: AppleTransactionInfo[] = [];
  for (const group of body?.data ?? []) {
    for (const entry of group?.lastTransactions ?? []) {
      const info = decodeJwsPayload<AppleTransactionInfo>(entry?.signedTransactionInfo ?? '');
      if (info) transactions.push(info);
    }
  }

  if (transactions.length === 0) {
    throw new RejectedError('app_store: no transaction information returned');
  }

  const latest = transactions.reduce((best, current) =>
    (current.expiresDate ?? 0) > (best.expiresDate ?? 0) ? current : best
  );

  const periodEnd = latest.expiresDate
    ? new Date(latest.expiresDate)
    : new Date(Date.now() + 86_400_000);
  const periodStart = latest.purchaseDate ? new Date(latest.purchaseDate) : new Date();

  return {
    providerSubscriptionId: String(latest.originalTransactionId ?? latest.transactionId ?? transactionId),
    periodStart,
    periodEnd,
    entitled: periodEnd.getTime() > Date.now(),
    reason:
      periodEnd.getTime() > Date.now() ? undefined : 'This App Store subscription has expired.',
    raw: body,
  };
}

// ============================================================================
// Activation
// ============================================================================

/**
 * Write the verified purchase as the user's live subscription.
 *
 * A user has at most one live subscription (a partial unique index enforces
 * it), so an upgrade or renewal updates the existing row rather than inserting
 * a second one. The guard trigger permits this only because there is no
 * auth.uid() on a service-role call.
 */
async function activate(
  userId: string,
  plan: { id: string; duration_days: number; name: string },
  provider: Provider,
  productId: string,
  verified: VerifiedPurchase,
  rawReceipt: unknown
): Promise<{ subscriptionId: string; periodEnd: string }> {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('user_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['trialing', 'active', 'past_due'])
    .maybeSingle();
  if (lookupError) throw lookupError;

  const periodEnd =
    verified.periodEnd.getTime() > Date.now()
      ? verified.periodEnd
      : new Date(Date.now() + plan.duration_days * 86_400_000);

  const row = {
    user_id: userId,
    plan_id: plan.id,
    status: 'active' as const,
    started_at: verified.periodStart.toISOString(),
    current_period_start: verified.periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
    auto_renew: true,
    canceled_at: null,
    provider,
    provider_subscription_id: verified.providerSubscriptionId,
    provider_verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

  await supabaseAdmin.from('subscription_provider_receipts').insert({
    subscription_id: subscriptionId,
    user_id: userId,
    provider,
    provider_subscription_id: verified.providerSubscriptionId,
    purchase_token: verified.providerSubscriptionId,
    receipt: { productId },
    verification_status: 'verified',
    verified_at: new Date().toISOString(),
    raw_response: rawReceipt as any,
  });

  return { subscriptionId, periodEnd: periodEnd.toISOString() };
}

/** Record a purchase we looked at and refused, so support can see what happened. */
async function recordRejection(
  userId: string,
  provider: Provider,
  productId: string,
  token: string,
  rawReceipt: unknown,
  detail: string
): Promise<void> {
  await supabaseAdmin.from('subscription_provider_receipts').insert({
    user_id: userId,
    provider,
    purchase_token: token,
    receipt: { productId, detail },
    verification_status: 'invalid',
    raw_response: rawReceipt as any,
  });
}

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

  const provider = body?.provider as Provider;
  const planId = String(body?.planId ?? '').trim();
  const productId = String(body?.productId ?? '').trim();
  const token = String(body?.purchaseToken ?? body?.transactionId ?? '').trim();

  if (provider !== 'google_play' && provider !== 'app_store') {
    return json(
      { ok: false, error: 'invalid_request', message: 'Unknown provider.' },
      400,
      corsHeaders
    );
  }
  if (!planId || !productId || !token) {
    return json(
      {
        ok: false,
        error: 'invalid_request',
        message: 'planId, productId and a purchase token are all required.',
      },
      400,
      corsHeaders
    );
  }

  // The plan must exist, be on sale, and be a paid plan. A free trial is
  // granted by signup, never bought — accepting one here would let a client
  // "purchase" its way into a trial period reset.
  const { data: plan, error: planError } = await supabaseAdmin
    .from('subscription_plans')
    .select('id, name, price_php, duration_days, tier, is_active')
    .eq('id', planId)
    .maybeSingle();

  if (planError) {
    console.error('subscription-verify: plan lookup failed', planError);
    return json({ ok: false, error: 'lookup_failed' }, 500, corsHeaders);
  }
  if (!plan || !plan.is_active || plan.tier === 'free_trial' || Number(plan.price_php) <= 0) {
    return json(
      { ok: false, error: 'invalid_plan', message: 'That plan cannot be purchased.' },
      400,
      corsHeaders
    );
  }

  try {
    const verified =
      provider === 'google_play'
        ? await verifyGooglePlay(productId, token)
        : await verifyAppStore(token);

    if (!verified.entitled) {
      // The store recognised the purchase but has not granted it yet (a payment
      // still clearing, usually). Recorded, but nothing is activated.
      await recordRejection(userId, provider, productId, token, verified.raw, verified.reason ?? '');
      return json(
        {
          ok: true,
          status: 'pending_verification',
          message: verified.reason ?? 'The store has not confirmed this purchase yet.',
        },
        200,
        corsHeaders
      );
    }

    const activated = await activate(userId, plan, provider, productId, verified, verified.raw);

    // Hand back the recalculated entitlements so the app can render the new
    // plan immediately. They come from the same RPC the database enforces with,
    // never from the values the client sent.
    const { data: entitlements } = await supabaseAdmin.rpc('get_user_entitlements', {
      p_user_id: userId,
    });

    return json(
      {
        ok: true,
        status: 'activated',
        plan: { id: plan.id, name: plan.name },
        period_end: activated.periodEnd,
        entitlements: entitlements ?? null,
      },
      200,
      corsHeaders
    );
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      // Deliberately not an activation. Without credentials we cannot tell a
      // real purchase from a made-up one, so we refuse to grant anything.
      console.error(`subscription-verify: ${err.provider} secrets are not configured`);
      return json(
        {
          ok: false,
          error: 'verification_not_configured',
          configured: false,
          provider: err.provider,
          message:
            'Purchase verification is not set up on the server yet, so no plan was activated. Your purchase is safe with the store.',
        },
        503,
        corsHeaders
      );
    }

    if (err instanceof RejectedError) {
      await recordRejection(userId, provider, productId, token, null, err.message);
      return json(
        {
          ok: false,
          status: 'invalid',
          error: 'purchase_rejected',
          configured: true,
          message: err.message,
        },
        200,
        corsHeaders
      );
    }

    console.error('subscription-verify failed', err);
    return json(
      {
        ok: false,
        error: 'verification_failed',
        configured: true,
        message: 'Could not reach the store. Try again.',
      },
      502,
      corsHeaders
    );
  }
});
