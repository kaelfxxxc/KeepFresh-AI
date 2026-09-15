import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/context/AuthContext';
import { useSubscription } from '../../../src/context/SubscriptionContext';
import { inventoryService } from '../../../src/services/inventoryService';
import { storageAreaService, storageEmoji } from '../../../src/services/storageAreaService';
import { describeEntitlementError, type GateResult } from '../../../src/services/entitlementService';
import { COLORS, SPACING, RADII } from '../../../src/theme';
import { EXPIRATION_ALERT_OPTIONS, ExpirationAlertDays, StorageArea } from '../../../src/types';
import { Tag, CalendarDays, PackagePlus, PencilLine, Bell, Boxes } from 'lucide-react-native';
import { NavHeader, Field, PillButton, UpgradeNotice } from '../../../src/components/ui';
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  categoryIcon,
  resolveCategory,
} from '../../../src/utils/categoryIcons';

const UNITS = ['pcs', 'kg', 'g', 'lb', 'oz', 'L', 'ml', 'cups', 'pack', 'bottle', 'can', 'box'];

export default function AddItemScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Record<string, string>>();
  const { profile } = useAuth();
  const { gates } = useSubscription();
  const [loading, setLoading] = useState(false);
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [storageAreaId, setStorageAreaId] = useState<string | null>(null);
  const [alertDays, setAlertDays] = useState<ExpirationAlertDays>(3);
  const [upgrade, setUpgrade] = useState<GateResult | null>(null);

  // The form holds a canonical category key, not a label: the key is what gets
  // stored and what the icon resolver reads back, so nothing has to translate
  // between the two on save. A value handed over from a scan is normalized here,
  // which is what lets a barcode provider's breadcrumb or a vision model's answer
  // land on the right chip instead of falling through to "Other".
  const [form, setForm] = useState({
    product_name: params.product_name || '',
    brand: params.brand || '',
    category: resolveCategory(params.category),
    quantity: params.quantity || '1',
    unit: UNITS.includes(params.unit || '') ? (params.unit as string) : 'pcs',
    expiration_date: params.expiration_date || '',
    purchase_date: new Date().toISOString().split('T')[0],
    price: params.price || '',
    notes: params.notes || '',
    barcode: params.barcode || '',
    image_url: '',
  });

  const editing = !!params.product_name || !!params.barcode;

  // The plan's storage areas. Pre-select the default so the common case needs
  // no extra tap, and so new items are never silently "unassigned".
  useEffect(() => {
    if (!profile) return;
    storageAreaService
      .list(profile.id)
      .then((list) => {
        setAreas(list);
        setStorageAreaId((current) => current ?? list.find((a) => a.is_default)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => {
        // No areas only costs us the picker; the item still saves.
      });
  }, [profile]);

  const setExpiry = (days: number) => {
    if (days === -9999) {
      // "Clear" must clear. Adding a negative offset produced a date in 1997,
      // which read as long-expired rather than as no date at all.
      setForm((prev) => ({ ...prev, expiration_date: '' }));
      return;
    }
    const d = new Date();
    d.setDate(d.getDate() + days);
    setForm((prev) => ({ ...prev, expiration_date: d.toISOString().split('T')[0] }));
  };

  const handleSave = async () => {
    if (!profile) return;
    if (!form.product_name.trim()) {
      Alert.alert('Missing name', 'Please enter a product name.');
      return;
    }
    setLoading(true);
    setUpgrade(null);
    try {
      await inventoryService.createInventoryItem({
        user_id: profile.id,
        product_name: form.product_name.trim(),
        brand: form.brand || null,
        category: form.category,
        quantity: parseFloat(form.quantity) || 1,
        unit: form.unit,
        expiration_date: form.expiration_date || null,
        expiration_alert_days: alertDays,
        purchase_date: form.purchase_date || null,
        price: form.price ? parseFloat(form.price) : null,
        barcode: form.barcode || null,
        notes: form.notes || null,
        image_url: form.image_url || null,
        storage_area_id: storageAreaId,
      });
      Alert.alert('Saved', 'Item added to your inventory.', [
        { text: 'OK', onPress: () => (router.canGoBack() ? router.back() : router.replace('/inventory')) },
      ]);
    } catch (error: any) {
      // A plan limit comes back as an error code; show it as an upgrade prompt
      // rather than a raw message the user cannot act on.
      const gate = describeEntitlementError(error);
      if (gate) setUpgrade(gate);
      else Alert.alert('Error', error?.message ?? 'Unable to save item.');
    } finally {
      setLoading(false);
    }
  };

  const atProductLimit = !gates.addProduct.allowed;

  return (
    <View style={styles.container}>
      <NavHeader title={editing ? 'Review & Save' : 'Add Item'} subtitle={editing ? 'Details from your scan' : 'Manual entry'} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        {/* Shown before the form rather than after a failed save: the user
            should not fill in nine fields to be told the plan is full. */}
        {(upgrade ?? (atProductLimit ? gates.addProduct : null)) && (
          <UpgradeNotice
            title={(upgrade ?? gates.addProduct).title}
            message={(upgrade ?? gates.addProduct).message}
            onPress={() => router.push('/subscription')}
            onDismiss={upgrade ? () => setUpgrade(null) : undefined}
            style={{ marginBottom: SPACING.md }}
          />
        )}

        <Field
          label="Food Name *"
          icon={Tag}
          value={form.product_name}
          onChangeText={(t) => setForm({ ...form, product_name: t })}
          placeholder="e.g. Fresh Milk"
          autoFocus={!editing}
        />

        <Text style={styles.label}>Category</Text>
        <View style={styles.chipWrap}>
          {CATEGORY_KEYS.map((key) => {
            const Icon = categoryIcon(key);
            const active = form.category === key;
            return (
              <Pressable
                key={key}
                style={[styles.chip, styles.categoryChip, active && styles.chipActive]}
                onPress={() => setForm({ ...form, category: key })}
              >
                <Icon size={14} color={active ? COLORS.white : COLORS.secondaryText} strokeWidth={2.2} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{CATEGORY_LABELS[key]}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field
          label="Brand"
          value={form.brand}
          onChangeText={(t) => setForm({ ...form, brand: t })}
          placeholder="Optional"
        />

        <View style={styles.splitRow}>
          <Field
            label="Quantity"
            containerStyle={{ flex: 1 }}
            value={form.quantity}
            onChangeText={(t) => setForm({ ...form, quantity: t })}
            keyboardType="numeric"
          />
          <Field
            label="Unit"
            containerStyle={{ flex: 1 }}
            value={form.unit}
            onChangeText={(t) => setForm({ ...form, unit: t })}
          />
        </View>

        <View style={styles.unitWrap}>
          {UNITS.map((u) => (
            <Pressable key={u} style={[styles.unitChip, form.unit === u && styles.chipActive]} onPress={() => setForm({ ...form, unit: u })}>
              <Text style={[styles.unitChipText, form.unit === u && styles.chipTextActive]}>{u}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Expiration Date</Text>
        <View style={styles.dateBox}>
          <CalendarDays size={18} color={COLORS.secondaryText} strokeWidth={2} />
          <Text style={form.expiration_date ? styles.dateText : styles.datePlaceholder}>
            {form.expiration_date
              ? new Date(form.expiration_date + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
              : 'No expiration date set'}
          </Text>
        </View>
        <View style={styles.dateChips}>
          {[{ label: 'Today', d: 0 }, { label: '+3 days', d: 3 }, { label: '+1 week', d: 7 }, { label: '+2 weeks', d: 14 }, { label: 'Clear', d: -9999 }].map((o) => (
            <Pressable
              key={o.label}
              style={[styles.chip, o.d === -9999 ? styles.chipGhost : styles.chip]}
              onPress={() => setExpiry(o.d)}
            >
              <Text style={[styles.chipText, o.d === -9999 && { color: COLORS.danger }]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Alert timing only means something once there is a date to count back
            from, so it appears with the date rather than sitting there inert. */}
        {!!form.expiration_date && (
          <>
            <View style={styles.labelRow}>
              <Bell size={14} color={COLORS.text} strokeWidth={2.2} />
              <Text style={styles.labelInline}>Alert me</Text>
            </View>
            <View style={styles.chipWrap}>
              {EXPIRATION_ALERT_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.chip, alertDays === option.value && styles.chipActive]}
                  onPress={() => setAlertDays(option.value)}
                >
                  <Text style={[styles.chipText, alertDays === option.value && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {areas.length > 0 && (
          <>
            <View style={styles.labelRow}>
              <Boxes size={14} color={COLORS.text} strokeWidth={2.2} />
              <Text style={styles.labelInline}>Storage area</Text>
            </View>
            <View style={styles.chipWrap}>
              {areas.map((area) => (
                <Pressable
                  key={area.id}
                  style={[styles.chip, storageAreaId === area.id && styles.chipActive]}
                  onPress={() => setStorageAreaId(area.id)}
                >
                  <Text style={[styles.chipText, storageAreaId === area.id && styles.chipTextActive]}>
                    {storageEmoji(area)} {area.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Field
          label="Price (₱)"
          value={form.price}
          onChangeText={(t) => setForm({ ...form, price: t })}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Field
          label="Notes"
          value={form.notes}
          onChangeText={(t) => setForm({ ...form, notes: t })}
          placeholder="Storage tip, reminders, etc."
          multiline
        />
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.md }]}>
        <PillButton
          title={editing ? 'Save to Inventory' : 'Add to Inventory'}
          icon={editing ? PencilLine : PackagePlus}
          onPress={handleSave}
          loading={loading}
          disabled={atProductLimit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6, marginTop: SPACING.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, marginTop: SPACING.xs },
  labelInline: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
  },
  chipGhost: { backgroundColor: 'transparent' },
  categoryChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.secondaryText },
  chipTextActive: { color: COLORS.white },
  splitRow: { flexDirection: 'row', gap: SPACING.md },
  unitWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  unitChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADII.pill,
    backgroundColor: COLORS.mutedBg, borderWidth: 1, borderColor: 'transparent',
  },
  unitChipText: { fontSize: 13, fontWeight: '600', color: COLORS.secondaryText },
  dateBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
    borderRadius: RADII.input, paddingHorizontal: 14, minHeight: 50, marginBottom: SPACING.sm,
  },
  dateText: { fontSize: 15, color: COLORS.text, fontWeight: '500' },
  datePlaceholder: { fontSize: 15, color: COLORS.secondaryText },
  dateChips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.lg },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.white, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
});
