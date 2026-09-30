import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Image } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { Sparkles, ScanBarcode, PencilLine, PackagePlus } from 'lucide-react-native';
import { NavHeader, PillButton, StatusBadge, IconBadge, colorWithOpacity } from '../../src/components/ui';
import { categoryIcon, categoryLabel } from '../../src/utils/categoryIcons';
import { directImageUri, isLocalFileUri, resolveItemImageUri, uploadItemImage } from '../../src/services/inventoryImageService';
import type { ReviewInfo } from '../../src/services/barcodeService';
import { usePageGutter } from '../../src/hooks/useContentLayout';
import { errorMessage } from '../../src/utils/errors';

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

/**
 * The photo to write onto the row, or null when there is nothing worth storing.
 *
 * A photo scan carries the picked file's own `file://` path — a location on this
 * one device, and one the picker's cache is free to clear. Those are uploaded to
 * the `inventory-images` bucket first, which is what turns the picture the user
 * just took into something the rest of the household can see and what keeps it
 * from vanishing afterwards; the row then holds the bucket path, which is signed
 * on the way to the screen.
 *
 * Anything else is carried over as it stands, because it came out of the column
 * itself: an https URL from a barcode provider, or a path in our own bucket.
 * Passing those through unchanged is what stops "Add Another" from dropping the
 * photo the original item was added with.
 *
 * Throws when an upload fails, rather than falling back to null: saving the item
 * photo-less and saying nothing would leave the user believing the photo was
 * kept. The caller turns that into a message and abandons the save.
 */
async function resolvableImageUrl(userId: string, url?: string | null): Promise<string | null> {
  if (!url) return null;
  if (!isLocalFileUri(url)) return url;
  try {
    return await uploadItemImage(userId, url);
  } catch {
    throw new Error('The photo could not be uploaded. Check your connection and try again — nothing was saved.');
  }
}

const row = (label: string, value: string) => (
  <View style={styles.attrRow}>
    <Text style={styles.attrLabel}>{label}</Text>
    <Text style={styles.attrValue} numberOfLines={1}>{value}</Text>
  </View>
);

