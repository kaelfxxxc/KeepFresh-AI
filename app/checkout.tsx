import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Linking, Pressable } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ShieldCheck, RefreshCw, RotateCcw } from 'lucide-react-native';
import { useSubscription } from '../src/context/SubscriptionContext';
import { colors, spacing } from '../src/theme';
import { NavHeader, PillButton, IconBadge } from '../src/components/ui';
import { paymentService } from '../src/services/paymentService';
import { useContentLayout } from '../src/hooks/useContentLayout';

/** Where PayMongo sends the browser once the payment page is finished. */
const SUCCESS_PREFIX = 'keepfreshai://checkout/success';
const CANCEL_PREFIX = 'keepfreshai://checkout/cancel';

/**
 * Schemes that belong to another app rather than to the web.
 *
 * `intent://` is Android's way of launching another app; react-native-webview
 * surfaces it through the same callback, and it has to be handed to the OS just
 * like `gcash://` or the button is equally dead there.
 */
const WALLET_SCHEMES = ['gcash:', 'maya:', 'paymaya:', 'intent:'];

const IDLE_MESSAGE = 'Complete the payment to activate your plan.';

type Phase = 'paying' | 'confirming' | 'pending' | 'done';

export default function CheckoutScreen() {
  const router = useRouter();
  const { refresh } = useSubscription();
  const { compact } = useContentLayout();

  const params = useLocalSearchParams<{
    url?: string;
    sessionId?: string;
    planName?: string;
    amountCentavos?: string;
    livemode?: string;
  }>();

  const checkoutUrl = typeof params.url === 'string' ? params.url : null;
  const checkoutSessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
  const planName = typeof params.planName === 'string' ? params.planName : 'your plan';
  const amountCentavos = Number(params.amountCentavos ?? 0);

  const [phase, setPhase] = useState<Phase>('paying');
  const [message, setMessage] = useState<string>(IDLE_MESSAGE);
  const [busy, setBusy] = useState(false);
  const [pageUrl, setPageUrl] = useState<string | null>(checkoutUrl);
  // Bumped to force the WebView to remount. Setting `source` back to the URL it
  // is already on is a no-op, so "Try again" needs this to actually reload.
  const [reloadToken, setReloadToken] = useState(0);

  // The success URL can fire more than once (a redirect chain, a re-render), and
  // two concurrent confirms would be two round trips for one answer.
  const confirmingRef = useRef(false);
  const finishedRef = useRef(false);

  // Pushed from the plans screen, so going back is normally just popping. The
  // replace is for the deep-link and hot-reload cases, where there is nothing
  // underneath to pop to.
  const returnToPlans = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/subscription');
  }, [router]);

  const finish = useCallback(
    (title: string, body: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      Alert.alert(title, body, [{ text: 'Done', onPress: returnToPlans }]);
    },
    [returnToPlans]
  );

  /**
   * Ask the server whether this checkout has been paid.
   *
   * Safe to call repeatedly: the server claims the attempt with a conditional
   * update, so a second call after the webhook has already activated the plan
   * reports success rather than extending the period again.
   */
  const confirm = useCallback(async () => {
    if (!checkoutSessionId || confirmingRef.current || finishedRef.current) return;

    confirmingRef.current = true;
    setPhase('confirming');
    setMessage('Checking with PayMongo…');

    try {
      const outcome = await paymentService.confirmCheckout(checkoutSessionId);

      if (outcome.status === 'activated') {
        setPhase('done');
        setMessage('Your plan is active.');
        // Realtime would get there on its own, but the customer is looking at
        // this screen right now and should not have to wait for a socket.
        await refresh();
        finish('Payment received', `${planName} is now active.`);
        return;
      }

      // Not a failure — the wallet may still be clearing — so it reads as "not
      // yet" rather than as an error to act on.
      setPhase('pending');
      setMessage(outcome.message);
    } finally {
      confirmingRef.current = false;
    }
  }, [checkoutSessionId, finish, planName, refresh]);

  /**
   * Hand a wallet's URL to the OS, since the WebView cannot follow it.
   *
   * On Android an `intent://` URL may refuse to open when no app handles it.
   * PayMongo puts a `browser_fallback_url` in the extras for exactly that case,
   * so rather than leaving the customer on a dead button we load it.
   */
  const openWallet = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      const fallback = fallbackUrlFromIntent(url);
      if (fallback) {
        setBusy(true);
        setPageUrl(fallback);
        return;
      }
      setPhase('pending');
      setMessage('We could not open your wallet app. Finish the payment in the page above, then tap "I have paid".');
    }
  }, []);

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation): boolean => {
      const url = request.url ?? '';

      if (url.startsWith(SUCCESS_PREFIX)) {
        confirm();
        return false;
      }

      if (url.startsWith(CANCEL_PREFIX)) {
        if (!finishedRef.current) {
          finishedRef.current = true;
          returnToPlans();
        }
        return false;
      }

      const lower = url.toLowerCase();
      if (WALLET_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
        openWallet(url);
        return false;
      }

      return true;
    },
    [confirm, openWallet, returnToPlans]
  );

  const retry = useCallback(() => {
    setPageUrl(checkoutUrl);
    setReloadToken((token) => token + 1);
    setBusy(false);
    setPhase('paying');
    setMessage(IDLE_MESSAGE);
  }, [checkoutUrl]);

  const checkAgain = useCallback(() => {
    finishedRef.current = false;
    confirm();
  }, [confirm]);

  const leave = useCallback(() => {
    // Leaving mid-payment is allowed, but only after saying so: the payment may
    // well still go through, and the plan activates when it does.
    Alert.alert(
      'Leave checkout?',
      'If you have already paid, your plan will still be activated — check the plans screen in a moment.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: returnToPlans },
      ]
    );
  }, [returnToPlans]);

  // Nothing to show without a session — the screen is only ever reached from a
  // successful `paymongo-checkout` call, so this is a deep-link or a hot-reload
  // edge, not a normal path.
  if (!checkoutUrl || !checkoutSessionId || !pageUrl) {
    return (
      <View style={styles.root}>
        <NavHeader title="Checkout" onBack={returnToPlans} />
        <View style={styles.centered}>
          <Text style={styles.title}>This checkout link is incomplete</Text>
          <Text style={styles.body}>
            Go back to the plans screen and choose a plan again. You have not been charged.
          </Text>
          <PillButton
            title="Back to plans"
            onPress={returnToPlans}
            style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
          />
        </View>
      </View>
    );
  }

  const amountLabel =
    amountCentavos > 0
      ? `₱${(amountCentavos / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : null;

  return (
    <View style={styles.root}>
      <NavHeader
        title="Payment"
        subtitle={amountLabel ? `${planName} · ${amountLabel}` : planName}
        onBack={leave}
      />

      <View style={styles.statusBar}>
        {phase === 'confirming' ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : phase === 'done' ? (
          <IconBadge color={colors.primary} size={28}>
            <ShieldCheck size={15} color={colors.primary} strokeWidth={2.4} />
          </IconBadge>
        ) : phase === 'pending' ? (
          <IconBadge color={colors.warning} size={28}>
            <RefreshCw size={15} color={colors.warning} strokeWidth={2.4} />
          </IconBadge>
        ) : (
          <IconBadge color={colors.textSecondary} size={28}>
            <ShieldCheck size={15} color={colors.textSecondary} strokeWidth={2.2} />
          </IconBadge>
        )}
        <Text style={styles.statusText}>{message}</Text>
      </View>

      <WebView
        key={reloadToken}
        source={{ uri: pageUrl }}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={() => setBusy(false)}
        onError={() => {
          setBusy(false);
          setMessage('The payment page could not be loaded. Check your connection, then tap "I have paid".');
        }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Opening PayMongo…</Text>
          </View>
        )}
        // The hosted page keeps the session in a cookie, and it decides between
        // the wallet buttons and a desktop QR flow from the user agent — so the
        // app has to look like the mobile browser it is standing in for.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        applicationNameForUserAgent="KeepFreshAI/1.0"
        style={styles.webview}
      />

      {/* Deliberately always available. The redirect back is the least reliable
          part of a hosted flow, and a customer who has paid must never be stuck
          on a page with no way to say so. */}
      <View style={[styles.actions, compact && styles.actionsCompact]}>
        <PillButton
          title="I have paid — check again"
          icon={RefreshCw}
          loading={phase === 'confirming' || busy}
          onPress={checkAgain}
          style={compact ? undefined : { flex: 1 }}
        />
        {phase === 'pending' && (
          <PillButton
            title="Try again"
            icon={RotateCcw}
            variant="outline"
            onPress={retry}
            style={compact ? undefined : { flex: 1 }}
          />
        )}
      </View>

      <Pressable onPress={returnToPlans} style={styles.cancelLink}>
        <Text style={styles.cancelLinkText}>Cancel and go back to plans</Text>
      </Pressable>
    </View>
  );
}

/**
 * Pull `browser_fallback_url` out of an Android `intent://` URL.
 *
 * The format is `intent://<data>#Intent;<extras>;end`, where the extras are
 * `key=value` pairs and string values are URL-encoded. Only the one key matters
 * here, and returning null when it is absent is the honest answer — there is
 * nowhere to send the customer.
 */
function fallbackUrlFromIntent(url: string): string | null {
  const hash = url.indexOf('#Intent;');
  if (hash === -1) return null;

  const extras = url.slice(hash + '#Intent;'.length);
  for (const part of extras.split(';')) {
    if (!part.startsWith('S.browser_fallback_url=')) continue;
    const raw = part.slice('S.browser_fallback_url='.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: colors.screenBg,
  },
  webview: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, justifyContent: 'center', padding: spacing.xl },

  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  body: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },

  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statusText: { flex: 1, fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { color: colors.textSecondary, fontSize: 13 },

  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actionsCompact: { flexDirection: 'column' },

  cancelLink: { paddingVertical: spacing.md, alignItems: 'center', backgroundColor: colors.surface },
  cancelLinkText: { color: colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
});
