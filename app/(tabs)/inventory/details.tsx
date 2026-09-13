import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/context/AuthContext';
import { supabase } from '../../../src/lib/supabase';
import { inventoryService } from '../../../src/services/inventoryService';
import { groceryService } from '../../../src/services/groceryService';
import { InventoryItem } from '../../../src/types';
import { getExpirationStatus } from '../../../src/utils/expiration';
import { COLORS, SPACING, RADII } from '../../../src/theme';
import { CheckCircle2, Trash2, AlertTriangle, CalendarDays, Tag, Barcode, StickyNote, Heart } from 'lucide-react-native';
import { NavHeader, PillButton, StatusBadge, EmptyState, ItemImage, QuantityPrompt } from '../../../src/components/ui';

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

  useEffect(() => { if (profile) fetchItem(); }, [profile, fetchItem]);

  // Whether this product is already on the grocery list. Re-read on focus so
  // the heart stays honest after the user edits the list on the Grocery tab.
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

  // Heart toggle. Adds the product to the grocery list so it shows up under
  // "to buy", or removes it if it's already there.
  const toggleGroceryList = async () => {
    if (!item || !profile || savingList) return;
    setSavingList(true);
    try {
      const list = (await groceryService.getCurrentGroceryList(profile.id))
        ?? (await groceryService.createGroceryList(profile.id));
      const existing = await groceryService.findGroceryItemByName(list.id, item.product_name);

      if (existing) {
        await groceryService.deleteGroceryItem(existing.id);
        setOnGroceryList(false);
      } else {
        await groceryService.addGroceryItem(list.id, {
          name: item.product_name,
          category: item.category,
          quantity: item.quantity || 1,
          unit: item.unit,
          estimated_price: item.price,
          purchased: false,
        });
        setOnGroceryList(true);
      }
    } catch (error: any) {
      Alert.alert('Could not update grocery list', error?.message ?? 'Please try again.');
    } finally {
      setSavingList(false);
    }
  };

  const consume = () => setPromptOpen(true);

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
            onPress={toggleGroceryList}
            disabled={savingList}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={onGroceryList ? 'Remove from grocery list' : 'Add to grocery list'}
            style={[styles.headerIcon, onGroceryList && styles.headerIconActive]}
          >
            {savingList ? (
              <ActivityIndicator size="small" color={COLORS.danger} />
            ) : (
              <Heart
                size={20}
                strokeWidth={2.2}
                color={onGroceryList ? COLORS.danger : COLORS.secondaryText}
                fill={onGroceryList ? COLORS.danger : 'transparent'}
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
});
