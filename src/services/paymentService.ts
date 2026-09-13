// Payment architecture — deliberately modular, deliberately server-verified.
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//   A plan is never activated by the client. The client's only job is to obtain
//   a purchase token / receipt from the store and hand it to the
//   `subscription-verify` edge function, which validates it against Google Play
//   or the App Store and writes `user_subscriptions` itself. Nothing here can
//   grant an entitlement — `guard_subscription_update()` in the database
//   rejects any client-side attempt to change a plan.
//
// WHERE THIS IS TODAY:
//   No store billing library is installed in this project (neither
//   `react-native-iap` nor a Play Billing module — both need a native build).
//   So `availableProviders()` currently returns an empty list and `purchase()`
//   reports `unavailable` with a real explanation instead of pretending to
//   succeed. The flow below is complete; dropping in a provider means adding
//   one adapter object in `PROVIDER_ADAPTERS`, not rewriting screens.

import { supabase } from '../lib/supabase';
import type { BillingPeriod, Entitlements, PaymentProvider } from '../types';

/** The stores we know how to verify. */
export type StoreProvider = Extract<PaymentProvider, 'google_play' | 'app_store'>;

export type PurchaseStatus =
  /** Server verified the receipt and the plan is now live. */
  | 'activated'
  /** Receipt submitted; the store is still confirming (e.g. pending payment). */
  | 'pending_verification'
  /** No billing provider is configured in this build. */
  | 'unavailable'
  /** The user backed out of the store sheet. */
  | 'cancelled'
  /** Verification ran and rejected the receipt. */
  | 'failed';

export interface PurchaseOutcome {
  status: PurchaseStatus;
  message: string;
  entitlements?: Entitlements | null;
}

export interface ReceiptPayload {
  provider: StoreProvider;
  planId: string;
  /** Google Play purchase token, or the App Store receipt/JWS representation. */
  purchaseToken: string;
  productId?: string;
  transactionId?: string;
}

/** The verifier's own vocabulary, mirrored so the client can branch on it. */
interface VerificationResponse {
  ok?: boolean;
  status?: 'activated' | 'pending_verification' | 'invalid';
  /** Set to false when the deployment has no store credentials at all. */
  configured?: boolean;
  error?: string;
  message?: string;
  entitlements?: Entitlements | null;
}

/**
 * A response that means "nobody can verify anything here yet" rather than
 * "your purchase was rejected". The two need different messages: one is our
 * misconfiguration, the other is the user's problem to fix.
 */
function isUnverifiable(body: VerificationResponse | null): boolean {
  if (!body) return false;
  return body.configured === false || body.error === 'verification_not_configured';
}

/**
 * A store adapter. Implementing a new provider means implementing this and
 * registering it — the screens and the verifier stay untouched.
 */
export interface StoreAdapter {
  provider: StoreProvider;
  /** Human name for messages. */
  label: string;
  /** Is the native billing module present and usable in this build? */
  isAvailable: () => boolean;
  /** Present the store's purchase sheet and return what it produced. */
  purchase: (params: {
    planId: string;
    productId: string;
    period: BillingPeriod;
  }) => Promise<
    | { status: 'purchased'; receipt: ReceiptPayload }
    | { status: 'cancelled' }
    | { status: 'failed'; message: string }
  >;
  /** Re-deliver already-owned subscriptions, for "Restore purchases". */
  restore: () => Promise<ReceiptPayload[]>;
}

/**
 * Registered adapters.
 *
 * Empty on purpose: no native billing library is installed, so we have nothing
 * that can honestly produce a receipt. Adding Google Play support is:
 *
 *   1. `npx expo install react-native-iap` and rebuild the native app
 *   2. implement the adapter below against react-native-iap
 *   3. add its product IDs to app.json / the Play Console
 *   4. add it here, and set the store credentials as Supabase secrets for the
 *      `subscription-verify` function
 *
 * Until step 4 is done, the verifier will refuse the receipt anyway — which is
 * the point.
 */
const PROVIDER_ADAPTERS: StoreAdapter[] = [];

/** Shown whenever the deployment itself cannot verify a purchase. */
const UNVERIFIABLE_MESSAGE =
  'Purchase verification is not set up on the server yet, so no plan was activated and you have not been charged.';

