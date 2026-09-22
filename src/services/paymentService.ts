// Payment architecture — deliberately modular, deliberately server-verified.
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//   A plan is never activated by the client. The client's only job is to obtain
//   payment evidence — a store receipt, or a PayMongo checkout session id — and
//   hand it to a server function that validates it and writes
//   `user_subscriptions` itself. Nothing here can grant an entitlement;
//   `guard_subscription_update()` in the database rejects any client-side
//   attempt to change a plan.
//
// TWO KINDS OF PROVIDER, because they are genuinely different shapes:
//
//   * StoreAdapter  — Google Play / App Store. The purchase happens in a native
//     sheet and comes back as a receipt. Nothing implements this today: no
//     billing library is installed (neither `react-native-iap` nor a Play
//     Billing module — both need a native build), so `STORE_ADAPTERS` is empty.
//
//   * RedirectAdapter — PayMongo. The server creates a hosted checkout page and
//     the app opens it in a WebView; the payment happens off-device, and the
//     app asks the server afterwards whether it went through. This is what makes
//     GCash, Maya and QR Ph payable at all, and it needs no native module.
//
// Adding a provider means adding one adapter object, not rewriting screens.

import { supabase } from '../lib/supabase';
import type { BillingPeriod, Entitlements, PaymentProvider } from '../types';

/** The stores we know how to verify. */
export type StoreProvider = Extract<PaymentProvider, 'google_play' | 'app_store'>;

/** The redirect provider we know how to verify. */
export type RedirectProvider = Extract<PaymentProvider, 'paymongo'>;

export type PurchaseStatus =
  /** Server verified the payment and the plan is now live. */
  | 'activated'
  /** Receipt submitted; the store is still confirming (e.g. pending payment). */
  | 'pending_verification'
  /** The provider needs the user to pay on a hosted page. Follow `checkoutUrl`. */
  | 'redirect_required'
  /** No billing provider is configured in this build. */
  | 'unavailable'
  /** The user backed out of the store sheet. */
  | 'cancelled'
  /** Verification ran and rejected the receipt. */
  | 'failed';

/**
 * The result of a purchase attempt.
 *
 * A discriminated union rather than a bag of optional fields, so the one status
 * that carries a URL cannot be read without proving the URL is there. The screen
 * that navigates on `redirect_required` gets that guarantee from the compiler
 * rather than from a `??` at the call site.
 */
