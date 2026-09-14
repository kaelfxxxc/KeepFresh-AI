import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { notificationService } from '../services/notificationService';

/**
 * Follow the notification the user tapped.
 *
 * A tap arrives by one of two routes, and both have to be handled for the
 * feature to feel whole:
 *
 *   * the app was already running (foreground or background) — the response
 *     comes through `addNotificationResponseReceivedListener`;
 *   * the tap is what launched the app — that response instead sits in
 *     `getLastNotificationResponseAsync`, ready for the rest of the session.
 *
 * `ready` gates navigation on the session being known. A cold-start tap lands
 * before `useAuth` has restored the user, and pushing a protected screen at that
 * moment would be undone by the layout's own redirect to Login. Waiting also
 * means the tap is only worth remembering while `ready` is false, because the
 * launching response is still readable from `getLastNotificationResponseAsync`
 * the moment we do become ready — so nothing needs to be stashed in between.
 */
export function useNotificationTaps(ready: boolean) {
  /** Requests already acted on, so a replay cannot push the same screen twice. */
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!ready) return;

    const open = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handled.current.has(id)) return;
      handled.current.add(id);

      router.push(notificationService.targetFor(response.notification.request.content.data));
    };

    let cancelled = false;

    // The tap that launched the app, if there was one.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (cancelled || !response) return;
        open(response);
        // Consumed. Left readable, it would re-open the same screen on the next
        // mount — a Fast Refresh, or a fresh login — long after the tap.
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {
        // A response we cannot read is not worth failing the session over.
      });

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [ready]);
}
