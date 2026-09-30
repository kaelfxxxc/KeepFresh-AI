import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, StatusBar, Animated, Easing, Linking, Modal, Image } from 'react-native';
import { Camera, CameraType } from 'expo-camera/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { InventoryItem } from '../../src/types';
import { lookupBarcode, toReviewProduct, ReviewInfo, BarcodeProduct } from '../../src/services/barcodeService';
import { recognizeFood } from '../../src/services/foodVisionService';
import { ScanBarcode, Images, PenLine, Settings, X, Sparkles } from 'lucide-react-native';
import { IconBadge } from '../../src/components/ui';
import { useContentLayout } from '../../src/hooks/useContentLayout';

/**
 * How a photo is picked. `quality` is the only size lever available —
 * expo-image-manipulator is not installed — and it matters because the picked
 * file is base64-encoded and sent to the vision function, which refuses anything
 * over a few megabytes. `allowsEditing` lets the user crop a cluttered shelf down
 * to the one item, which is also what makes recognition reliable.
 */
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: true,
  quality: 0.5,
};

/**
 * Below this the model is guessing: its own accuracy guidance calls out images
 * under 200px. Refusing here costs nothing, where sending it would spend one of
 * the month's AI scans on a thumbnail.
 */
const MIN_PHOTO_EDGE = 200;

