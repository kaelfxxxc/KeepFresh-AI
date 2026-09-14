import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from '../lib/supabase';
import { inventoryService } from './inventoryService';
import { groceryService } from './groceryService';
import type { Entitlements, InventoryItem } from '../types';

/**
 * Every notification this app schedules carries a kind and a dedupe key that
 * identifies the exact occasion it is about. Together they give us two things:
 *
 *   * only our own notifications are ever cancelled — a blanket
 *     `cancelAllScheduledNotificationsAsync()` would also wipe anything another
 *     part of the app had queued;
 *   * the same reminder can never be queued twice. Re-running a sweep replaces
 *     the previous copy for that key instead of stacking another on top.
 */
export type NotificationKind =
  | 'expiration'
  | 'expired'
  | 'low_inventory'
  | 'grocery_reminder'
  | 'subscription_renewal'
  | 'ai_usage'
  | 'inventory_limit';

/** Marks a scheduled request as ours. */
const APP_TAG = 'keepfresh';

/** Reminders land at 9am local — early enough to act, late enough to be civil. */
const REMINDER_HOUR = 9;

/** At or below this many units, an item counts as running low. */
export const LOW_STOCK_THRESHOLD = 2;

/** Warn once this share of the AI scan allowance is used. */
const USAGE_WARN_RATIO = 0.8;

/** Warn once this share of the product allowance is used. */
const CAPACITY_WARN_RATIO = 0.9;

/** How many days before renewal to mention it. */
const RENEWAL_LEAD_DAYS = 3;

/** The payload we attach to every request, so we can recognise our own work. */
type OurData = {
  app: typeof APP_TAG;
  kind: NotificationKind;
  dedupeKey: string;
  itemId?: string | null;
};

/** One notification we intend to deliver, now or later. */
interface PlannedNotification {
  kind: NotificationKind;
  dedupeKey: string;
  title: string;
  body: string;
  /** When to fire. A time in the past means "tell them now". */
  at: Date;
  itemId?: string | null;
}

/** Where a tap on one of our notifications should take the user. */
export interface NotificationTarget {
  pathname: string;
  params?: Record<string, string>;
}

/**
 * The screen a notification is about, given its payload.
 *
 * Deliberately total and pure: every kind we can schedule has an answer, an
 * unrecognised one still lands somewhere useful rather than doing nothing, and
 * the mapping can be reasoned about without a running navigator.
 *
 * An expiry reminder is the one case with a choice — when the payload names the
 * product we go straight to it, and when it does not (a legacy request, or one
 * whose item has since been deleted) the alerts list is the honest fallback.
 */
function targetForNotification(data: unknown): NotificationTarget {
  const fallback: NotificationTarget = { pathname: '/(tabs)/alerts' };
  if (!isOurs(data)) return fallback;

  switch (data.kind) {
    case 'expiration':
    case 'expired':
      return data.itemId
        ? { pathname: '/inventory/details', params: { id: data.itemId } }
        : fallback;
    case 'low_inventory':
      return { pathname: '/(tabs)/inventory' };
    case 'grocery_reminder':
      return { pathname: '/grocery' };
    case 'subscription_renewal':
    case 'ai_usage':
    case 'inventory_limit':
      return { pathname: '/subscription' };
    default:
      return fallback;
  }
}

function isOurs(data: unknown): data is OurData {
  return !!data && typeof data === 'object' && (data as OurData).app === APP_TAG;
}

function ourData(request: Notifications.NotificationRequest): OurData | null {
  const data = request.content.data;
  return isOurs(data) ? data : null;
}