export default function ProductInfoScreen() {
  // The photo hero stays full-bleed; the detail cards, the notes and the pinned
  // action bar centre together below it.
  const { gutter } = usePageGutter();
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
      // Uploaded before the insert so the row lands with its final value, rather
      // than briefly pointing at a file only this device can see.
      const imageUrl = await resolvableImageUrl(profile.id, info.image_url);
      const { error } = await supabase.from('inventory_items').insert({
        user_id: profile.id,
        product_name: info.product_name.trim(),
        brand: info.brand || null,
        category: info.category || null,
        expiration_date: info.expiration_date || null,
        quantity: Number(info.quantity) || 1,
        unit: info.unit || 'pcs',
        barcode: info.barcode || params.barcode || null,
        image_url: imageUrl,
        notes,
      });
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert('Added to inventory', `"${info.product_name}" is now in your inventory.`, [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error: unknown) {
      // A failed upload carries its own message; anything else is the generic
      // one, since the specific cause here is not something the user can act on.
      Alert.alert('Error', errorMessage(error, 'Unable to add item to inventory.'));
    } finally {
      setLoading(false);
    }
  };

  // What the hero falls back to when there is no photo to show — the category's
  // own icon rather than a generic box.
  const HeroIcon = categoryIcon(info.category);

  // The hero can be handed a stored value rather than something immediately
  // renderable: "Add Another" reuses the item's own row, whose photo is a path
  // inside the private bucket. That has to be signed first, exactly like every
  // other stored photo in the app. A photo scan's local file and a barcode
  // lookup's remote URL both render as they stand, and are answered without a
  // promise so they never flash the fallback icon while one resolves.
  const [heroUri, setHeroUri] = useState<string | null>(null);
  const immediateHero = directImageUri(info.image_url);

  useEffect(() => {
    setHeroUri(null);
    if (!info.image_url || immediateHero) return undefined;
    let live = true;
    resolveItemImageUri(info.image_url).then((next) => {
      if (live) setHeroUri(next);
    });
    return () => { live = false; };
  }, [info.image_url, immediateHero]);

  const heroSource = immediateHero ?? heroUri;
  const showImage = !!heroSource && !imgBroken;
  const autoFilled = source === 'lookup' || source === 'inventory';
  const hasDetails = !!(info.description || info.ingredients);

  return (
    <View style={styles.container}>
      <NavHeader title="Product Information" />
      <ScrollView contentContainerStyle={{ paddingBottom: 150 }}>
        {/* Photo / product-image hero */}
        <View style={[styles.hero, { marginHorizontal: gutter }]}>
          {showImage ? (
            <Image
              source={{ uri: heroSource as string }}
              style={styles.heroImage}
              resizeMode="contain"
              onError={() => setImgBroken(true)}
            />
          ) : (
            <IconBadge color={colors.primary} size={104}>
              <HeroIcon size={48} color={colors.primary} strokeWidth={1.5} />
            </IconBadge>
          )}
          <View style={styles.aiBadge}>
            {source === 'photo' ? (
              <Sparkles size={12} color={colors.primaryDark} strokeWidth={2.4} />
            ) : (
              <ScanBarcode size={12} color={colors.primaryDark} strokeWidth={2.4} />
            )}
            <Text style={styles.aiBadgeText}>
              {source === 'photo' ? 'AI VERIFIED' : autoFilled ? 'BARCODE RESULT' : 'PRODUCT INFO'}
            </Text>
          </View>
        </View>

        <View style={[styles.card, { marginHorizontal: gutter }]}>
          <Text style={styles.itemName}>{info.product_name || 'Unidentified product'}</Text>
          {row('Brand', info.brand || '—')}
          {row('Category', info.category ? categoryLabel(info.category) : '—')}
          {row('Expiration Date', info.expiration_date ? new Date(info.expiration_date).toLocaleDateString() : 'Not set')}
          {row('Quantity', `${info.quantity} ${info.unit || 'pcs'}`)}
          {row('Barcode', info.barcode || params.barcode || '—')}
        </View>

        {/* Extra detail from the product database — read-only, informative */}
        {hasDetails && (
          <View style={[styles.card, { marginHorizontal: gutter }]}>
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
          <View style={[styles.infoNote, { marginHorizontal: gutter }]}>
            <StatusBadge label={source === 'photo' ? 'Detected from photo' : 'No product data'} tone="warning" />
            <Text style={styles.infoNoteText}>
              Nothing could be pre-filled. Tap Edit Information to enter the product details yourself.
            </Text>
          </View>
        ) : autoFilled ? (
          <View style={[styles.infoNote, { marginHorizontal: gutter }]}>
            <StatusBadge label="Auto-filled" tone="warning" />
            <Text style={styles.infoNoteText}>
              Details were looked up from the product database. Review them below and tap Edit Information to correct
              anything wrong before saving.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.md }]}>
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
  container: { flex: 1, backgroundColor: colors.screenBg },
  hero: {
    height: 210, marginVertical: spacing.xl, marginBottom: 0, borderRadius: radii.lg,
    backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  heroImage: { width: '100%', height: '100%' },
  aiBadge: {
    position: 'absolute', top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colorWithOpacity(colors.surface, 0.92), paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill,
  },
  aiBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primaryDark, letterSpacing: 0.6 },
  card: {
    marginVertical: spacing.xl, backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  itemName: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.sm },
  attrRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  attrLabel: { fontSize: 13, color: colors.textSecondary },
  attrValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: spacing.md },
  detailTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
  detailTitleSpaced: { marginTop: spacing.md },
  detailBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  infoNote: { gap: spacing.sm },
  infoNoteText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: spacing.sm,
    backgroundColor: colors.surface, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
});