type LookupDisplay =
  | { status: 'loading'; barcode: string }
  | { status: 'success'; barcode: string; product: BarcodeProduct }
  | { status: 'not_found'; barcode: string }
  | { status: 'error'; barcode: string };

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { compact } = useContentLayout();
  const { entitlements, gates, refresh } = useSubscription();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // A lookup is charged to the plan server-side, so the camera is not opened
  // once the monthly allowance is spent — the user gets the upgrade prompt
  // instead of scanning a barcode that would only come back refused. Manual
  // entry stays available, and costs nothing.
  const scanningEnabled = gates.aiScan.allowed;
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupDisplay, setLookupDisplay] = useState<LookupDisplay | null>(null);
  // Tracks whether this screen currently has focus so the <Camera> is only
  // mounted while visible (see useFocusEffect below).
  const [isFocused, setIsFocused] = useState(false);
  // Height of the barcode frame (measured), used to sweep the scan line.
  const [frameH, setFrameH] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const lastScanRef = useRef<{ value: string; timestamp: number } | null>(null);

  const maxTravel = Math.max(frameH - LINE_H - SWEEP_PAD * 2, 0);
  const translateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [SWEEP_PAD, SWEEP_PAD + maxTravel],
  });

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Re-arm the scanner whenever this screen regains focus (e.g. returning from
  // a finished add on /scan/product) so the next barcode can be scanned.
  //
  // We also mount the <Camera> only while this screen is focused: the legacy
  // expo-camera preview can come back all-black on some devices when a screen
  // pushed on top of the scanner (like /scan/product) is later popped, because
  // the native preview surface is lost while the Camera stayed mounted. Tearing
  // it down on blur and remounting fresh on focus avoids that entirely.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      setScanned(false);
      setLoading(false);
      setLookupDisplay(null);
      lastScanRef.current = null;
      return () => setIsFocused(false);
    }, [])
  );

  // Sweep the scan line up and down the frame while the camera is actively
  // scanning; freeze it once a code is locked in or a lookup is running.
  useEffect(() => {
    if (!(isFocused && scanningEnabled && hasPermission && !scanned && !loading) || frameH <= LINE_H + SWEEP_PAD * 2) {
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 2300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 2300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isFocused, scanningEnabled, hasPermission, scanned, loading, frameH, sweep]);

  const openReview = (review: ReviewInfo, source: 'lookup' | 'inventory' | 'photo') => {
    router.push({
      pathname: '/scan/product',
      params: { barcode: review.barcode, source, productData: JSON.stringify(review) },
    });
  };

  // Reuse an existing inventory row's identity fields when the user picks
  // "Add Another", but reset the per-instance fields (quantity, expiry, price).
  const fromExisting = (existing: InventoryItem, barcode: string): ReviewInfo => ({
    product_name: existing.product_name,
    brand: existing.brand || '',
    category: existing.category || 'other',
    expiration_date: '',
    quantity: 1,
    unit: existing.unit || 'pcs',
    barcode,
    image_url: existing.image_url || '',
    description: existing.notes || '',
    ingredients: '',
  });

  const offerManualEntry = (barcode: string, message: string, title = 'Product Not Found') => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
      {
        text: 'Enter Manually',
        onPress: () => router.push({ pathname: '/inventory/add', params: { barcode } }),
      },
    ]);
  };

  const promptScanLimit = () => {
    Alert.alert(gates.aiScan.title, gates.aiScan.message, [
      { text: 'Not now', style: 'cancel', onPress: () => setScanned(false) },
      { text: 'See plans', onPress: () => { setScanned(false); router.push('/subscription'); } },
    ]);
  };

  const promptPhotoPermission = (which: 'camera' | 'library') => {
    const what = which === 'camera' ? 'Camera' : 'Photo library';
    Alert.alert(
      `${what} access needed`,
      which === 'camera'
        ? 'Allow camera access to photograph an item, or upload a picture of it instead.'
        : 'Allow photo library access to pick a picture of your item, or photograph it instead.',
      [
        { text: 'Not now', style: 'cancel' },
        // Nothing in the app can re-grant a denied permission; the settings app
        // is the only place that can, so send the user there.
        { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
      ],
    );
  };

  /**
   * Pick a photo and identify what is in it.
   *
   * Both photo buttons land here and differ only in where the image comes from.
   * The result is run through exactly the same branches as a barcode lookup,
   * because `recognizeFood` answers in the same shape `lookupBarcode` does —
   * so a photo that identifies food opens the same review screen, and a photo
   * that does not falls back to the same manual-entry prompt.
   */
  const pickAndRecognize = async (from: 'camera' | 'library') => {
    if (loading) return;

    // A photo is metered against the same allowance a barcode scan is, so a
    // spent quota is refused before the picker opens rather than after.
    if (!scanningEnabled) {
      promptScanLimit();
      return;
    }

    try {
      if (from === 'library') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          promptPhotoPermission('library');
          return;
        }
      } else {
        // Taking a photo uses the same camera permission the barcode scanner
        // already holds, so this normally resolves without a prompt.
        const { status } = await Camera.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          setHasPermission(false);
          promptPhotoPermission('camera');
          return;
        }
        setHasPermission(true);
      }

      const picked = from === 'camera'
        ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);

      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];

      if (Math.min(asset.width || 0, asset.height || 0) < MIN_PHOTO_EDGE) {
        Alert.alert(
          'Photo Too Small',
          'That image is too small to identify. Try a closer, higher-resolution photo.'
        );
        return;
      }

      setLoading(true);
      const outcome = await recognizeFood(asset.uri, asset.fileName);

      if (outcome.status === 'found') {
        refresh();
        // The picked photo becomes the review screen's hero image.
        openReview({ ...toReviewProduct(outcome.product), image_url: asset.uri }, 'photo');
      } else if (outcome.status === 'limit_reached') {
        refresh();
        promptScanLimit();
      } else if (outcome.status === 'invalid_image') {
        Alert.alert('Photo Not Usable', outcome.reason);
      } else if (outcome.status === 'unavailable') {
        offerManualEntry(
          '',
          'We couldn’t analyze that photo right now. Would you like to enter the information manually?',
          'Couldn’t Analyze Photo'
        );
      } else {
        offerManualEntry(
          '',
          'We couldn’t identify a food item in that photo. Try a clearer picture, or enter the details manually.',
          'No Food Detected'
        );
      }
    } catch (error) {
      console.error('pickAndRecognize error:', error);
      Alert.alert('Error', 'Something went wrong while reading that photo. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const runLookup = async (barcode: string, fallback?: InventoryItem) => {
    setLoading(true);
    setLookupDisplay({ status: 'loading', barcode });
    const result = await lookupBarcode(barcode);

    // A lookup that reached the product database was charged to the plan, so
    // pull the updated usage back rather than leaving a stale meter on screen.
    if (result.status === 'found' || result.status === 'not_found') refresh();

    if (result.status === 'found') {
      setLookupDisplay({ status: 'success', barcode, product: result.product });
    } else if (result.status === 'limit_reached') {
      setLookupDisplay({ status: 'error', barcode });
      promptScanLimit();
    } else if (result.status === 'unavailable' && fallback) {
      // Server unreachable / function not deployed yet — reuse what we know.
      openReview(fromExisting(fallback, barcode), 'inventory');
    } else if (result.status === 'unavailable') {
      setLookupDisplay({ status: 'error', barcode });
    } else {
      setLookupDisplay({ status: 'not_found', barcode });
    }
    setLoading(false);
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    // The camera stays live while a picked photo is being analyzed, so a code
    // drifting into frame must not hijack the scan already in flight.
    const timestamp = Date.now();
    const previous = lastScanRef.current;
    if (loading || (previous?.value === data && timestamp - previous.timestamp < 2000)) return;
    lastScanRef.current = { value: data, timestamp };
    setScanned(true);
    setLoading(true);
    try {
      // Already in this user's inventory? Ask what to do rather than guessing.
      const { data: existing } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('barcode', data)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        Alert.alert(
          'Already in Inventory',
          `"${existing.product_name}" is already in your inventory. What would you like to do?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
            { text: 'Add Another', onPress: () => runLookup(data, existing) },
            { text: 'View Item', onPress: () => router.push({ pathname: '/inventory/details', params: { id: existing.id } }) },
          ]
        );
        return;
      }

      await runLookup(data);
    } catch (error) {
      Alert.alert('Error', 'Unable to search for this product. Please try again.');
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const permissionBody = () => {
    if (!scanningEnabled) {
      return (
        <View style={styles.centerState}>
          <IconBadge color={colors.primary} size={88}>
            <ScanBarcode size={40} color={colors.primary} strokeWidth={1.8} />
          </IconBadge>
          <Text style={styles.stateTitle}>{gates.aiScan.title}</Text>
          <Text style={styles.stateText}>{gates.aiScan.message}</Text>
          <Pressable style={styles.manualBtn} onPress={() => router.push('/subscription')}>
            <Sparkles size={16} color={colors.surface} strokeWidth={2.2} />
            <Text style={styles.manualText}>See plans</Text>
          </Pressable>
          <Pressable style={styles.textBtn} onPress={() => router.push('/inventory/add')} hitSlop={8}>
            <Text style={styles.textBtnLabel}>Enter a product manually instead</Text>
          </Pressable>
        </View>
      );
    }
    if (hasPermission === null) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.stateText}>Requesting camera permission…</Text>
        </View>
      );
    }
    if (hasPermission === false) {
      return (
        <View style={styles.centerState}>
          <IconBadge color={colors.primary} size={88}>
            <ScanBarcode size={40} color={colors.primary} strokeWidth={1.8} />
          </IconBadge>
          <Text style={styles.stateTitle}>Camera access needed</Text>
          <Text style={styles.stateText}>
            Enable camera permission to scan barcodes and photograph items. You can still upload a photo or add one
            manually.
          </Text>
          <Pressable style={styles.manualBtn} onPress={() => { Linking.openSettings().catch(() => {}); }}>
            <Settings size={16} color={colors.surface} strokeWidth={2.2} />
            <Text style={styles.manualText}>Open Settings</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        {/* Mounted only while this screen is focused: remounting on return
            gives the camera a fresh preview instead of a black screen. */}
        {isFocused && (
          <Camera
            style={styles.camera}
            type={CameraType.back}
            onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
            barCodeScannerSettings={{
              barCodeTypes: ['ean13', 'ean8'],
            }}
          />
        )}

        <View
          style={styles.cornerFrame}
          pointerEvents="none"
          onLayout={(e) => setFrameH(e.nativeEvent.layout.height)}
        >
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
          <Animated.View style={[styles.scanLine, { transform: [{ translateY: translateY }] }]} />
        </View>

        <View style={[styles.topHint, { top: insets.top + 10 }]} pointerEvents="none">
          <Text style={styles.hintText}>Align the barcode within the frame</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {permissionBody()}

      {/* Shown whenever scanning is permitted, even with the camera denied: the
          photo options and manual entry do not need camera access, and hiding
          the whole sheet behind that permission would take them away too. */}
      {scanningEnabled && hasPermission !== null && (
        <>
          <Pressable
            style={[styles.closeBtn, { top: insets.top + 10 }]}
            onPress={() => router.back()}
            hitSlop={10}
          >
            <X size={22} color={colors.surface} strokeWidth={2.4} />
          </Pressable>

          <View style={[styles.bottomSheet, compact && styles.bottomSheetCompact, { paddingBottom: insets.bottom + spacing.md }]}>
            {loading && <ActivityIndicator color={colors.primary} style={{ marginBottom: spacing.sm }} />}
            <Text style={styles.sheetTitle}>Scan Product</Text>
            <Text style={styles.sheetSubtitle}>Scan a barcode, snap a photo, or enter details manually.</Text>
            {!!entitlements && (
              <Text style={styles.quota}>
                {entitlements.ai_scans_used} / {entitlements.max_ai_scans} AI scans used this month
              </Text>
            )}

            {/* The shutter is the take-a-photo control, the way it is in any
                camera app — it was previously inert decoration. */}
            <Pressable
              style={styles.shutterWrap}
              onPress={() => pickAndRecognize('camera')}
              disabled={loading}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Take a photo of the item"
            >
              <View style={styles.shutterOuter}>
                <View style={styles.shutter} />
              </View>
            </Pressable>

            {/* Two shortcuts beside the shutter: pull a picture in from the
                gallery, or skip recognition entirely and type the details.
                There is deliberately no "Take Photo" button here — the shutter
                above is already that control, and two ways to do one thing just
                made the sheet busier. */}
            <View style={styles.actionRow}>
              <Pressable
                style={styles.modeBtn}
                onPress={() => pickAndRecognize('library')}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Upload a photo from the gallery"
              >
                <Images size={17} color={loading ? colors.textSecondary : colors.primary} strokeWidth={2.2} />
                <Text style={[styles.modeText, loading && styles.modeTextDisabled]}>Upload Photo</Text>
              </Pressable>
              <Pressable
                style={styles.modeBtn}
                onPress={() => router.push('/inventory/add')}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Enter the product details manually"
              >
                <PenLine size={17} color={loading ? colors.textSecondary : colors.primary} strokeWidth={2.2} />
                <Text style={[styles.modeText, loading && styles.modeTextDisabled]}>Edit Manually</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}

      <Modal
        visible={lookupDisplay !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setLookupDisplay(null);
          setScanned(false);
        }}
      >
        <View style={styles.resultBackdrop}>
          <View style={styles.resultCard}>
            {lookupDisplay?.status === 'loading' && (
              <>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={styles.resultTitle}>Looking up product…</Text>
                <Text style={styles.resultMeta}>{lookupDisplay.barcode}</Text>
              </>
            )}

            {lookupDisplay?.status === 'success' && (
              <>
                {lookupDisplay.product.image_url ? (
                  <Image source={{ uri: lookupDisplay.product.image_url }} style={styles.resultImage} />
                ) : null}
                <Text style={styles.resultTitle} numberOfLines={3}>
                  {lookupDisplay.product.title || 'Product found'}
                </Text>
                {!!lookupDisplay.product.brand && (
                  <Text style={styles.resultBrand} numberOfLines={2}>{lookupDisplay.product.brand}</Text>
                )}
                <Pressable
                  style={styles.resultPrimaryButton}
                  onPress={() => {
                    const review = toReviewProduct(lookupDisplay.product);
                    setLookupDisplay(null);
                    openReview(review, 'lookup');
                  }}
                >
                  <Text style={styles.resultPrimaryText}>Continue</Text>
                </Pressable>
              </>
            )}

            {lookupDisplay?.status === 'not_found' && (
              <Text style={styles.resultTitle}>No info found for {lookupDisplay.barcode}</Text>
            )}

            {lookupDisplay?.status === 'error' && (
              <>
                <Text style={styles.resultTitle}>Couldn&apos;t reach lookup service</Text>
                <Pressable style={styles.resultPrimaryButton} onPress={() => runLookup(lookupDisplay.barcode)}>
                  <Text style={styles.resultPrimaryText}>Retry</Text>
                </Pressable>
              </>
            )}

            {lookupDisplay && lookupDisplay.status !== 'loading' && (
              <Pressable
                style={styles.resultSecondaryButton}
                onPress={() => {
                  setLookupDisplay(null);
                  setScanned(false);
                }}
              >
                <Text style={styles.resultSecondaryText}>Scan again</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const CORNER = 30;
const LINE_H = 2; // scan line thickness
const SWEEP_PAD = 6; // gap the sweep keeps from the frame's top/bottom edges

// Everything drawn *over* the live camera preview — the scrim behind the close
// button, the hint pill, the corner brackets — is deliberately literal rather
// than tokenised. These sit on a video feed, not on a card, so the design
// system's surfaces do not apply and a palette change must not repaint them.
const OVERLAY_SCRIM = 'rgba(0,0,0,0.55)';
const OVERLAY_BTN = 'rgba(0,0,0,0.4)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centerState: { flex: 1, backgroundColor: colors.screenBg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  stateTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.sm },
  stateText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  manualBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: 12, marginTop: spacing.md },
  manualText: { color: colors.surface, fontWeight: '700', fontSize: 15 },
  textBtn: { paddingVertical: spacing.sm },
  textBtnLabel: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  cornerFrame: {
    position: 'absolute', left: 0, right: 0, top: '22%', bottom: '38%',
    alignItems: 'center', justifyContent: 'center',
  },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#FFFFFF' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
  scanLine: {
    position: 'absolute', top: 0, left: 12, right: 12, height: LINE_H,
    backgroundColor: colors.primary, borderRadius: 2,
    shadowColor: colors.primary, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  topHint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintText: {
    color: colors.surface, fontSize: 13, fontWeight: '600',
    backgroundColor: OVERLAY_SCRIM, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, overflow: 'hidden',
  },
  closeBtn: { position: 'absolute', right: spacing.lg, width: 40, height: 40, borderRadius: radii.pill, backgroundColor: OVERLAY_BTN, alignItems: 'center', justifyContent: 'center' },
  bottomSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.xl, paddingTop: spacing.lg, alignItems: 'center',
    marginTop: 'auto',
  },
  bottomSheetCompact: { paddingHorizontal: spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  sheetSubtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18, marginTop: spacing.xs },
  quota: { fontSize: 11.5, color: colors.textSecondary, marginTop: 6 },
  shutterWrap: { marginVertical: spacing.md },
  shutterOuter: { width: 66, height: 66, borderRadius: radii.pill, borderWidth: 3, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 50, height: 50, borderRadius: radii.pill, backgroundColor: colors.primary },
  actionRow: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch' },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: 48, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface,
  },
  modeText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  modeTextDisabled: { color: colors.textSecondary },
  resultBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  resultCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadow.card,
  },
  resultImage: {
    width: 128,
    height: 128,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    backgroundColor: colors.screenBg,
  },
  resultTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    textAlign: 'center',
  },
  resultMeta: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.sm },
  resultBrand: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs, textAlign: 'center' },
  resultPrimaryButton: {
    minWidth: 140,
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  resultPrimaryText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  resultSecondaryButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginTop: spacing.xs },
  resultSecondaryText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
