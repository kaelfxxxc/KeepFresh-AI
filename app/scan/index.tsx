import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, StatusBar, Animated, Easing } from 'react-native';
import { Camera, CameraType } from 'expo-camera/legacy';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING } from '../../src/theme';
import { InventoryItem } from '../../src/types';
import { lookupBarcode, toReviewProduct, ReviewInfo } from '../../src/services/barcodeService';
import { ScanBarcode, Camera as CameraIcon, PenLine, X } from 'lucide-react-native';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  // Height of the barcode frame (measured), used to sweep the scan line.
  const [frameH, setFrameH] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;

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
  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setLoading(false);
    }, [])
  );

  // Sweep the scan line up and down the frame while the camera is actively
  // scanning; freeze it once a code is locked in or a lookup is running.
  useEffect(() => {
    if (!(hasPermission && !scanned && !loading) || frameH <= LINE_H + SWEEP_PAD * 2) {
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
  }, [hasPermission, scanned, loading, frameH, sweep]);

  const openReview = (review: ReviewInfo, source: 'lookup' | 'inventory') => {
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

  const offerManualEntry = (barcode: string, message: string) => {
    Alert.alert('Product Not Found', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
      {
        text: 'Enter Manually',
        onPress: () => router.push({ pathname: '/inventory/add', params: { barcode } }),
      },
    ]);
  };

  const runLookup = async (barcode: string, fallback?: InventoryItem) => {
    const result = await lookupBarcode(barcode);
    if (result.status === 'found') {
      openReview(toReviewProduct(result.product), 'lookup');
    } else if (result.status === 'unavailable' && fallback) {
      // Server unreachable / function not deployed yet — reuse what we know.
      openReview(fromExisting(fallback, barcode), 'inventory');
    } else if (result.status === 'unavailable') {
      offerManualEntry(
        barcode,
        'We couldn’t reach the product database. Would you like to enter the information manually?'
      );
    } else {
      offerManualEntry(
        barcode,
        'We couldn’t find this barcode in the product database. Would you like to enter the information manually?'
      );
    }
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
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
    if (hasPermission === null) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.stateText}>Requesting camera permission…</Text>
        </View>
      );
    }
    if (hasPermission === false) {
      return (
        <View style={styles.centerState}>
          <ScanBarcode size={44} color={COLORS.secondaryText} strokeWidth={1.5} />
          <Text style={styles.stateTitle}>Camera access needed</Text>
          <Text style={styles.stateText}>Enable camera permission to scan product barcodes.</Text>
          <Pressable style={styles.manualBtn} onPress={() => router.push('/inventory/add')}>
            <PenLine size={16} color={COLORS.white} strokeWidth={2.2} />
            <Text style={styles.manualText}>Add Manually</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        <Camera
          style={styles.camera}
          type={CameraType.back}
          onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
          barCodeScannerSettings={{
            barCodeTypes: ['ean13', 'ean8', 'upc-a', 'upc-e', 'code39', 'code93', 'code128'],
          }}
        />

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

      {hasPermission && (
        <>
          <Pressable
            style={[styles.closeBtn, { top: insets.top + 10 }]}
            onPress={() => router.back()}
            hitSlop={10}
          >
            <X size={22} color={COLORS.white} strokeWidth={2.4} />
          </Pressable>

          <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + SPACING.md }]}>
            {loading && <ActivityIndicator color={COLORS.primary} style={{ marginBottom: SPACING.sm }} />}
            <Text style={styles.sheetTitle}>Scan Product</Text>
            <Text style={styles.sheetSubtitle}>Scan a barcode, snap a photo, or enter details manually.</Text>

            <View style={styles.shutterWrap}>
              <View style={styles.shutterOuter}>
                <View style={styles.shutter} />
              </View>
            </View>

            <View style={styles.actionRow}>
              <Pressable style={[styles.modeBtn, styles.modePrimary]} onPress={() => router.push('/inventory/add')}>
                <PenLine size={17} color={COLORS.white} strokeWidth={2.2} />
                <Text style={styles.modePrimaryText}>Manual Entry</Text>
              </Pressable>
              <Pressable style={styles.modeBtn} onPress={() => router.push({ pathname: '/scan/product' })}>
                <CameraIcon size={17} color={COLORS.primary} strokeWidth={2.2} />
                <Text style={styles.modeText}>Take Photo</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const CORNER = 30;
const LINE_H = 2; // scan line thickness
const SWEEP_PAD = 6; // gap the sweep keeps from the frame's top/bottom edges
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centerState: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, gap: 8 },
  stateTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginTop: SPACING.sm },
  stateText: { fontSize: 14, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 20 },
  manualBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 50, paddingHorizontal: SPACING.lg, paddingVertical: 12, marginTop: SPACING.md },
  manualText: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
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
  scanLine: {
    position: 'absolute', top: 0, left: 12, right: 12, height: LINE_H,
    backgroundColor: COLORS.secondary, borderRadius: 2,
    shadowColor: COLORS.secondary, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  topHint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintText: {
    color: COLORS.white, fontSize: 13, fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50, overflow: 'hidden',
  },
  closeBtn: { position: 'absolute', right: SPACING.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  bottomSheet: {
    backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, alignItems: 'center',
    marginTop: 'auto',
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text },
  sheetSubtitle: { fontSize: 13, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  shutterWrap: { marginVertical: SPACING.md },
  shutterOuter: { width: 66, height: 66, borderRadius: 33, borderWidth: 3, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.primary },
  actionRow: { flexDirection: 'row', gap: SPACING.sm, alignSelf: 'stretch' },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: 50, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.white,
  },
  modePrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modeText: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },
  modePrimaryText: { color: COLORS.white, fontWeight: '700', fontSize: 14 },
});
