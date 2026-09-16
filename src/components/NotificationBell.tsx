import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, CheckCheck, CheckCircle2 } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';
import { subscribeToTables } from '../lib/realtime';
import { COLORS, RADII, SHADOW, SPACING } from '../theme';
import { CountBadge, EmptyState } from './ui';
import { notificationService } from '../services/notificationService';
import type { NotificationEntry } from '../services/notificationService';
import { timeAgo } from '../utils/timeAgo';

/** Preferred card width. Narrowed on a phone that cannot fit it. */
const CARD_WIDTH = 340;
/** Tallest the card may grow before the list scrolls inside it. */
const CARD_MAX_HEIGHT = 420;
/** Header height, so the scrolling list can be bounded before layout. */
const HEADER_HEIGHT = 52;
/** Gap between the bell and the card below it. */
const GAP = 8;

/**
 * The notification bell and the dropdown it opens.
 *
 * A popover on the current screen rather than a push to an Alerts route: the
 * bell is how you check whether anything needs you, and navigating away to
 * answer that is a heavier move than the question deserves.
 *
 * Self-contained on purpose. The bell exists on the Home screen only, so it
 * owns its own state and its own realtime channel; a context provider would be
 * indirection with no second consumer.
 */
export function NotificationBell() {
  const { profile } = useAuth();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const bellRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [items, setItems] = useState<NotificationEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const uid = profile?.id;

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      // Both together: they are two halves of the same answer, and letting them
      // resolve separately would let the badge disagree with the list under it
      // for as long as the slower one took.
      const [list, count] = await Promise.all([
        notificationService.listNotifications(uid),
        notificationService.unreadCount(uid),
      ]);
      setItems(list);
      setUnread(count);
    } catch (e) {
      console.warn('Notification list failed:', e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime is a freshness layer only: if the socket drops, the list still
  // loads on mount and on every open. Any event on this user's notification
  // rows refetches both the list and the count — the same "re-run the query
  // rather than patch individual counters" rule the dashboard follows, so the
  // badge and the rows beneath it cannot drift apart.
  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToTables(
      `notifications:${uid}`,
      ['notification_logs'],
      () => { load(); },
      { userId: uid }
    );
  }, [uid, load]);

  const cardWidth = Math.min(CARD_WIDTH, screenWidth - SPACING.lg * 2);

  /**
   * Measure the bell, then open.
   *
   * The position is known before the card first renders, so it never appears in
   * the wrong place and jumps. `collapsable={false}` on the wrapper is what
   * makes the measurement reliable on Android, where a layout-only view is
   * otherwise flattened away before it can be measured.
   */
  const openDropdown = () => {
    const node = bellRef.current;
    load();

    if (!node) {
      setOpen(true);
      return;
    }

    node.measureInWindow((x, y, width, height) => {
      // Right-aligned to the bell, then held inside the page margins. The
      // second clamp is what keeps the card on screen when the bell is close to
      // the left edge on a narrow phone.
      const rightAlign = screenWidth - (x + width);
      const rightMost = screenWidth - cardWidth - SPACING.md;
      setAnchor({
        top: y + height + GAP,
        right: Math.max(SPACING.md, Math.min(rightAlign, rightMost)),
      });
      setOpen(true);
    });
  };

  const close = () => setOpen(false);

  const markAllRead = async () => {
    // Optimistic: the taps are the user's intent and the round trip is not
    // theirs to wait on. A failure refetches rather than leaving the UI
    // asserting something the database disagrees with.
    setItems((list) => list.map((entry) => ({ ...entry, read: true })));
    setUnread(0);
    try {
      await notificationService.markAllRead();
    } catch {
      load();
    }
  };

  const openEntry = (entry: NotificationEntry) => {
    close();

    if (!entry.read) {
      setItems((list) =>
        list.map((item) => (item.id === entry.id ? { ...item, read: true } : item))
      );
      setUnread((count) => Math.max(0, count - 1));
      notificationService.markRead(entry.id).catch(() => { load(); });
    }

    // Deferred by one frame: dismissing the modal and pushing a screen in the
    // same tick races the two transitions on iOS, and the push can be dropped.
    requestAnimationFrame(() => {
      // Rebuilt from the row and handed to the same mapping a tapped push uses,
      // so a notification opens the same screen however it was reached.
      router.push(
        notificationService.targetForRow({
          notification_type: entry.kind,
          inventory_item_id: entry.itemId,
          dedupe_key: null,
        })
      );
    });
  };

  // The list scrolls inside the card rather than growing past the bottom of the
  // screen, so a long history stays reachable without the card leaving the
  // viewport.
  const cardMaxHeight = anchor
    ? Math.min(CARD_MAX_HEIGHT, screenHeight - anchor.top - insets.bottom - SPACING.lg)
    : CARD_MAX_HEIGHT;

  return (
    <>
      <View ref={bellRef} collapsable={false}>
        <Pressable
          onPress={openDropdown}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
          }
          style={({ pressed }) => [styles.bellWrap, pressed && { opacity: 0.7 }]}
        >
          <Bell size={22} color={COLORS.text} strokeWidth={2} />
          <CountBadge count={unread} />
        </Pressable>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
        // Without this the modal is laid out below the status bar on Android
        // while measureInWindow reports window coordinates, which offsets the
        // card by the height of the status bar.
        statusBarTranslucent
      >
        {/* The backdrop is the "tap outside to dismiss" affordance, and the
            card stops the press from reaching it. Same pair as QuantityPrompt
            in ui.tsx. */}
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close notifications">
          <Pressable
            style={[
              styles.card,
              anchor ?? styles.cardFallback,
              { width: cardWidth, maxHeight: cardMaxHeight },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Notifications</Text>
              {unread > 0 && (
                <Pressable
                  onPress={markAllRead}
                  hitSlop={8}
                  style={({ pressed }) => [styles.markAll, pressed && { opacity: 0.7 }]}
                >
                  <CheckCheck size={14} color={COLORS.primary} strokeWidth={2.4} />
                  <Text style={styles.markAllText}>Mark all as read</Text>
                </Pressable>
              )}
            </View>

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            ) : items.length === 0 ? (
              // Wrapped so the block is centred against the card's full width.
              // The card is a fixed-width absolute box with no horizontal
              // padding of its own, so this is the one place the popover's
              // layout differs from the full-screen screens EmptyState was
              // written for.
              <View style={styles.emptyWrap}>
                <EmptyState
                  compact
                  icon={CheckCircle2}
                  title="You're all caught up!"
                  hint="Reminders about expiring items and running-low stock land here."
                />
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: Math.max(120, cardMaxHeight - HEADER_HEIGHT) }}
                contentContainerStyle={styles.list}
                showsVerticalScrollIndicator={false}
              >
                {items.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => openEntry(entry)}
                    style={({ pressed }) => [
                      styles.row,
                      !entry.read && styles.rowUnread,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <View style={[styles.dot, entry.read && styles.dotRead]} />
                    <View style={styles.rowBody}>
                      <Text
                        style={[styles.rowTitle, entry.read && styles.rowTitleRead]}
                        numberOfLines={1}
                      >
                        {entry.title}
                      </Text>
                      <Text style={styles.rowMessage} numberOfLines={2}>
                        {entry.body}
                      </Text>
                      <Text style={styles.rowTime}>{timeAgo(entry.at)}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // The same 42px rounded square as the plan button beside it, so the two
  // header actions read as one row.
  bellWrap: {
    width: 42,
    height: 42,
    borderRadius: RADII.icon,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.faint,
    position: 'relative',
  },
  // Light enough to read as a popover over the screen rather than a dialog
  // blocking it — the dashboard stays visible behind.
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
  card: {
    position: 'absolute',
    backgroundColor: COLORS.white,
    borderRadius: RADII.card,
    paddingVertical: SPACING.sm,
    ...SHADOW.card,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
  // Only used in the unmeasurable case, so the card still lands somewhere sane.
  cardFallback: { top: 90, right: SPACING.lg },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    height: HEADER_HEIGHT,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markAllText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  loading: { padding: SPACING.xl, alignItems: 'center' },
  // The wrapper owns the centring, so the block is centred against the card's
  // full width even if EmptyState's own `alignItems` is ever changed: the card
  // is a fixed-width absolute box with no horizontal padding of its own, and
  // this is the one place the popover's layout differs from the full-screen
  // screens EmptyState was written for. The vertical padding gives the block
  // equal room above and below instead of letting it hug the header.
  emptyWrap: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  list: { paddingHorizontal: SPACING.sm, paddingBottom: SPACING.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: RADII.input,
  },
  rowUnread: { backgroundColor: COLORS.primaryLight },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    backgroundColor: COLORS.danger,
  },
  // Kept in the layout rather than removed, so read and unread rows share one
  // left edge instead of the read ones shifting across.
  dotRead: { backgroundColor: 'transparent' },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: COLORS.text },
  rowTitleRead: { fontWeight: '600' },
  rowMessage: { fontSize: 12.5, color: COLORS.secondaryText, marginTop: 2, lineHeight: 17 },
  rowTime: { fontSize: 11, color: COLORS.secondaryText, marginTop: 4 },
});