export const paymentService = {
  /** True when at least one store adapter can actually produce a receipt. */
  isConfigured(): boolean {
    return PROVIDER_ADAPTERS.some((adapter) => adapter.isAvailable());
  },

  availableProviders(): StoreAdapter[] {
    return PROVIDER_ADAPTERS.filter((adapter) => adapter.isAvailable());
  },

  /**
   * Send a receipt to the server for verification. The server decides whether
   * the plan activates; we only relay the answer.
   */
  async verifyReceipt(receipt: ReceiptPayload): Promise<PurchaseOutcome> {
    try {
      const { data, error } = await supabase.functions.invoke('subscription-verify', {
        body: receipt,
      });

      if (error) {
        // The function returns a JSON body explaining itself; surface that
        // rather than a generic supabase-js message where we can.
        const body = await readFunctionErrorBody(error);
        if (isUnverifiable(body)) {
          return { status: 'unavailable', message: body!.message ?? UNVERIFIABLE_MESSAGE };
        }
        return {
          status: 'failed',
          message:
            body?.message ??
            'We could not verify that purchase. You have not been charged twice — please try restoring purchases.',
        };
      }

      const result = data as VerificationResponse | null;

      if (result?.ok && result.status === 'activated') {
        return {
          status: 'activated',
          message: 'Your plan is active.',
          entitlements: result.entitlements ?? null,
        };
      }

      if (result?.status === 'pending_verification') {
        return {
          status: 'pending_verification',
          message:
            result.message ??
            'The store is still confirming your payment. Your plan will start as soon as it clears.',
        };
      }

      if (isUnverifiable(result)) {
        return { status: 'unavailable', message: result?.message ?? UNVERIFIABLE_MESSAGE };
      }

      return {
        status: 'failed',
        message: result?.message ?? 'That purchase could not be verified.',
      };
    } catch {
      return {
        status: 'failed',
        message: 'We could not reach the verification service. Check your connection and try again.',
      };
    }
  },

  /**
   * Buy a plan. Never activates anything locally — it obtains a receipt and
   * hands it to the verifier.
   */
  async purchase(params: { planId: string; productId: string; period: BillingPeriod }): Promise<PurchaseOutcome> {
    const adapter = this.availableProviders()[0];

    if (!adapter) {
      return {
        status: 'unavailable',
        message:
          'In-app purchases are not enabled in this build. Billing is verified on our server, so a plan has to be activated there — please contact support to subscribe.',
      };
    }

    try {
      const result = await adapter.purchase(params);

      if (result.status === 'cancelled') {
        return { status: 'cancelled', message: 'Purchase cancelled.' };
      }
      if (result.status === 'failed') {
        return { status: 'failed', message: result.message };
      }

      return await this.verifyReceipt(result.receipt);
    } catch (error) {
      return {
        status: 'failed',
        message: (error as Error)?.message ?? 'The store could not complete that purchase.',
      };
    }
  },

  /** Re-verify subscriptions the store already knows about. */
  async restore(): Promise<PurchaseOutcome> {
    const adapter = this.availableProviders()[0];
    if (!adapter) {
      return {
        status: 'unavailable',
        message: 'Purchases can only be restored in a build with store billing enabled.',
      };
    }

    try {
      const receipts = await adapter.restore();
      if (receipts.length === 0) {
        return { status: 'failed', message: 'No previous purchases were found on this account.' };
      }
      // Most recent first — the store returns oldest-first.
      return await this.verifyReceipt(receipts[receipts.length - 1]);
    } catch (error) {
      return {
        status: 'failed',
        message: (error as Error)?.message ?? 'Could not restore purchases.',
      };
    }
  },
};

/**
 * Supabase wraps a non-2xx edge-function response in a FunctionsHttpError whose
 * body is only reachable through the raw Response. Pull the JSON explanation
 * out so the user sees "billing is not configured" instead of "non-2xx".
 */
async function readFunctionErrorBody(error: unknown): Promise<{ message?: string; configured?: boolean } | null> {
  try {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      // A response body can only be read once; guard against a double read.
      const clone = typeof context.clone === 'function' ? context.clone() : context;
      return await clone.json();
    }
  } catch {
    // Fall through — the caller shows its generic message.
  }
  return null;
}
