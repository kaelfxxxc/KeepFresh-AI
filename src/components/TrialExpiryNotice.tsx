// TrialExpiryNotice — the one-time "your free trial has ended" alert.
//
// A trial ending is not something the user did, and it changes what the app will
// let them do, so it is worth interrupting for once. Once is the operative word:
// the acknowledgement lives in SubscriptionContext, persisted and keyed to the
// trial's own end date, so this can never nag on every launch — and a genuinely
// new trial on the same account would still notify.
//
// It renders no layout at all. It is mounted once, high in the tree, and its
// whole job is to watch a flag and raise a native alert.

import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSubscription } from '../context/SubscriptionContext';

export function TrialExpiryNotice() {
  const { entitlements, loading, trialJustEnded, acknowledgeTrialEnded } = useSubscription();
  const router = useRouter();

  /**
   * A native alert outlives React re-renders, so nothing about the component
   * stops a second one being raised while the first is still on screen. The flag
   * is cleared asynchronously (it waits on a storage read), which leaves exactly
   * that window open.
   */
  const showing = useRef(false);

  useEffect(() => {
    if (!trialJustEnded || loading) {
      if (!trialJustEnded) showing.current = false;
      return;
    }
    if (showing.current) return;
    showing.current = true;

    // After the fallback to the free tier, `plan_name` is the trial plan's own
    // name, which is what the user recognises.
    const name = entitlements?.plan_name ?? 'Your free trial';
    const endedOn = entitlements?.trial_ends_at
      ? new Date(entitlements.trial_ends_at).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;

    Alert.alert(
      'Your free trial has ended',
      `${name}${endedOn ? ` ended on ${endedOn}` : ' has ended'}. Your account is back on the free plan, ` +
        'so some features are paused.\n\nNothing was deleted — your inventory, storage areas and history ' +
        'are all still here.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => { acknowledgeTrialEnded(); } },
        {
          text: 'See plans',
          onPress: () => {
            acknowledgeTrialEnded();
            router.push('/subscription');
          },
        },
      ],
      {
        // Dismissing with the Android back button is a real path out of this
        // alert. Without acknowledging there too, the notice would return on the
        // next launch and the "one time" promise would be a lie.
        cancelable: true,
        onDismiss: () => { acknowledgeTrialEnded(); },
      }
    );
  }, [
    trialJustEnded,
    loading,
    entitlements?.plan_name,
    entitlements?.trial_ends_at,
    acknowledgeTrialEnded,
    router,
  ]);

  return null;
}
