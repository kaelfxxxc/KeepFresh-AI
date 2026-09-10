import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Image } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { Sparkles, ScanBarcode, PencilLine, PackagePlus } from 'lucide-react-native';
import { NavHeader, PillButton, StatusBadge } from '../../src/components/ui';
import type { ReviewInfo } from '../../src/services/barcodeService';

type ScanSource = 'photo' | 'lookup' | 'inventory';

const EMPTY: ReviewInfo = {
  product_name: '',
  brand: '',
  category: '',
  expiration_date: '',
  quantity: 1,
  unit: 'pcs',
  barcode: '',
  image_url: '',
  description: '',
  ingredients: '',
};

const row = (label: string, value: string) => (
  <View style={styles.attrRow}>
    <Text style={styles.attrLabel}>{label}</Text>
    <Text style={styles.attrValue} numberOfLines={1}>{value}</Text>
  </View>
);

export default function ProductInfoScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ barcode?: string; source?: string; productData?: string }>();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const [info, setInfo] = useState<ReviewInfo>(EMPTY);

  // 'photo' when launched bare from the Take Photo button; otherwise the scan
  // flow hands us 'lookup' (fresh from the database) or 'inventory' (reusing an
  // existing row for "Add Another"). No productData at all = nothing detected.
  const source: ScanSource | undefined = params.source === 'photo'
    ? 'photo'
    : params.productData
      ? params.source === 'inventory' ? 'inventory' : 'lookup'
      : undefined;

  useEffect(() => {
    setImgBroken(false);
    if (params.productData) {
      try {
        const d = JSON.parse(params.productData);
        setInfo({
          product_name: d.product_name || '',
          brand: d.brand || '',
          category: d.category || '',
          expiration_date: d.expiration_date || '',
          quantity: Number(d.quantity) || 1,
          unit: d.unit || 'pcs',
          barcode: d.barcode || params.barcode || '',
          image_url: d.image_url || '',
          description: d.description || '',
          ingredients: d.ingredients || '',
        });
      } catch {
        /* ignore malformed param */
      }
    }
  }, [params.productData, params.barcode]);

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
        barcode: info.barcode || params.barcode || '',
        image_url: info.image_url,
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
      const notes = source === 'photo'
        ? 'AI-detected information. Please verify and edit if needed.'
        : source === 'lookup' || source === 'inventory'
          ? 'Auto-filled from barcode lookup. Please verify and edit if needed.'
          : null;
      const { error } = await supabase.from('inventory_items').insert({
        user_id: profile.id,
        product_name: info.product_name.trim(),
        brand: info.brand || null,
        category: info.category || null,
        expiration_date: info.expiration_date || null,
        quantity: Number(info.quantity) || 1,
        unit: info.unit || 'pcs',
        barcode: info.barcode || params.barcode || null,
        image_url: info.image_url || null,
        notes,
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

  const emoji = info.category === 'dairy' ? '🥛'
    : info.category === 'produce' ? '🥬'
    : info.category === 'meat' ? '🥩'
    : info.category === 'seafood' ? '🍤'
    : info.category === 'beverages' ? '🥤'
    : info.category === 'snacks' ? '🍪'
    : info.category === 'frozen' ? '🧊'
    : '📦';

  const showImage = !!info.image_url && !imgBroken;
  const autoFilled = source === 'lookup' || source === 'inventory';
  const hasDetails = !!(info.description || info.ingredients);

  return (
    <View style={styles.container}>
      <NavHeader title="Product Information" />
      <ScrollView contentContainerStyle={{ paddingBottom: 150 }}>
        {/* Photo / product-image hero */}
        <View style={styles.hero}>
          {showImage ? (
            <Image
              source={{ uri: info.image_url as string }}
              style={styles.heroImage}
              resizeMode="contain"
              onError={() => setImgBroken(true)}
            />
          ) : (
            <Text style={styles.heroEmoji}>{emoji}</Text>
          )}
          <View style={styles.aiBadge}>
            {source === 'photo' ? (
              <Sparkles size={12} color={COLORS.primaryDark} strokeWidth={2.4} />
            ) : (
              <ScanBarcode size={12} color={COLORS.primaryDark} strokeWidth={2.4} />
            )}
            <Text style={styles.aiBadgeText}>
              {source === 'photo' ? 'AI VERIFIED' : autoFilled ? 'BARCODE RESULT' : 'PRODUCT INFO'}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.itemName}>{info.product_name || 'Unidentified product'}</Text>
          {row('Brand', info.brand || '—')}
          {row('Category', info.category ? info.category.charAt(0).toUpperCase() + info.category.slice(1) : '—')}
          {row('Expiration Date', info.expiration_date ? new Date(info.expiration_date).toLocaleDateString() : 'Not set')}
          {row('Quantity', `${info.quantity} ${info.unit || 'pcs'}`)}
          {row('Barcode', info.barcode || params.barcode || '—')}
        </View>

        {/* Extra detail from the product database — read-only, informative */}
        {hasDetails && (
          <View style={styles.card}>
            {!!info.description && (
              <>
                <Text style={styles.detailTitle}>About this product</Text>
                <Text style={styles.detailBody}>{info.description}</Text>
              </>
            )}
            {!!info.ingredients && (
              <>
                <Text style={[styles.detailTitle, info.description ? styles.detailTitleSpaced : undefined]}>
                  Ingredients
                </Text>
                <Text style={styles.detailBody}>{info.ingredients}</Text>
              </>
            )}
          </View>
        )}

        {!info.product_name ? (
          <View style={styles.infoNote}>
            <StatusBadge label={source === 'photo' ? 'Detected from photo' : 'No product data'} tone="warning" />
            <Text style={styles.infoNoteText}>
              Nothing could be pre-filled. Tap Edit Information to enter the product details yourself.
            </Text>
          </View>
        ) : autoFilled ? (
          <View style={styles.infoNote}>
            <StatusBadge label="Auto-filled" tone="warning" />
            <Text style={styles.infoNoteText}>
              Details were looked up from the product database. Review them below and tap Edit Information to correct
              anything wrong before saving.
            </Text>
          </View>
        ) : null}
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
  heroImage: { width: '100%', height: '100%' },
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
  detailTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  detailTitleSpaced: { marginTop: SPACING.md },
  detailBody: { fontSize: 13, color: COLORS.secondaryText, lineHeight: 20 },
  infoNote: { marginHorizontal: SPACING.lg, gap: 8 },
  infoNoteText: { fontSize: 13, color: COLORS.secondaryText, lineHeight: 19 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: SPACING.sm,
    backgroundColor: COLORS.white, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
});