/** Local midnight of a `YYYY-MM-DD` date column, without a UTC round-trip. */
function localDate(dateOnly: string): Date | null {
  const parsed = new Date(`${dateOnly}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `YYYY-MM-DD` in local time — the granularity the dedupe keys use. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whole days from one local date to another, ignoring the time of day. */
function daysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function atReminderHour(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(REMINDER_HOUR, 0, 0, 0);
  return copy;
}

function formatMoney(value: number): string {
  return `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const notificationService = {
  /**
   * Decide what the OS does with a notification that arrives while the app is
   * in the foreground.
   *
   * This is not cosmetic. Until a handler is set, expo-notifications discards
   * foreground notifications outright — and the sweep presents most reminders
   * (anything due now: expiry today, low stock, usage limits) immediately, which
   * only ever lands in the foreground. Without this they were never shown at
   * all, so there was nothing to tap.
   *
   * Safe to call more than once; the handler is a single slot, not a stack.
   */
  enableForegroundPresentation(): void {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  },

  /** The screen a tapped notification is about. See `targetForNotification`. */
  targetFor(data: unknown): NotificationTarget {
    return targetForNotification(data);
  },

  async requestPermission(): Promise<boolean> {
    if (!Device.isDevice) return false;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  },

  async registerForPushNotificationsAsync(): Promise<string | null> {
    if (!Device.isDevice) return null;

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return token;
  },

  async getPermissions(): Promise<Notifications.NotificationPermissionsStatus> {
    return await Notifications.getPermissionsAsync();
  },

  /** True when the OS will actually show what we schedule. */
  async canNotify(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  },

  // ---- Our own notifications ----------------------------------------------

  /** Everything we have queued, optionally narrowed to one kind. */
  async getScheduled(kind?: NotificationKind): Promise<Notifications.NotificationRequest[]> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.filter((request) => {
      const data = ourData(request);
      if (!data) return false;
      return kind ? data.kind === kind : true;
    });
  },

  /**
   * Cancel our queued notifications, optionally just one kind.
   *
   * Deliberately never the blanket cancel-all: only requests carrying our own
   * marker are touched.
   */
  async cancelScheduled(kind?: NotificationKind): Promise<number> {
    const mine = await this.getScheduled(kind);
    await Promise.all(
      mine.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
    );
    return mine.length;
  },

  async cancelNotification(identifier: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },

  /**
   * Drop queued reminders for items that are gone or already binned, so a
   * deleted product does not still nag three days later.
   */
  async syncExpirationReminders(
    userId: string,
    items: InventoryItem[],
    queued?: Notifications.NotificationRequest[]
  ): Promise<number> {
    const liveIds = new Set(items.map((item) => item.id));
    const scheduled = queued ?? (await this.getScheduled('expiration'));

    const stale = scheduled.filter((request) => {
      const data = ourData(request);
      return !!data && data.itemId != null && !liveIds.has(data.itemId);
    });

    await Promise.all(
      stale.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
    );

    return stale.length;
  },

  // ---- The sweep -----------------------------------------------------------

  /**
   * Build and deliver every reminder the current state calls for.
   *
   * Intended to run on app foreground. Safe to call as often as you like: each
   * occasion has a stable dedupe key, so a key already used is skipped rather
   * than repeated.
   *
   * Returns how many notifications were newly scheduled or shown, which makes
   * the sweep testable without inspecting the OS queue.
   */
  async runSweep(
    userId: string,
    entitlements: Entitlements | null,
    options: { items?: InventoryItem[] } = {}
  ): Promise<{ scheduled: number; presented: number }> {
    if (!(await this.canNotify())) return { scheduled: 0, presented: 0 };

    const prefs = await this.getPreferencesOrNull(userId);
    if (prefs && prefs.enabled === false) {
      // Honour the master switch by clearing what we queued, so turning
      // notifications off actually stops them.
      await this.cancelScheduled();
      return { scheduled: 0, presented: 0 };
    }

    const inventory = (
      options.items ?? (await inventoryService.getInventory(userId))
    ).filter((item) => item.status !== 'consumed' && item.status !== 'wasted');

    const plans: PlannedNotification[] = [
      ...this.planExpirationReminders(inventory),
      ...this.planLowStock(inventory),
      ...this.planSubscription(entitlements),
      ...this.planUsage(entitlements),
    ];

    if (prefs?.grocery_notifications) {
      plans.push(...(await this.planGroceryReminder(userId)));
    }

    // Retire reminders for products that no longer exist before adding new
    // ones, so the queue reflects the inventory as it stands today.
    const queued = await this.getScheduled();
    await this.syncExpirationReminders(userId, inventory, queued);

    return this.deliver(userId, plans, queued);
  },

  // ---- Planning ------------------------------------------------------------

  /**
   * A reminder for each item at its own alert offset, plus a separate nudge
   * once something has actually expired — a user who ignored the first still
   * needs to hear the second, and the two are different messages.
   */
  planExpirationReminders(items: InventoryItem[]): PlannedNotification[] {
    const now = new Date();
    const plans: PlannedNotification[] = [];

    items.forEach((item) => {
      if (!item.expiration_date) return;

      const expiresOn = localDate(item.expiration_date);
      if (!expiresOn) return;

      const daysLeft = daysBetween(now, expiresOn);
      const name = item.product_name || 'An item';

      if (daysLeft < 0) {
        // Expired. One notice per item per day, so a forgotten shelf cannot
        // turn into a week of repeated alerts.
        const overdue = Math.abs(daysLeft);
        plans.push({
          kind: 'expired',
          dedupeKey: `expired:${item.id}:${dayKey(now)}`,
          title: 'Expired',
          body: `${name} expired ${overdue} day${overdue === 1 ? '' : 's'} ago. Check it and clear it out.`,
          at: now,
          itemId: item.id,
        });
        return;
      }

      const alertDays = item.expiration_alert_days ?? 3;
      const fireOn = new Date(expiresOn);
      fireOn.setDate(fireOn.getDate() - alertDays);
      const fireAt = atReminderHour(fireOn);

      if (fireAt.getTime() <= now.getTime()) {
        // The chosen offset has already passed — say so today rather than
        // dropping the reminder silently.
        plans.push({
          kind: 'expiration',
          dedupeKey: `expiration:${item.id}:${dayKey(now)}:${alertDays}`,
          title: daysLeft === 0 ? 'Expires today' : 'Expiring soon',
          body:
            daysLeft === 0
              ? `${name} expires today. Use it or freeze it.`
              : `${name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
          at: now,
          itemId: item.id,
        });
        return;
      }

      plans.push({
        kind: 'expiration',
        dedupeKey: `expiration:${item.id}:${dayKey(fireOn)}:${alertDays}`,
        title: 'Expiring soon',
        body: `${name} expires on ${expiresOn.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`,
        at: fireAt,
        itemId: item.id,
      });
    });

    return plans;
  },

  /**
   * Low stock, said once a day at most rather than once per item — a pantry of
   * six nearly-finished things is one shopping trip, not six alerts.
   */
  planLowStock(items: InventoryItem[]): PlannedNotification[] {
    const now = new Date();
    const low = items.filter((item) => Number(item.quantity ?? 0) <= LOW_STOCK_THRESHOLD);
    if (low.length === 0) return [];

    const names = low.slice(0, 3).map((item) => item.product_name).filter(Boolean);
    const extra = low.length - names.length;

    return [
      {
        kind: 'low_inventory',
        // Keyed to the day only: the count changing is not a new occasion, or
        // adding one more nearly-empty jar would fire another alert.
        dedupeKey: `low_inventory:${dayKey(now)}`,
        title: 'Running low',
        body:
          extra > 0
            ? `${names.join(', ')} and ${extra} more are nearly out.`
            : `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} nearly out.`,
        at: now,
      },
    ];
  },

  /** Nudge about an unfinished shopping list, once an evening at most. */
  async planGroceryReminder(userId: string): Promise<PlannedNotification[]> {
    const list = await groceryService.getCurrentGroceryList(userId);
    if (!list) return [];

    const { data, error } = await supabase
      .from('grocery_items')
      .select('id')
      .eq('grocery_list_id', list.id)
      .eq('purchased', false);
    if (error || !data || data.length === 0) return [];

    const now = new Date();
    const evening = new Date(now);
    evening.setHours(18, 0, 0, 0);
    // If six o'clock has already gone, remind tomorrow rather than instantly.
    if (evening.getTime() <= now.getTime()) evening.setDate(evening.getDate() + 1);

    return [
      {
        kind: 'grocery_reminder',
        dedupeKey: `grocery_reminder:${dayKey(evening)}`,
        title: 'Shopping list',
        body: `${data.length} item${data.length === 1 ? '' : 's'} still to buy on ${list.name}.`,
        at: evening,
      },
    ];
  },

  /** Tell them before a renewal charges, and only once per billing period. */
  planSubscription(entitlements: Entitlements | null): PlannedNotification[] {
    if (!entitlements) return [];
    if (entitlements.status !== 'active' && entitlements.status !== 'trialing') return [];
    if (entitlements.cancel_at_period_end) return [];
    if (!entitlements.current_period_end) return [];

    const endsOn = new Date(entitlements.current_period_end);
    if (Number.isNaN(endsOn.getTime())) return [];

    const now = new Date();
    const daysLeft = daysBetween(now, endsOn);
    if (daysLeft > RENEWAL_LEAD_DAYS || daysLeft < 0) return [];

    const isTrial = entitlements.status === 'trialing';
    const when = isTrial
      ? `Your free trial ends ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}.`
      : `Your plan renews ${daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}.`;

    return [
      {
        kind: 'subscription_renewal',
        // Keyed to the period end, so next month's renewal is a new occasion.
        dedupeKey: `subscription_renewal:${entitlements.plan_id}:${dayKey(endsOn)}`,
        title: isTrial ? 'Free trial ending' : 'Subscription renewing',
        body: `${when} ${entitlements.plan_name} — ${formatMoney(entitlements.price_php)}.`,
        at: atReminderHour(now),
      },
    ];
  },

  /** Warn before a limit is hit, so the upgrade prompt is never a surprise. */
  planUsage(entitlements: Entitlements | null): PlannedNotification[] {
    if (!entitlements) return [];

    const now = new Date();
    const plans: PlannedNotification[] = [];

    const scanLimit = entitlements.max_ai_scans;
    const scansUsed = entitlements.ai_scans_used;
    if (
      scanLimit > 0 &&
      scansUsed >= Math.floor(scanLimit * USAGE_WARN_RATIO) &&
      scansUsed < scanLimit
    ) {
      plans.push({
        kind: 'ai_usage',
        dedupeKey: `ai_usage:${entitlements.usage_period_start}:${scansUsed}`,
        title: 'AI scans running low',
        body: `${scansUsed} of ${scanLimit} scans used this month. Upgrade for more.`,
        at: now,
      });
    }

    const productLimit = entitlements.max_products;
    const productsUsed = entitlements.products_used;
    if (
      productLimit > 0 &&
      productsUsed >= Math.floor(productLimit * CAPACITY_WARN_RATIO) &&
      productsUsed < productLimit
    ) {
      plans.push({
        kind: 'inventory_limit',
        dedupeKey: `inventory_limit:${entitlements.usage_period_start}:${productsUsed}`,
        title: 'Nearly at capacity',
        body: `${productsUsed} of ${productLimit} products used. Upgrade to add more.`,
        at: now,
      });
    }

    return plans;
  },

  // ---- Delivery ------------------------------------------------------------

  /**
   * Schedule what is in the future, present what is due, and record both.
   *
   * Immediate notifications are reserved through `log_notification`, whose
   * return value is the anti-spam gate: it answers false if this exact key has
   * already been announced. Future ones need no such gate — cancelling the
   * previous request for the key before scheduling makes them idempotent by
   * construction, which also survives a reinstall that a database log would
   * not know about.
   */
  async deliver(
    userId: string,
    plans: PlannedNotification[],
    queued: Notifications.NotificationRequest[] = []
  ): Promise<{ scheduled: number; presented: number }> {
    const now = Date.now();
    let scheduled = 0;
    let presented = 0;

    // Index the queue once rather than re-reading the OS list per plan.
    const byDedupeKey = new Map<string, string[]>();
    queued.forEach((request) => {
      const data = ourData(request);
      if (!data) return;
      const ids = byDedupeKey.get(data.dedupeKey) ?? [];
      ids.push(request.identifier);
      byDedupeKey.set(data.dedupeKey, ids);
    });

    for (const plan of plans) {
      const data: OurData = {
        app: APP_TAG,
        kind: plan.kind,
        dedupeKey: plan.dedupeKey,
        itemId: plan.itemId ?? null,
      };

      if (plan.at.getTime() > now) {
        // Replace rather than stack: at most one queued copy per occasion.
        const existing = byDedupeKey.get(plan.dedupeKey) ?? [];
        await Promise.all(
          existing.map((identifier) =>
            Notifications.cancelScheduledNotificationAsync(identifier)
          )
        );
        byDedupeKey.delete(plan.dedupeKey);

        const identifier = await Notifications.scheduleNotificationAsync({
          content: { title: plan.title, body: plan.body, sound: true, data },
          trigger: { date: plan.at },
        });
        byDedupeKey.set(plan.dedupeKey, [identifier]);

        await this.record(userId, plan);
        scheduled += 1;
        continue;
      }

      // Due now. The database decides whether this occasion has already been
      // announced, which is what keeps a repeated sweep from spamming.
      let maySend = true;
      try {
        const { data: allowed, error } = await supabase.rpc('log_notification', {
          p_user_id: userId,
          p_notification_type: plan.kind,
          p_dedupe_key: plan.dedupeKey,
          p_inventory_item_id: plan.itemId ?? null,
          p_title: plan.title,
          p_body: plan.body,
        });
        if (error) throw error;
        maySend = allowed !== false;
      } catch {
        // If the log is unreachable, fall back to the local queue as the only
        // guard: better to show a reminder than to silently drop it.
        maySend = true;
      }

      if (!maySend) continue;

      const identifier = await Notifications.scheduleNotificationAsync({
        content: { title: plan.title, body: plan.body, sound: true, data },
        // A null trigger means deliver immediately.
        trigger: null,
      });
      byDedupeKey.set(plan.dedupeKey, [identifier]);
      presented += 1;
    }

    return { scheduled, presented };
  },

  /**
   * Record a scheduled reminder. The result is intentionally ignored — the log
   * is a history here, not a gate, because `deliver` has already guaranteed a
   * single queued copy per key.
   */
  async record(userId: string, plan: PlannedNotification): Promise<void> {
    try {
      await supabase.from('notification_logs').insert({
        user_id: userId,
        notification_type: plan.kind,
        inventory_item_id: plan.itemId ?? null,
        title: plan.title,
        body: plan.body,
        sent_at: new Date().toISOString(),
      });
    } catch {
      // A missing history row must never break the sweep.
    }
  },

  /**
   * Retained for existing call sites. Prefer `runSweep`, which knows about
   * per-item alert offsets and deduplication.
   */
  async scheduleExpirationNotification(
    userId: string,
    itemId: string,
    title: string,
    message: string,
    secondsFromNow: number
  ): Promise<string | null> {
    try {
      const data: OurData = {
        app: APP_TAG,
        kind: 'expiration',
        dedupeKey: `legacy:${itemId}:${dayKey(new Date())}`,
        itemId,
      };

      const identifier = await Notifications.scheduleNotificationAsync({
        content: { title, body: message, sound: true, data },
        trigger: {
          seconds: secondsFromNow,
        },
      });

      await supabase.from('notification_logs').insert({
        user_id: userId,
        inventory_item_id: itemId,
        notification_type: 'expiration',
        sent_at: new Date().toISOString(),
      });

      return identifier;
    } catch (error) {
      console.error('Error scheduling notification:', error);
      return null;
    }
  },

  async getNotificationPreferences(userId: string) {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error) throw error;
    return data;
  },

  /** Same read, but a missing row is `null` rather than a thrown error. */
  async getPreferencesOrNull(userId: string) {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data;
  },

  async updateNotificationPreferences(userId: string, preferences: any): Promise<void> {
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
};
