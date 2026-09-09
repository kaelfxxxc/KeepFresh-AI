import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../src/lib/supabase';
import { useAuth } from '../../../src/context/AuthContext';
import { COLORS, SPACING, RADII } from '../../../src/theme';
import { Tag, CalendarDays, PackagePlus, PencilLine } from 'lucide-react-native';
import { NavHeader, Field, PillButton } from '../../../src/components/ui';

const CATEGORIES = ['Produce', 'Dairy', 'Meat', 'Seafood', 'Grains', 'Frozen', 'Beverages', 'Snacks', 'Condiments', 'Other'];
const UNITS = ['pcs', 'kg', 'g', 'lb', 'oz', 'L', 'ml', 'cups', 'pack', 'bottle', 'can', 'box'];

export default function AddItemScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<Record<string, string>>();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);

  const prefillCategory = (params.category || '').charAt(0).toUpperCase() + (params.category || '').slice(1);

  const [form, setForm] = useState({
    product_name: params.product_name || '',
    brand: params.brand || '',
    category: CATEGORIES.includes(prefillCategory) ? prefillCategory : 'Other',
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

  const setExpiry = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setForm({ ...form, expiration_date: d.toISOString().split('T')[0] });
  };

  const handleSave = async () => {
    if (!profile) return;
    if (!form.product_name.trim()) {
      Alert.alert('Missing name', 'Please enter a product name.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('inventory_items').insert({
        user_id: profile.id,
        product_name: form.product_name.trim(),
        brand: form.brand || null,
        category: form.category.toLowerCase(),
        quantity: parseFloat(form.quantity) || 1,
        unit: form.unit,
        expiration_date: form.expiration_date || null,
        purchase_date: form.purchase_date || null,
        price: form.price ? parseFloat(form.price) : null,
        barcode: form.barcode || null,
        notes: form.notes || null,
        image_url: form.image_url || null,
      });
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert('Saved', 'Item added to your inventory.', [
          { text: 'OK', onPress: () => (router.canGoBack() ? router.back() : router.replace('/inventory')) },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to save item.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <NavHeader title={editing ? 'Review & Save' : 'Add Item'} subtitle={editing ? 'Details from your scan' : 'Manual entry'} />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
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
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              style={[styles.chip, form.category === cat && styles.chipActive]}
              onPress={() => setForm({ ...form, category: cat })}
            >
              <Text style={[styles.chipText, form.category === cat && styles.chipTextActive]}>{cat}</Text>
            </Pressable>
          ))}
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
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6, marginTop: SPACING.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
  },
  chipGhost: { backgroundColor: 'transparent' },
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
