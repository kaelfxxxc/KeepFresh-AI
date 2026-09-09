import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { Sparkles, PencilLine, PackagePlus } from 'lucide-react-native';
import { NavHeader, PillButton, StatusBadge } from '../../src/components/ui';

const row = (label: string, value: string) => (
  <View style={styles.attrRow}>
    <Text style={styles.attrLabel}>{label}</Text>
    <Text style={styles.attrValue} numberOfLines={1}>{value}</Text>
  </View>
);

export default function ProductInfoScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ barcode?: string; productData?: string }>();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{
    product_name: string; brand: string; category: string;
    expiration_date: string; quantity: number; unit: string;
  }>({ product_name: '', brand: '', category: '', expiration_date: '', quantity: 1, unit: '' });

  useEffect(() => {
    if (params.productData) {
      try {
        const d = JSON.parse(params.productData);
        setInfo({
          product_name: d.product_name || '',
          brand: d.brand || '',
          category: d.category || '',
          expiration_date: d.expiration_date || '',
          quantity: d.quantity || 1,
          unit: d.unit || '',
        });
      } catch {
        /* ignore malformed param */
      }
    }
  }, [params.productData]);

  const openEditor = () => {
    router.push({
      pathname: '/inventory/add',
      params: {
        product_name: info.product_name,
        brand: info.brand,
        category: info.category,
        quantity: String(info.quantity),
        unit: info.unit,
        expiration_date: info.expiration_date,
        barcode: params.barcode || '',
      },
    });
  };

  const handleAdd = async () => {
    if (!profile) return;
    if (!info.product_name.trim()) {
      Alert.alert('Missing name', 'Please add a product name, or tap Edit Information first.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('inventory_items').insert({
        user_id: profile.id,
        product_name: info.product_name.trim(),
        brand: info.brand || null,
        category: info.category || null,
        expiration_date: info.expiration_date || null,
        quantity: Number(info.quantity) || 1,
        unit: info.unit || 'pcs',
        barcode: params.barcode || null,
        notes: 'AI-detected information. Please verify and edit if needed.',
      });
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert('Added to inventory', `"${info.product_name}" is now in your inventory.`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to add item to inventory.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <NavHeader title="Product Information" />
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
        {/* Photo hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>
            {info.category === 'dairy' ? '🥛' : info.category === 'produce' ? '🥬' : info.category === 'meat' ? '🥩' : info.category === 'beverages' ? '🥤' : '📦'}
          </Text>
          <View style={styles.aiBadge}>
            <Sparkles size={12} color={COLORS.primaryDark} strokeWidth={2.4} />
            <Text style={styles.aiBadgeText}>AI VERIFIED</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.itemName}>{info.product_name || 'Unidentified product'}</Text>
          {row('Brand', info.brand || '—')}
          {row('Category', info.category ? info.category.charAt(0).toUpperCase() + info.category.slice(1) : '—')}
          {row('Expiration Date', info.expiration_date ? new Date(info.expiration_date).toLocaleDateString() : 'Not set')}
          {row('Quantity', `${info.quantity} ${info.unit || 'pcs'}`)}
          {row('Barcode', params.barcode || '—')}
        </View>

        {info.brand === '' && info.product_name === '' && (
          <View style={styles.infoNote}>
            <StatusBadge label="Detected from photo" tone="warning" />
            <Text style={styles.infoNoteText}>
              Fields were read from your scan. Tap Edit Information to confirm the details before saving.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.md }]}>
        <PillButton
          title="Edit Information"
          variant="outline"
          icon={PencilLine}
          onPress={openEditor}
          style={{ flex: 1 }}
        />
        <PillButton
          title="Add to Inventory"
          icon={PackagePlus}
          onPress={handleAdd}
          loading={loading}
          style={{ flex: 1.4 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: {
    height: 210, margin: SPACING.lg, marginBottom: 0, borderRadius: RADII.card,
    backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  heroEmoji: { fontSize: 72 },
  aiBadge: {
    position: 'absolute', top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 50,
  },
  aiBadgeText: { fontSize: 11, fontWeight: '800', color: COLORS.primaryDark, letterSpacing: 0.6 },
  card: {
    margin: SPACING.lg, backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  itemName: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: SPACING.sm },
  attrRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  attrLabel: { fontSize: 13, color: COLORS.secondaryText },
  attrValue: { fontSize: 14, color: COLORS.text, fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: SPACING.md },
  infoNote: { marginHorizontal: SPACING.lg, gap: 8 },
  infoNoteText: { fontSize: 13, color: COLORS.secondaryText, lineHeight: 19 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: SPACING.sm,
    backgroundColor: COLORS.white, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
});
