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
import { COLORS, SPACING, RADII } from '../../../src/theme';
import {
  CheckCircle2, Trash2, AlertTriangle, CalendarDays, Tag, Barcode, StickyNote,
  Heart, Bell, Boxes, History,
} from 'lucide-react-native';
import {
  NavHeader, PillButton, StatusBadge, EmptyState, ItemImage, QuantityPrompt, Chip,
} from '../../../src/components/ui';

/** Canned offsets offered beside the expiration date. */
const DATE_CHIPS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: '+3 days', days: 3 },
  { label: '+1 week', days: 7 },
  { label: '+2 weeks', days: 14 },
  { label: '+1 month', days: 30 },
];

export default function InventoryDetailsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [promptOpen, setPromptOpen] = useState(false);
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
   * Written straight through to the row the reminder job reads, so changing
   * "3 days before" to "7 days before" takes effect on the next sweep rather
   * than only in this screen's memory.
   */
  const saveExpiration = async (days: number | null, alertDays?: ExpirationAlertDays) => {
    if (!item) return;

    let date: string | null = item.expiration_date;
    if (days !== null) {
      if (days === -1) {
        date = null;
      } else {
        const d = new Date();
        d.setDate(d.getDate() + days);
        date = d.toISOString().split('T')[0];
      }
    }

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

  const attr = (icon: any, label: string, value: string) => (
    <View style={styles.attrRow}>
      {icon}
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
            style={[styles.headerIcon, onNeedToBuy && styles.headerIconActive]}
          >
            {savingList ? (
              <ActivityIndicator size="small" color={COLORS.danger} />
            ) : (
              <Heart
                size={20}
                strokeWidth={2.2}
                color={onNeedToBuy ? COLORS.danger : COLORS.secondaryText}
                fill={onNeedToBuy ? COLORS.danger : 'transparent'}
              />
            )}
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 140 }}>

        <View style={styles.hero}>
          <ItemImage uri={item.image_url} category={item.category} size={108} radius={30} style={{ marginBottom: SPACING.md }} />
          <Text style={styles.name}>{item.product_name}</Text>
          <StatusBadge label={item.status === 'available' ? expBadge.label : item.status === 'consumed' ? 'Consumed' : 'Wasted'} tone={item.status !== 'available' ? 'neutral' : expBadge.tone} />
        </View>

        <View style={styles.card}>
          {attr(<Tag size={16} color={COLORS.primary} strokeWidth={2} />, 'Brand', item.brand || '—')}
          {attr(<Tag size={16} color={COLORS.primary} strokeWidth={2} />, 'Category', item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : '—')}
          {attr(null, 'Quantity', `${item.quantity} ${item.unit}`)}
          {attr(<CalendarDays size={16} color={COLORS.primary} strokeWidth={2} />, 'Expiration', date(item.expiration_date))}
          {attr(<CalendarDays size={16} color={COLORS.primary} strokeWidth={2} />, 'Added', date(item.purchase_date))}
          {attr(<Barcode size={16} color={COLORS.primary} strokeWidth={2} />, 'Barcode', item.barcode || '—')}
          {attr(<StickyNote size={16} color={COLORS.primary} strokeWidth={2} />, 'Notes', item.notes || 'No notes')}
          {attr(null, 'Price', item.price != null ? `₱${item.price.toFixed(2)}` : '—')}
        </View>

        {/* Expiration is editable right here, and the alert lead time with it —
            the spec asks for both on the item, not buried in settings. */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <CalendarDays size={16} color={COLORS.primary} strokeWidth={2.2} />
            <Text style={styles.cardTitle}>Expiration & alerts</Text>
            {busy && <ActivityIndicator size="small" color={COLORS.primary} />}
          </View>
          <Text style={styles.cardValue}>{date(item.expiration_date)}</Text>

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
              <Chip label="Clear date" active={false} onPress={() => saveExpiration(-1)} />
            )}
          </View>

          {!!item.expiration_date && (
            <>
              <View style={[styles.cardHead, { marginTop: SPACING.md }]}>
                <Bell size={16} color={COLORS.primary} strokeWidth={2.2} />
                <Text style={styles.cardTitle}>Remind me</Text>
              </View>
              <View style={styles.chipWrap}>
                {EXPIRATION_ALERT_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    active={item.expiration_alert_days === option.value}
                    onPress={() => saveExpiration(null, option.value)}
                  />
                ))}
              </View>
            </>
          )}
        </View>

        {areas.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Boxes size={16} color={COLORS.primary} strokeWidth={2.2} />
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
              <History size={16} color={COLORS.primary} strokeWidth={2.2} />
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
            <AlertTriangle size={15} color={COLORS.warningText} strokeWidth={2.2} />
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

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.md }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.mutedBg, alignItems: 'center', justifyContent: 'center',
  },
  headerIconActive: { backgroundColor: COLORS.dangerBg },
  hero: { alignItems: 'center', paddingVertical: SPACING.lg },
  name: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    paddingHorizontal: SPACING.lg, marginTop: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  attrRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider },
  attrLabel: { flex: 1, fontSize: 13, color: COLORS.secondaryText, marginLeft: 2 },
  attrValue: { fontSize: 14, color: COLORS.text, fontWeight: '600', textAlign: 'right', flex: 1.4 },
  warningTip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.warningBg, borderRadius: RADII.input, padding: SPACING.md, marginTop: SPACING.md },
  warningTipText: { flex: 1, fontSize: 13, color: COLORS.warningText, lineHeight: 19 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.white, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  deleteLink: { paddingHorizontal: SPACING.xs },
  deleteLinkText: { color: COLORS.danger, fontSize: 13, fontWeight: '700' },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 13 },
  cardTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.text },
  cardValue: { fontSize: 14, color: COLORS.secondaryText, marginTop: 4, marginBottom: SPACING.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingBottom: 13 },
  historyRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  historyRowLast: { borderBottomWidth: 0 },
  historyAction: { fontSize: 13.5, color: COLORS.text, fontWeight: '600' },
  historyTime: { fontSize: 11.5, color: COLORS.secondaryText, marginTop: 2 },
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
