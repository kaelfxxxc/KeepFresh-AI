import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image, ActivityIndicator, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, FONTS } from '../../src/theme';

export default function ProductInfoScreen() {
  const params = useLocalSearchParams();
  const { profile } = useAuth();
  const [productData, setProductData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    product_name: '',
    brand: '',
    category: '',
    expiration_date: '',
    quantity: 1,
    unit: '',
  });

  useEffect(() => {
    if (params.productData) {
      const data = JSON.parse(params.productData as string);
      setProductData(data);
      setFormData({
        product_name: data.product_name || '',
        brand: data.brand || '',
        category: data.category || '',
        expiration_date: data.expiration_date || '',
        quantity: data.quantity || 1,
        unit: data.unit || '',
      });
    }
  }, [params.productData]);

  const handleEdit = () => {
    router.push({ pathname: '/inventory/edit', params: { ...formData } });
  };

  const handleAddToInventory = async () => {
    if (!profile) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.from('inventory_items').insert({
        user_id: profile.id,
        product_name: formData.product_name,
        brand: formData.brand || null,
        category: formData.category || null,
        expiration_date: formData.expiration_date || null,
        quantity: formData.quantity,
        unit: formData.unit || 'pcs',
        barcode: params.barcode || null,
        notes: 'AI detected information. Please verify and edit if needed.',
      });
      
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert('Success', 'Item added to inventory!', [
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
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Product Information</Text>
      </View>

      <View style={styles.imageContainer}>
        <Text style={styles.productImagePlaceholder}>📷</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Product Name</Text>
        <Text style={styles.infoValue}>{formData.product_name || 'Unknown'}</Text>
        
        <Text style={styles.infoLabel}>Brand</Text>
        <Text style={styles.infoValue}>{formData.brand || 'Unknown'}</Text>
        
        <Text style={styles.infoLabel}>Category</Text>
        <Text style={styles.infoValue}>{formData.category || 'Unknown'}</Text>
        
        <Text style={styles.infoLabel}>Expiration Date</Text>
        <Text style={styles.infoValue}>{formData.expiration_date || 'Not set'}</Text>
        
        <Text style={styles.infoLabel}>Quantity</Text>
        <Text style={styles.infoValue}>{formData.quantity} {formData.unit || 'pcs'}</Text>
      </View>

      <View style={styles.warningCard}>
        <Text style={styles.warningText}>
          ⚠️ AI detected information. Please verify and edit if needed.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.editButton} onPress={handleEdit}>
          <Text style={styles.editButtonText}>Edit Information</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.addButton, loading && styles.buttonDisabled]}
          onPress={handleAddToInventory}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.addButtonText}>Add to Inventory</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  imageContainer: { padding: SPACING.xxl, alignItems: 'center' },
  productImagePlaceholder: { fontSize: 64 },
  infoCard: { backgroundColor: COLORS.white, borderRadius: 12, marginHorizontal: SPACING.lg, padding: SPACING.lg },
  infoLabel: { fontSize: 12, color: COLORS.secondaryText, marginBottom: 2 },
  infoValue: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  warningCard: { backgroundColor: COLORS.warning + '20', borderRadius: 8, padding: SPACING.md, marginHorizontal: SPACING.lg, marginTop: SPACING.md },
  warningText: { fontSize: 13, color: COLORS.text, textAlign: 'center' },
  actions: { padding: SPACING.lg, gap: SPACING.md },
  editButton: { paddingVertical: SPACING.md, borderRadius: 8, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center' },
  editButtonText: { color: COLORS.primary, fontWeight: '600' },
  addButton: { backgroundColor: COLORS.primary, paddingVertical: SPACING.md, borderRadius: 8, alignItems: 'center' },
  addButtonText: { color: COLORS.white, fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.7 },
});