export type PurchaseOutcome =
  | { status: 'activated'; message: string; entitlements?: Entitlements | null }
  | {
      status: 'redirect_required';
      message: string;
      /** Where to send the user, and the id to quote when asking if they paid. */
      checkoutUrl: string;
      checkoutSessionId: string;
      /** What the hosted page will charge, in centavos. Shown before redirecting. */
      amountCentavos: number;
      /** True when the session was created on live keys and will move real money. */
      livemode: boolean;
    }
  | {
      status: 'pending_verification' | 'unavailable' | 'cancelled' | 'failed';
      message: string;
      entitlements?: Entitlements | null;
    };

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
  status?: 'activated' | 'pending_verification' | 'invalid' | 'pending' | 'already_paid';
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
function isUnverifiable(body: { configured?: boolean; error?: string } | null): boolean {
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
 * A redirect adapter: the payment happens on a hosted page, not on the device.
 *
 * There is no `restore()` here on purpose. A store keeps a list of what an
 * account owns, so "restore" is a question with an answer. A PayMongo checkout
 * is a single payment that either happened or did not, and the server already
 * knows — so the equivalent affordance is `confirm()`, not a restore.
 */
export interface RedirectAdapter {
  provider: RedirectProvider;
  /** Human name for messages. */
  label: string;
  /** Are the payment methods this provider offers switched on in this build? */
  isAvailable: () => boolean;
  /** The methods the hosted page will offer, for the fine print. */
  paymentMethods: string;
  /** Ask the server to open a checkout session for a plan. */
  startCheckout: (params: { planId: string }) => Promise<
    | {
        status: 'redirect';
        checkoutUrl: string;
        checkoutSessionId: string;
        amountCentavos: number;
        livemode: boolean;
      }
    | { status: 'unavailable'; message: string }
    | { status: 'failed'; message: string }
  >;
}

/**
 * Registered store adapters.
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
const STORE_ADAPTERS: StoreAdapter[] = [];

/** Shown whenever the deployment itself cannot verify a purchase. */
const UNVERIFIABLE_MESSAGE =
  'Purchase verification is not set up on the server yet, so no plan was activated and you have not been charged.';

/** Shown when the client flag is off and so no adapter is even offered. */
const NOT_ENABLED_MESSAGE =
  'Payments are not enabled in this build, so plans cannot be purchased from here yet. Purchases are verified on our server; nothing is activated locally.';

/**
 * Is PayMongo offered by this build?
 *
 * A build flag, and only a build flag: it decides whether the plan buttons are
 * live, not whether a payment is honoured. The server checks its own secrets
 * before it will create a session and answers `verification_not_configured` if
 * they are missing, so turning this on against an unconfigured server produces
 * an honest error rather than a silent failure. Turning it off is the supported
 * way to ship a build with no purchasing at all.
 */
function isPaymongoEnabled(): boolean {
  const raw = process.env.EXPO_PUBLIC_PAYMONGO_ENABLED;
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

/** PayMongo, as a redirect provider. */
const PAYMONGO_ADAPTER: RedirectAdapter = {
  provider: 'paymongo',
  label: 'PayMongo',
  paymentMethods: 'GCash, Maya or QR Ph',
  isAvailable: isPaymongoEnabled,

  async startCheckout({ planId }) {
    try {
      const { data, error } = await supabase.functions.invoke('paymongo-checkout', {
        body: { planId },
      });

      if (error) {
        const body = await readFunctionErrorBody(error);
        if (isUnverifiable(body)) {
          return { status: 'unavailable', message: body?.message ?? UNVERIFIABLE_MESSAGE };
        }
        return {
          status: 'failed',
          message: body?.message ?? 'We could not open a payment page just now. Please try again.',
        };
      }

      const result = data as {
        ok?: boolean;
        checkout_url?: string;
        checkout_session_id?: string;
        amount_centavos?: number;
        livemode?: boolean;
        message?: string;
        error?: string;
      } | null;

      if (result?.ok && result.checkout_url && result.checkout_session_id) {
        return {
          status: 'redirect',
          checkoutUrl: result.checkout_url,
          checkoutSessionId: result.checkout_session_id,
          amountCentavos: result.amount_centavos ?? 0,
          livemode: result.livemode === true,
        };
      }

      if (isUnverifiable(result)) {
        return { status: 'unavailable', message: result?.message ?? UNVERIFIABLE_MESSAGE };
      }

      return {
        status: 'failed',
        message: result?.message ?? 'We could not open a payment page just now. Please try again.',
      };
    } catch {
      return {
        status: 'failed',
        message: 'We could not reach the payment service. Check your connection and try again.',
      };
    }
  },
};

/**
 * Registered redirect adapters, in the order they are offered.
 *
 * One entry today. The list exists so that a second redirect provider (Stripe,
 * Xendit) slots in beside PayMongo without touching `purchase()`.
 */
const REDIRECT_ADAPTERS: RedirectAdapter[] = [PAYMONGO_ADAPTER];

export const paymentService = {
  /** True when at least one provider can actually take a payment in this build. */
  isConfigured(): boolean {
    return (
      STORE_ADAPTERS.some((adapter) => adapter.isAvailable()) ||
      REDIRECT_ADAPTERS.some((adapter) => adapter.isAvailable())
    );
  },

  availableProviders(): StoreAdapter[] {
    return STORE_ADAPTERS.filter((adapter) => adapter.isAvailable());
  },

  availableRedirectProviders(): RedirectAdapter[] {
    return REDIRECT_ADAPTERS.filter((adapter) => adapter.isAvailable());
  },

  /**
   * Is "Restore purchases" a question with an answer in this build?
   *
   * Only a store can be asked what an account owns. With no store adapter the
   * button could only ever report failure, so the screen hides it rather than
   * offering an action that cannot work.
   */
  canRestore(): boolean {
    return this.availableProviders().length > 0;
  },

  /** The methods a redirect provider will offer, for the fine print. */
  redirectPaymentMethods(): string | null {
    return this.availableRedirectProviders()[0]?.paymentMethods ?? null;
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
   * Buy a plan. Never activates anything locally.
   *
   * A store provider completes the purchase here and hands back a receipt. A
   * redirect provider can only produce a URL — the payment has not happened yet
   * — so this returns `redirect_required` and the caller navigates. The outcome
   * then arrives through `confirmCheckout()`.
   */
  async purchase(params: { planId: string; productId: string; period: BillingPeriod }): Promise<PurchaseOutcome> {
    const storeAdapter = this.availableProviders()[0];

    if (storeAdapter) {
      try {
        const result = await storeAdapter.purchase(params);

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
    }

    const redirectAdapter = this.availableRedirectProviders()[0];

    if (redirectAdapter) {
      const started = await redirectAdapter.startCheckout({ planId: params.planId });

      if (started.status === 'unavailable') {
        return { status: 'unavailable', message: started.message };
      }
      if (started.status === 'failed') {
        return { status: 'failed', message: started.message };
      }

      return {
        status: 'redirect_required',
        message: `Continue to ${redirectAdapter.label} to pay.`,
        checkoutUrl: started.checkoutUrl,
        checkoutSessionId: started.checkoutSessionId,
        amountCentavos: started.amountCentavos,
        livemode: started.livemode,
      };
    }

    return { status: 'unavailable', message: NOT_ENABLED_MESSAGE };
  },

  /**
   * "I have paid — is it active?"
   *
   * Called by the checkout screen when the hosted page reports success, and
   * again by the "check again" button if the redirect never arrives. The server
   * asks PayMongo; this only relays the answer, exactly like `verifyReceipt`.
   */
  async confirmCheckout(checkoutSessionId: string): Promise<PurchaseOutcome> {
    try {
      const { data, error } = await supabase.functions.invoke('paymongo-verify', {
        body: { checkoutSessionId },
      });

      if (error) {
        const body = await readFunctionErrorBody(error);
        if (isUnverifiable(body)) {
          return { status: 'unavailable', message: body!.message ?? UNVERIFIABLE_MESSAGE };
        }
        return {
          status: 'failed',
          message: body?.message ?? 'We could not confirm that payment. Please try again.',
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

      // The webhook got there first. From the customer's side that is the same
      // thing as activating it here.
      if (result?.ok && result.status === 'already_paid') {
        return {
          status: 'activated',
          message: 'Your plan is active.',
          entitlements: result.entitlements ?? null,
        };
      }

      // PayMongo has not seen a payment for this checkout yet. Not a failure —
      // the wallet may still be clearing — so it is reported as pending rather
      // than as an error the user should act on.
      if (result?.ok && result.status === 'pending') {
        return {
          status: 'pending_verification',
          message: result.message ?? 'PayMongo has not recorded that payment yet.',
        };
      }

      if (isUnverifiable(result)) {
        return { status: 'unavailable', message: result?.message ?? UNVERIFIABLE_MESSAGE };
      }

      return { status: 'failed', message: result?.message ?? 'That payment could not be confirmed.' };
    } catch {
      return {
        status: 'failed',
        message: 'We could not reach the payment service. Check your connection and try again.',
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
async function readFunctionErrorBody(
  error: unknown
): Promise<{ message?: string; configured?: boolean; error?: string } | null> {
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
