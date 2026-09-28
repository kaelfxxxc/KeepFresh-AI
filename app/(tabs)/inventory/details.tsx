import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/context/AuthContext';
import { supabase } from '../../../src/lib/supabase';
import { inventoryService } from '../../../src/services/inventoryService';
import { groceryService } from '../../../src/services/groceryService';
import { storageAreaService, storageEmoji } from '../../../src/services/storageAreaService';
import {
  InventoryItem,
  InventoryTransaction,
  StorageArea,
  EXPIRATION_ALERT_OPTIONS,
  ExpirationAlertDays,
} from '../../../src/types';
import { getExpirationStatus } from '../../../src/utils/expiration';
import { addDaysKey } from '../../../src/utils/dateKey';
import { colors, radii, spacing, shadow } from '../../../src/theme';
import {
  CheckCircle2, Trash2, AlertTriangle, CalendarDays, Tag, Barcode, StickyNote,
  Heart, Bell, Boxes, History, ChevronDown,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { NavHeader, PillButton, StatusBadge, EmptyState, ItemImage, QuantityPrompt, Chip, IconBadge, colorWithOpacity } from '../../../src/components/ui';
import { DatePickerModal } from '../../../src/components/DatePicker';
import { usePageGutter } from '../../../src/hooks/useContentLayout';

/** Canned offsets offered beside the expiration date. */
const DATE_CHIPS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: '+3 days', days: 3 },
  { label: '+1 week', days: 7 },
  { label: '+2 weeks', days: 14 },
  { label: '+1 month', days: 30 },
];

