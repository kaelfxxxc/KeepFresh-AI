// Barcode / QR scanner inside the Grocery List.
//
// Scanning a product here answers one question — "what am I buying?" — so the
// sheet that comes back is the smallest thing that closes the loop: a name, a
// category, a quantity, a rough price, and one button that puts it on the list.
//
// A lookup against the product database is charged to the plan's AI scan
// allowance server-side (see the barcode-lookup function), so the allowance is
// checked before the camera opens and a spent allowance shows the upgrade
// prompt rather than a barcode that would only come back refused. Everything
// that costs nothing — typing an item in, or reading a QR code that turns out
// to hold text rather than a product number — keeps working with no allowance
// at all, so the grocery list is never blocked behind a plan.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  StatusBar,
  Image,
  Linking,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera/legacy';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ScanBarcode,
  X,
  PenLine,
  Sparkles,
  Check,
  Package,
  Minus,
  Plus,
  QrCode,
} from 'lucide-react-native';
import { supabase } from '../../src/lib/supabase';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { COLORS, RADII, SPACING } from '../../src/theme';
import { PillButton, Field } from '../../src/components/ui';
import {
  lookupBarcode,
  mapBarcodeCategory,
  guessUnit,
  type BarcodeProduct,
} from '../../src/services/barcodeService';
import type { GroceryItem } from '../../src/types';
import { CATEGORY_KEYS, CATEGORY_LABELS, categoryIcon } from '../../src/utils/categoryIcons';

/** What the review sheet edits before the item lands on the list. */
interface Draft {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  price: string;
  barcode: string | null;
  imageUrl?: string;
  brand?: string;
  size?: string;
}

const isProductBarcode = (data: string) => /^\d{6,14}$/.test(data.trim());

