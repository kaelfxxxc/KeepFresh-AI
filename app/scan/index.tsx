import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { router } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING } from '../../src/theme';

export default function ScanScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
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
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Enter Manually',
              onPress: () => router.push('/inventory/add'),
            },
          ]
        );
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to search product. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text style={styles.loadingText}>Requesting camera permission...</Text></View>;
  }
  
  if (hasPermission === false) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera permission is required to scan products.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/inventory/add')}>
          <Text style={styles.buttonText}>Add Manually</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.cameraContainer}>
        <Camera
          style={styles.camera}
          type={CameraType.back}
          onBarCodeScanned={handleBarCodeScanned}
          barCodeScannerSettings={{
            barCodeTypes: [
              'ean13', 'ean8', 'upc-a', 'upc-e', 'code39', 'code93', 'code128',
            ],
          }}
        />
        
        <View style={styles.scanOverlay}>
          <Text style={styles.scanText}>Scan barcode or take a photo</Text>
        </View>
      </View>

      <View style={styles.bottomActions}>
        <Text style={styles.bottomTitle}>Scan Product</Text>
        <Text style={styles.bottomSubtitle}>Scan barcode or take a photo</Text>
        
        <View style={styles.actionButtons}>
          <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/inventory/add')}>
            <Text style={styles.actionButtonText}>Manual Entry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={() => router.push('/scan/product')}>
            <Text style={styles.actionButtonText}>Take Photo</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  scanOverlay: { position: 'absolute', top: 20, left: 0, right: 0, alignItems: 'center' },
  scanText: { color: COLORS.white, fontSize: 16, backgroundColor: 'rgba(0,0,0,0.5)', padding: SPACING.md, borderRadius: 8 },
  bottomActions: { padding: SPACING.lg, backgroundColor: COLORS.background },
  bottomTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  bottomSubtitle: { fontSize: 14, color: COLORS.secondaryText, marginTop: 2, marginBottom: SPACING.lg },
  actionButtons: { flexDirection: 'row', gap: SPACING.md },
  actionButton: { flex: 1, paddingVertical: SPACING.md, borderRadius: 8, alignItems: 'center', backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider },
  primaryButton: { backgroundColor: COLORS.primary },
  actionButtonText: { fontSize: 16, color: COLORS.text, fontWeight: '600' },
  loadingText: { color: COLORS.secondaryText, textAlign: 'center', marginTop: 50 },
  errorText: { color: COLORS.danger, textAlign: 'center', marginTop: 50, marginHorizontal: SPACING.lg },
  button: { paddingVertical: SPACING.md, backgroundColor: COLORS.primary, borderRadius: 8, marginHorizontal: SPACING.lg },
  buttonText: { color: COLORS.white, textAlign: 'center', fontWeight: '600' },
});