export default function InventoryDetailsScreen() {
  const { gutter } = usePageGutter();
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [onGroceryList, setOnGroceryList] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [history, setHistory] = useState<InventoryTransaction[]>([]);

  const fetchItem = useCallback(async () => {
    if (!params.id) return;
    const { data } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', params.id)
      .single();
    setItem(data);
    setLoading(false);
  }, [params.id]);

  /** The audit trail for this item — written by a database trigger, so it
   *  includes changes made from another device. */
  const fetchHistory = useCallback(async () => {
    if (!params.id) return;
    try {
      setHistory(await inventoryService.getItemTransactions(params.id, 12));
    } catch {
      // History is supplementary; failing to load it must not break the screen.
    }
  }, [params.id]);

  useEffect(() => {
    if (!profile) return;
    fetchItem();
    fetchHistory();
    storageAreaService.list(profile.id).then(setAreas).catch(() => {});
  }, [profile, fetchItem, fetchHistory]);

  useFocusEffect(
    useCallback(() => {
      fetchItem();
      fetchHistory();
    }, [fetchItem, fetchHistory])
  );

  // Whether this product is already on the grocery list. Re-read on focus so a
  // row added before the `need_to_buy` flag existed still fills the heart, and
  // so removing it on the Grocery tab is reflected here.
  // Read-only: merely opening an item must not create a list.
  const syncGroceryState = useCallback(async () => {
    if (!profile || !item) return;
    try {
      const list = await groceryService.getCurrentGroceryList(profile.id);
      const existing = list
        ? await groceryService.findGroceryItemByName(list.id, item.product_name)
        : null;
      setOnGroceryList(!!existing);
    } catch {
      // Non-fatal — the heart just stays unfilled.
    }
  }, [profile, item?.id, item?.product_name]);

  useFocusEffect(useCallback(() => { syncGroceryState(); }, [syncGroceryState]));

  /**
   * The heart: this is something to buy more of.
   *
   * Two writes, because there are two places that answer "what do I need to
   * buy?" — the flag on the item, which is what puts it under the Inventory
   * tab's Need to Buy chip, and the grocery list, which is the shopping list
   * itself. Doing only the second is what made hearting look like it did
   * nothing: the Inventory tab never saw it.
   */
  const toggleNeedToBuy = async () => {
    if (!item || !profile || savingList) return;
    const next = !(item.need_to_buy || onGroceryList);
    setSavingList(true);
    try {
      setItem(await inventoryService.setNeedToBuy(item.id, next));

      const list = (await groceryService.getCurrentGroceryList(profile.id))
        ?? (await groceryService.createGroceryList(profile.id));
      const existing = await groceryService.findGroceryItemByName(list.id, item.product_name);

      if (next && !existing) {
        await groceryService.addGroceryItem(list.id, {
          name: item.product_name,
          category: item.category,
          quantity: item.quantity || 1,
          unit: item.unit,
          estimated_price: item.price,
          purchased: false,
        });
      } else if (!next && existing) {
        await groceryService.deleteGroceryItem(existing.id);
      }
      setOnGroceryList(next);
    } catch (error: any) {
      Alert.alert('Could not update Need to Buy', error?.message ?? 'Please try again.');
      // The two writes can part company if the second one fails, so re-read the
      // item rather than guessing which half landed.
      await fetchItem();
    } finally {
      setSavingList(false);
    }
  };

  const consume = () => setPromptOpen(true);

  /**
   * Edit the expiry date and/or how many days ahead to warn.
   *
   * `date` is the resolved value — null clears it — and every caller resolves to
   * one before calling, rather than passing an offset and having this function
   * guess which kind of number it was handed.
   *
   * Written straight through to the row the reminder job reads, so changing
   * "3 days before" to "7 days before" takes effect on the next sweep rather
   * than only in this screen's memory.
   */
  const commitExpiration = async (date: string | null, alertDays?: ExpirationAlertDays) => {
    if (!item) return;

    setBusy(true);
    try {
      const updated = await inventoryService.setExpiration(item.id, date, alertDays);
      setItem(updated);
      fetchHistory();
    } catch (error: any) {
      Alert.alert('Could not update expiration', error?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * A shortcut chip: an offset from today, or null to clear.
   *
   * `addDaysKey` counts in the app's timezone. The `toISOString()` this used to
   * do was the date at UTC, which in a +8 zone is still yesterday until 08:00
   * local — so "Today" stored yesterday's date for the first eight hours of the
   * day, and the item read as expiring a day early.
   */
  const saveExpiration = (days: number | null, alertDays?: ExpirationAlertDays) =>
    commitExpiration(days === null ? null : addDaysKey(days), alertDays);

  const moveToArea = async (areaId: string | null) => {
    if (!item) return;
    setBusy(true);
    try {
      const updated = await inventoryService.moveToArea(item.id, areaId);
      setItem(updated);
      fetchHistory();
    } catch (error: any) {
      Alert.alert('Could not move item', error?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Goes through the consume_inventory_item RPC: it locks the row, clamps the
  // quantity to what's on hand, and writes the consumption record atomically.
  const confirmConsume = async (qty: number) => {
    if (!item || !profile) return;
    setBusy(true);
    try {
      await inventoryService.consumeInventoryItem(profile.id, item.id, qty);
      setPromptOpen(false);
      await fetchItem();
    } catch (error: any) {
      Alert.alert('Could not record usage', error?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const markWaste = () => {
    if (!item || !profile) return;
    Alert.alert('Mark as Waste', `Record "${item.product_name}" as thrown away?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark as Waste', style: 'destructive',
        onPress: async () => {
          await supabase.from('food_waste').insert({
            user_id: profile.id, inventory_item_id: item.id,
            quantity: item.quantity, unit: item.unit,
            reason: 'User marked as waste',
            estimated_value: item.price ? item.price * item.quantity : 0,
          });
          await supabase.from('inventory_items').update({ status: 'wasted' }).eq('id', item.id);
          router.back();
        },
      },
    ]);
  };

  const remove = () => {
    if (!item) return;
    Alert.alert('Delete Item', `Remove "${item.product_name}" from your inventory?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('inventory_items').delete().eq('id', item.id);
          router.back();
        },
      },
    ]);
  };

  if (loading || !item) {
    return (
      <View style={styles.container}>
        <EmptyState title="Loading item…" />
      </View>
    );
  }

  const exp = getExpirationStatus(item.expiration_date);
  // The item's own flag is the truth; the grocery row is a fallback for items
  // hearted before the flag existed, so an older list still reads as set.
  const onNeedToBuy = !!item.need_to_buy || onGroceryList;
  const expBadge = {
    expired: { label: 'Expired', tone: 'danger' as const },
    today: { label: 'Expires today', tone: 'danger' as const },
    expiring_soon: { label: 'Expiring soon', tone: 'warning' as const },
    safe: { label: 'Fresh', tone: 'success' as const },
  }[exp];

  const date = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not set');

  /**
   * One attribute line: an optional tinted icon badge, the label, the value.
   *
   * Rows without an icon still hold the badge's width, so the labels stay in one
   * column down the card instead of stepping left on every iconless row.
   */
  const attr = (Icon: React.ComponentType<LucideProps> | null, label: string, value: string) => (
    <View style={styles.attrRow}>
      {Icon ? (
        <IconBadge color={colors.primary} size={28}>
          <Icon size={14} color={colors.primary} strokeWidth={2.4} />
        </IconBadge>
      ) : (
        <View style={styles.attrIconSpacer} />
      )}
      <Text style={styles.attrLabel}>{label}</Text>
      <Text style={styles.attrValue}>{value}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <NavHeader
        title="Item Details"
        right={
          <Pressable
            onPress={toggleNeedToBuy}
            disabled={savingList}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: onNeedToBuy }}
            accessibilityLabel={onNeedToBuy ? 'Remove from Need to Buy' : 'Add to Need to Buy'}
            style={[
              styles.headerIcon,
              // Same 15% tint recipe as IconBadge, so the header control reads as
              // the same kind of object as every other icon in the app.
              { backgroundColor: colorWithOpacity(onNeedToBuy ? colors.danger : colors.textSecondary, 0.15) },
            ]}
          >
            {savingList ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Heart
                size={20}
                strokeWidth={2.2}
                color={onNeedToBuy ? colors.danger : colors.textSecondary}
                fill={onNeedToBuy ? colors.danger : 'transparent'}
              />
            )}
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.xl, paddingHorizontal: gutter, paddingBottom: 140 }}>

        <View style={styles.hero}>
          <ItemImage uri={item.image_url} category={item.category} size={108} radius={30} style={{ marginBottom: spacing.md }} />
          <Text style={styles.name}>{item.product_name}</Text>
          <StatusBadge
            label={item.status === 'available' ? expBadge.label : item.status === 'consumed' ? 'Consumed' : 'Wasted'}
            // Wasted keeps its own violet here as well as on the list. These two
            // screens describe the same row, so a colour that meant "gone" on
            // one and "consumed" on the other would be worse than either.
            tone={
              item.status === 'consumed' ? 'neutral'
                : item.status === 'wasted' ? 'wasted'
                  : expBadge.tone
            }
          />
        </View>

        <View style={styles.card}>
          {attr(Tag, 'Brand', item.brand || '—')}
          {attr(Tag, 'Category', item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : '—')}
          {attr(null, 'Quantity', `${item.quantity} ${item.unit}`)}
          {attr(CalendarDays, 'Expiration', date(item.expiration_date))}
          {attr(CalendarDays, 'Added', date(item.purchase_date))}
          {attr(Barcode, 'Barcode', item.barcode || '—')}
          {attr(StickyNote, 'Notes', item.notes || 'No notes')}
          {attr(null, 'Price', item.price != null ? `₱${item.price.toFixed(2)}` : '—')}
        </View>

        {/* Expiration is editable right here, and the alert lead time with it —
            the spec asks for both on the item, not buried in settings. */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <IconBadge color={colors.primary} size={28}>
              <CalendarDays size={14} color={colors.primary} strokeWidth={2.4} />
            </IconBadge>
            <Text style={styles.cardTitle}>Expiration & alerts</Text>
            {busy && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
          {/* The date itself is the control, exactly as on Add Item: tap it to
              open the calendar. The chips below stay as the shortcuts for the
              dates people actually pick, so the common case is still one tap. */}
          <Pressable
            style={({ pressed }) => [styles.dateRow, pressed && styles.dateRowPressed]}
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              item.expiration_date
                ? `Expiration date, ${date(item.expiration_date)}. Change`
                : 'Set an expiration date'
            }
          >
            <Text style={[styles.cardValue, styles.dateRowText]}>
              {date(item.expiration_date)}
            </Text>
            <ChevronDown size={17} color={colors.textSecondary} strokeWidth={2.2} />
          </Pressable>

          <View style={styles.chipWrap}>
            {DATE_CHIPS.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                active={false}
                onPress={() => saveExpiration(option.days)}
              />
            ))}
            {!!item.expiration_date && (
              <Chip label="Clear date" active={false} onPress={() => saveExpiration(null)} />
            )}
          </View>

          {!!item.expiration_date && (
            <>
              <View style={[styles.cardHead, { marginTop: spacing.md }]}>
                <IconBadge color={colors.primary} size={28}>
                  <Bell size={14} color={colors.primary} strokeWidth={2.4} />
                </IconBadge>
                <Text style={styles.cardTitle}>Remind me</Text>
              </View>
              <View style={styles.chipWrap}>
                {EXPIRATION_ALERT_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    active={item.expiration_alert_days === option.value}
                    // The date is passed back unchanged — this chip only moves
                    // the lead time, and `commitExpiration` writes both columns.
                    onPress={() => commitExpiration(item.expiration_date, option.value)}
                  />
                ))}
              </View>
            </>
          )}
        </View>

        {areas.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <IconBadge color={colors.primary} size={28}>
                <Boxes size={14} color={colors.primary} strokeWidth={2.4} />
              </IconBadge>
              <Text style={styles.cardTitle}>Storage area</Text>
            </View>
            <View style={styles.chipWrap}>
              {areas.map((area) => (
                <Chip
                  key={area.id}
                  label={`${storageEmoji(area)} ${area.name}`}
                  active={item.storage_area_id === area.id}
                  onPress={() => moveToArea(area.id)}
                />
              ))}
              <Chip
                label="Unassigned"
                active={!item.storage_area_id}
                onPress={() => moveToArea(null)}
              />
            </View>
          </View>
        )}

        {history.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <IconBadge color={colors.primary} size={28}>
                <History size={14} color={colors.primary} strokeWidth={2.4} />
              </IconBadge>
              <Text style={styles.cardTitle}>History</Text>
            </View>
            {history.map((entry, index) => (
              <View
                key={entry.id}
                style={[styles.historyRow, index === history.length - 1 && styles.historyRowLast]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyAction}>{describeAction(entry)}</Text>
                  <Text style={styles.historyTime}>
                    {new Date(entry.created_at).toLocaleString(undefined, {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {item.status === 'available' && (
          <View style={styles.warningTip}>
            <IconBadge color={colors.warning} size={28}>
              <AlertTriangle size={14} color={colors.warning} strokeWidth={2.4} />
            </IconBadge>
            <Text style={styles.warningTipText}>
              {exp === 'expired' || exp === 'today'
                ? 'This item is at risk — use it today or record it as waste.'
                : exp === 'expiring_soon'
                ? 'Use soon, or consider freezing or cooking it into a meal.'
                : 'Looking fresh — no action needed right now.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.md }]}>
        {item.status === 'available' ? (
          <>
            <PillButton title="Mark as Waste" variant="dangerOutline" icon={Trash2} onPress={markWaste} style={{ flex: 1 }} />
            <PillButton title="Use / Consume" icon={CheckCircle2} onPress={consume} style={{ flex: 1 }} />
          </>
        ) : (
          <PillButton title="Delete Item" variant="danger" icon={Trash2} onPress={remove} />
        )}
        {item.status === 'available' && (
          <Pressable onPress={remove} style={styles.deleteLink} hitSlop={8}>
            <Text style={styles.deleteLinkText}>Delete</Text>
          </Pressable>
        )}
      </View>

      <QuantityPrompt
        visible={promptOpen}
        title="Use / Consume"
        message={`How many ${item.unit} of ${item.product_name} did you use?`}
        unit={item.unit}
        max={item.quantity}
        confirmLabel="Consume"
        busy={busy}
        onCancel={() => setPromptOpen(false)}
        onConfirm={confirmConsume}
      />

      {/* Same calendar the Add Item screen uses, and the same floor: it opens on
          the month holding the current date, but no day before today can be
          picked. An item that has already expired is the normal case here, so
          that date still shows as the selection and Clear is always available —
          it just cannot be moved to another day in the past. */}
      <DatePickerModal
        visible={pickerOpen}
        value={item.expiration_date}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(key) => {
          setPickerOpen(false);
          commitExpiration(key);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  headerIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  hero: { alignItems: 'center', paddingVertical: spacing.lg },
  name: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.lg,
    paddingHorizontal: spacing.lg, marginTop: spacing.md,
    ...shadow.card,
  },
  attrIconSpacer: { width: 28 },
  attrRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  attrLabel: { flex: 1, fontSize: 13, color: colors.textSecondary, marginLeft: 2 },
  attrValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', textAlign: 'right', flex: 1.4 },
  warningTip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colorWithOpacity(colors.warning, 0.15), borderRadius: radii.sm,
    padding: spacing.md, marginTop: spacing.md,
  },
  warningTipText: { flex: 1, fontSize: 13, color: colors.warning, lineHeight: 19 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  deleteLink: { paddingHorizontal: spacing.xs },
  deleteLinkText: { color: colors.danger, fontSize: 13, fontWeight: '700' },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: 13 },
  cardTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  cardValue: { fontSize: 14, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.sm },
  // The date and its chevron are one tappable row, so the vertical spacing moves
  // off the text and onto the row that now spans the card.
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: spacing.sm },
  dateRowPressed: { opacity: 0.7 },
  dateRowText: { flex: 1, marginTop: 0, marginBottom: 0 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingBottom: 13 },
  historyRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyRowLast: { borderBottomWidth: 0 },
  historyAction: { fontSize: 13.5, color: colors.textPrimary, fontWeight: '600' },
  historyTime: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
});

/**
 * One history line in plain language. The database records a machine-readable
 * action plus before/after quantities; this turns that into something a person
 * reads at a glance.
 */
function describeAction(entry: InventoryTransaction): string {
  const unit = entry.unit ? ` ${entry.unit}` : '';

  switch (entry.action) {
    case 'created':
      return `Added to inventory (${entry.quantity_after ?? 0}${unit})`;
    case 'quantity_increase':
      return `Quantity increased ${entry.quantity_before ?? 0} → ${entry.quantity_after ?? 0}${unit}`;
    case 'quantity_decrease':
      return `Quantity reduced ${entry.quantity_before ?? 0} → ${entry.quantity_after ?? 0}${unit}`;
    case 'consumed':
      return `Used ${Math.abs(entry.delta ?? 0)}${unit}`;
    case 'wasted':
      return `Marked as waste (${Math.abs(entry.delta ?? 0)}${unit})`;
    case 'expiration_changed':
      return 'Expiration date changed';
    case 'storage_moved':
      return 'Moved to another storage area';
    case 'bulk_add':
      return 'Added in a bulk import';
    case 'bulk_update':
      return 'Changed in a bulk edit';
    case 'bulk_delete':
      return 'Removed in a bulk delete';
    case 'deleted':
      return 'Deleted';
    default:
      return 'Updated';
  }
}