export default function GroceryScanScreen() {
  const insets = useSafeAreaInsets();
  const { listId, listName } = useLocalSearchParams<{ listId?: string; listName?: string }>();
  const { entitlements, gates, refresh } = useSubscription();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const scanningEnabled = gates.aiScan.allowed;

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Mount the camera only while focused, and re-arm the scanner on return —
  // same reasoning as the inventory scanner: a legacy preview surface that
  // stayed mounted behind a pushed screen can come back black.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      setScanned(false);
      setLoading(false);
      return () => setIsFocused(false);
    }, [])
  );

  const promptScanLimit = () => {
    Alert.alert(gates.aiScan.title, gates.aiScan.message, [
      { text: 'Type it instead', style: 'cancel', onPress: () => openManual('', null) },
      { text: 'See plans', onPress: () => router.push('/subscription') },
    ]);
  };

  const openManual = (name: string, barcode: string | null) => {
    setDraft({
      name,
      category: 'other',
      quantity: 1,
      unit: 'pcs',
      price: '',
      barcode,
    });
  };

  const openFromProduct = (product: BarcodeProduct) => {
    setDraft({
      name: product.title || '',
      category: mapBarcodeCategory(product.category),
      quantity: 1,
      unit: guessUnit(product.size),
      price: '',
      barcode: product.barcode,
      imageUrl: product.image_url || undefined,
      brand: product.brand || product.manufacturer || undefined,
      size: product.size || undefined,
    });
  };

  const handleScanned = async ({ data }: { data: string }) => {
    setScanned(true);

    // A QR code usually holds text or a link, not a product number. Rather than
    // spend a lookup on it, offer what was actually read.
    if (!isProductBarcode(data)) {
      const text = data.trim();
      Alert.alert(
        'QR code read',
        text.length > 0 && text.length <= 80
          ? `This code contains:\n\n${text}\n\nAdd it to your list as an item?`
          : 'This code does not contain a product barcode. Would you like to type the item in?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
          {
            text: text.length > 0 && text.length <= 80 ? 'Add it' : 'Type it in',
            onPress: () =>
              text.length > 0 && text.length <= 80 ? openManual(text, null) : openManual('', null),
          },
        ]
      );
      return;
    }

    setLoading(true);
    try {
      const result = await lookupBarcode(data);

      if (result.status === 'found' || result.status === 'not_found') refresh();

      if (result.status === 'found') {
        openFromProduct(result.product);
      } else if (result.status === 'limit_reached') {
        promptScanLimit();
      } else if (result.status === 'unavailable') {
        Alert.alert(
          'Product database unavailable',
          'We couldn’t reach the product database. You can still add this item by typing its name.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
            { text: 'Type it in', onPress: () => openManual('', data) },
          ]
        );
      } else {
        Alert.alert('Not in the product database', 'No match for this barcode. Add it by typing its name.', [
          { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
          { text: 'Type it in', onPress: () => openManual('', data) },
        ]);
      }
    } catch {
      Alert.alert('Something went wrong', 'We couldn’t read that barcode. Please try again.', [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const closeDraft = () => {
    setDraft(null);
    setScanned(false);
  };

  /** Put the reviewed item on the list, avoiding a silent duplicate. */
  const saveDraft = async () => {
    if (!draft || !listId) return;
    const name = draft.name.trim();
    if (!name) {
      Alert.alert('Name needed', 'Give the item a name so it can go on your list.');
      return;
    }

    const quantity = Math.max(Math.round(draft.quantity), 1);
    const price = draft.price.trim() ? Number(draft.price.replace(',', '.')) : null;

    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('grocery_items')
        .select('*')
        .eq('grocery_list_id', listId)
        .ilike('name', name);

      const match = (existing ?? []).find(
        (row: GroceryItem) => row.name.trim().toLowerCase() === name.toLowerCase()
      );

      // Already on the list: raising the quantity is almost always what was
      // meant, so it is offered first rather than adding a second line.
      if (match) {
        setSaving(false);
        Alert.alert(
          'Already on your list',
          `"${match.name}" is on this list with ${match.quantity} ${match.unit || 'pcs'}. What would you like to do?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Add another line', onPress: () => insertItem(name, quantity, price) },
            { text: `Make it ${match.quantity + quantity}`, onPress: () => bumpItem(match, quantity) },
          ]
        );
        return;
      }

      await insertItem(name, quantity, price);
    } catch (e) {
      setSaving(false);
      Alert.alert('Could not add to your list', (e as Error)?.message ?? 'Please try again.');
    }
  };

  const insertItem = async (name: string, quantity: number, price: number | null) => {
    if (!draft || !listId) return;
    setSaving(true);
    const { error } = await supabase.from('grocery_items').insert({
      grocery_list_id: listId,
      name,
      // The canonical key, not its label: the key is what the icon resolver and
      // the category filter read, and the list screen renders the label.
      category: draft.category || 'other',
      quantity,
      unit: draft.unit || 'pcs',
      estimated_price: price,
      purchased: false,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Could not add to your list', error.message);
      return;
    }
    router.back();
  };

  const bumpItem = async (item: GroceryItem, quantity: number) => {
    setSaving(true);
    const { error } = await supabase
      .from('grocery_items')
      .update({ quantity: item.quantity + quantity })
      .eq('id', item.id);
    setSaving(false);

    if (error) {
      Alert.alert('Could not update the list', error.message);
      return;
    }
    router.back();
  };

  /* ------------------------------------------------------------------ states */

  const gateState = (
    <View style={styles.centerState}>
      <ScanBarcode size={44} color={COLORS.secondaryText} strokeWidth={1.5} />
      <Text style={styles.stateTitle}>{gates.aiScan.title}</Text>
      <Text style={styles.stateText}>{gates.aiScan.message}</Text>
      <Pressable style={styles.primaryBtn} onPress={() => router.push('/subscription')}>
        <Sparkles size={16} color={COLORS.white} strokeWidth={2.2} />
        <Text style={styles.primaryBtnText}>See plans</Text>
      </Pressable>
      <Pressable style={styles.textBtn} onPress={() => openManual('', null)} hitSlop={8}>
        <Text style={styles.textBtnLabel}>Type an item in instead</Text>
      </Pressable>
    </View>
  );

  const deniedState = (
    <View style={styles.centerState}>
      <ScanBarcode size={44} color={COLORS.secondaryText} strokeWidth={1.5} />
      <Text style={styles.stateTitle}>Camera access needed</Text>
      <Text style={styles.stateText}>
        To scan a product, allow camera access for KeepFresh AI in your device settings. You can
        always add items by typing them.
      </Text>
      <Pressable style={styles.primaryBtn} onPress={() => Linking.openSettings()}>
        <Text style={styles.primaryBtnText}>Open Settings</Text>
      </Pressable>
      <Pressable style={styles.textBtn} onPress={() => openManual('', null)} hitSlop={8}>
        <Text style={styles.textBtnLabel}>Type an item in instead</Text>
      </Pressable>
    </View>
  );

  const loadingState = (
    <View style={styles.centerState}>
      <ActivityIndicator color={COLORS.primary} />
      <Text style={styles.stateText}>Requesting camera permission…</Text>
    </View>
  );

  const cameraState = (
    <View style={styles.cameraWrap}>
      {isFocused && !draft && (
        <Camera
          style={styles.camera}
          type={CameraType.back}
          onBarCodeScanned={scanned ? undefined : handleScanned}
          barCodeScannerSettings={{
            // Barcodes for products, QR for whatever a shelf label carries.
            barCodeTypes: ['ean13', 'ean8', 'upc-a', 'upc-e', 'code39', 'code93', 'code128', 'qr'],
          }}
        />
      )}
      {!draft && (
        <>
          <View style={styles.cornerFrame} pointerEvents="none">
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <View style={[styles.topHint, { top: insets.top + 10 }]} pointerEvents="none">
            <Text style={styles.hintText}>Point at a barcode or QR code</Text>
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {!listId ? (
        <View style={styles.centerState}>
          <ScanBarcode size={44} color={COLORS.secondaryText} strokeWidth={1.5} />
          <Text style={styles.stateTitle}>No list selected</Text>
          <Text style={styles.stateText}>
            Open the grocery list you want to add to, then start the scanner from there.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back to my lists</Text>
          </Pressable>
        </View>
      ) : !scanningEnabled ? (
        gateState
      ) : hasPermission === null ? (
        loadingState
      ) : hasPermission === false ? (
        deniedState
      ) : (
        cameraState
      )}

      {/* Close / cancel */}
      {(hasPermission || draft) && (
        <Pressable
          style={[styles.closeBtn, { top: insets.top + 10 }]}
          onPress={() => (draft ? closeDraft() : router.back())}
          hitSlop={10}
        >
          <X size={22} color={COLORS.white} strokeWidth={2.4} />
        </Pressable>
      )}

      {loading && (
        <View style={[styles.loadingPill, { top: insets.top + 16 }]}>
          <ActivityIndicator color={COLORS.white} size="small" />
          <Text style={styles.loadingText}>Looking up…</Text>
        </View>
      )}

      {/* Bottom sheet — the scanner's controls, or the product being reviewed */}
      {draft ? (
        <ReviewSheet
          draft={draft}
          onChange={setDraft}
          listName={listName}
          saving={saving}
          onSave={saveDraft}
          onCancel={closeDraft}
          insetsBottom={insets.bottom}
        />
      ) : (
        hasPermission &&
        scanningEnabled &&
        !!listId && (
          <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + SPACING.md }]}>
            <QrCode size={26} color={COLORS.primary} strokeWidth={2} />
            <Text style={styles.sheetTitle}>Scan into your list</Text>
            <Text style={styles.sheetSubtitle}>
              {listName ? `Adding to “${listName}”.` : 'Adding to your grocery list.'} Scan a
              product barcode, or a QR code.
            </Text>
            {!!entitlements && (
              <Text style={styles.quota}>
                {entitlements.ai_scans_used} / {entitlements.max_ai_scans} AI scans used this month
              </Text>
            )}
            <View style={styles.actionRow}>
              <Pressable style={[styles.modeBtn, styles.modePrimary]} onPress={() => openManual('', null)}>
                <PenLine size={17} color={COLORS.white} strokeWidth={2.2} />
                <Text style={styles.modePrimaryText}>Type it in</Text>
              </Pressable>
              <Pressable style={styles.modeBtn} onPress={() => setScanned(false)}>
                <ScanBarcode size={17} color={COLORS.primary} strokeWidth={2.2} />
                <Text style={styles.modeText}>Scan again</Text>
              </Pressable>
            </View>
          </View>
        )
      )}
    </View>
  );
}

/* ----------------------------------------------------------- review sheet */

function ReviewSheet({
  draft,
  onChange,
  listName,
  saving,
  onSave,
  onCancel,
  insetsBottom,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  listName?: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  insetsBottom: number;
}) {
  const step = (delta: number) =>
    onChange({ ...draft, quantity: Math.max(draft.quantity + delta, 1) });

  const categories = CATEGORY_KEYS;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.reviewSheet, { paddingBottom: insetsBottom + SPACING.md }]}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.productHead}>
            <View style={styles.productThumb}>
              {draft.imageUrl ? (
                <Image source={{ uri: draft.imageUrl }} style={styles.thumbImage} resizeMode="contain" />
              ) : (
                <Package size={24} color={COLORS.primary} strokeWidth={1.8} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.productTitle} numberOfLines={2}>
                {draft.name || 'New item'}
              </Text>
              <Text style={styles.productMeta} numberOfLines={2}>
                {[draft.brand, draft.size].filter(Boolean).join(' · ') ||
                  (draft.barcode ? `Barcode ${draft.barcode}` : 'Entered by hand')}
              </Text>
              {listName ? <Text style={styles.productList}>Adding to “{listName}”</Text> : null}
            </View>
          </View>

          <Field
            label="Item name"
            value={draft.name}
            onChangeText={(name) => onChange({ ...draft, name })}
            placeholder="e.g. Fresh Milk 1L"
            editable={!saving}
          />

          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Quantity</Text>
            <View style={styles.stepper}>
              <Pressable
                style={[styles.stepBtn, draft.quantity <= 1 && styles.stepBtnOff]}
                onPress={() => step(-1)}
                disabled={saving || draft.quantity <= 1}
                hitSlop={6}
              >
                <Minus size={16} color={draft.quantity <= 1 ? COLORS.secondaryText : COLORS.primary} strokeWidth={2.6} />
              </Pressable>
              <Text style={styles.qtyValue}>{draft.quantity}</Text>
              <Pressable style={styles.stepBtn} onPress={() => step(1)} disabled={saving} hitSlop={6}>
                <Plus size={16} color={COLORS.primary} strokeWidth={2.6} />
              </Pressable>
              <Text style={styles.qtyUnit}>{draft.unit}</Text>
            </View>
          </View>

          <Field
            label="Estimated price (₱, optional)"
            value={draft.price}
            onChangeText={(price) => onChange({ ...draft, price })}
            placeholder="0.00"
            keyboardType="decimal-pad"
            editable={!saving}
          />

          <Text style={styles.pickLabel}>Category</Text>
          <View style={styles.chipWrap}>
            {categories.map((key) => {
              const Icon = categoryIcon(key);
              const active = draft.category === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => onChange({ ...draft, category: key })}
                  disabled={saving}
                  style={[styles.chip, styles.categoryChip, active && styles.chipActive]}
                >
                  <Icon size={14} color={active ? COLORS.white : COLORS.secondaryText} strokeWidth={2.2} />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {CATEGORY_LABELS[key]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.sheetActions}>
          <PillButton title="Cancel" variant="outline" onPress={onCancel} disabled={saving} style={{ flex: 1 }} />
          <PillButton
            title="Add to list"
            icon={Check}
            onPress={onSave}
            loading={saving}
            disabled={!draft.name.trim()}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const CORNER = 30;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  centerState: {
    flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.xl, gap: 8,
  },
  stateTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginTop: SPACING.sm, textAlign: 'center' },
  stateText: { fontSize: 14, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 20 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primary,
    borderRadius: RADII.pill, paddingHorizontal: SPACING.lg, paddingVertical: 12, marginTop: SPACING.md,
  },
  primaryBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
  textBtn: { paddingVertical: SPACING.sm },
  textBtnLabel: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },

  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  cornerFrame: {
    position: 'absolute', left: 0, right: 0, top: '22%', bottom: '38%',
    alignItems: 'center', justifyContent: 'center',
  },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: COLORS.scanCorner },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
  topHint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintText: {
    color: COLORS.white, fontSize: 13, fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 50, overflow: 'hidden',
  },

  closeBtn: {
    position: 'absolute', right: SPACING.lg, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  loadingPill: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingVertical: 9, borderRadius: RADII.pill,
  },
  loadingText: { color: COLORS.white, fontSize: 13, fontWeight: '600' },

  bottomSheet: {
    backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, alignItems: 'center',
    marginTop: 'auto',
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginTop: SPACING.sm },
  sheetSubtitle: { fontSize: 13, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  quota: { fontSize: 11.5, color: COLORS.secondaryText, marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: SPACING.sm, alignSelf: 'stretch', marginTop: SPACING.md },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: 50, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.white,
  },
  modePrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modeText: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },
  modePrimaryText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },

  reviewSheet: {
    backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, marginTop: 'auto', maxHeight: '78%',
  },
  productHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SPACING.md },
  productThumb: {
    width: 56, height: 56, borderRadius: RADII.icon, backgroundColor: COLORS.primaryLight,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImage: { width: 48, height: 48 },
  productTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  productMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  productList: { fontSize: 11.5, color: COLORS.primary, fontWeight: '600', marginTop: 3 },

  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.sm },
  qtyLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { backgroundColor: COLORS.mutedBg },
  qtyValue: { fontSize: 16, fontWeight: '800', color: COLORS.text, minWidth: 24, textAlign: 'center' },
  qtyUnit: { fontSize: 13, color: COLORS.secondaryText },

  pickLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginTop: SPACING.md },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADII.pill,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  categoryChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 12.5, fontWeight: '600', color: COLORS.secondaryText },
  chipTextActive: { color: COLORS.white },

  sheetActions: { flexDirection: 'row', gap: SPACING.sm, paddingTop: SPACING.md },
});
