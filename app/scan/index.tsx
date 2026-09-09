import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, StatusBar } from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING } from '../../src/theme';
import { ScanBarcode, Camera as CameraIcon, PenLine, X } from 'lucide-react-native';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    setScanned(true);
    setLoading(true);
    try {
      const { data: productData } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('barcode', data)
        .single();
      if (productData) {
        router.push({
          pathname: '/scan/product',
          params: { barcode: data, productData: JSON.stringify(productData) },
        });
      } else {
        Alert.alert(
          'Product Not Found',
          'No product found with this barcode. Would you like to enter information manually?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setScanned(false) },
            { text: 'Enter Manually', onPress: () => router.push('/inventory/add') },
          ]
        );
      }
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

        <View style={styles.cornerFrame} pointerEvents="none">
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
          <View style={styles.scanLine} />
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
  scanLine: { position: 'absolute', left: 12, right: 12, height: 2, backgroundColor: COLORS.secondary, opacity: 0.9 },
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
