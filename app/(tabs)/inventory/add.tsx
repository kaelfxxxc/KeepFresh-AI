import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../src/lib/supabase';
import { useAuth } from '../../../src/context/AuthContext';
import { COLORS, SPACING, FONTS } from '../../../src/theme';

const CATEGORIES = ['Produce', 'Dairy', 'Meat', 'Seafood', 'Grains', 'Frozen', 'Beverages', 'Snacks', 'Condiments', 'Other'];
const UNITS = ['pcs', 'kg', 'g', 'lb', 'oz', 'L', 'ml', 'cups', 'pack', 'bottle', 'can', 'box'];

export default function AddItemScreen() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    product_name: '',
    brand: '',
    category: 'Other',
    quantity: '1',
    unit: 'pcs',
    expiration_date: '',
    purchase_date: new Date().toISOString().split('T')[0],
    price: '',
    notes: '',
    barcode: '',
    image_url: '',
  });

  const handleSave = async () => {
    if (!profile) return;
    
    if (!form.product_name.trim()) {
      Alert.alert('Error', 'Please enter a product name');
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase.from('inventory_items').insert({
        user_id: profile.id,
        product_name: form.product_name,
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
        Alert.alert('Success', 'Item added successfully!', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to save item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Add Item</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Food Name *</Text>
          <TextInput
            style={styles.input}
            value={form.product_name}
            onChangeText={(text) => setForm({ ...form, product_name: text })}
            placeholder="Enter food name"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, form.category === cat && styles.categoryChipActive]}
                onPress={() => setForm({ ...form, category: cat })}
              >
                <Text style={[styles.categoryText, form.category === cat && styles.categoryTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Brand</Text>
          <TextInput
            style={styles.input}
            value={form.brand}
            onChangeText={(text) => setForm({ ...form, brand: text })}
            placeholder="Enter brand (optional)"
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputContainer, { flex: 1, marginRight: SPACING.sm }]}>
            <Text style={styles.label}>Quantity</Text>
            <TextInput
              style={styles.input}
              value={form.quantity}
              onChangeText={(text) => setForm({ ...form, quantity: text })}
              keyboardType="numeric"
              placeholder="1"
            />
          </View>
          <View style={[styles.inputContainer, { flex: 1, marginLeft: SPACING.sm }]}>
            <Text style={styles.label}>Unit</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {UNITS.map(unit => (
                <TouchableOpacity
                  key={unit}
                  style={[styles.unitChip, form.unit === unit && styles.unitChipActive]}
                  onPress={() => setForm({ ...form, unit })}
                >
                  <Text style={[styles.unitText, form.unit === unit && styles.unitTextActive]}>
                    {unit}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Expiration Date</Text>
          <TextInput
            style={styles.input}
            value={form.expiration_date}
            onChangeText={(text) => setForm({ ...form, expiration_date: text })}
            placeholder="YYYY-MM-DD"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Purchase Date</Text>
          <TextInput
            style={styles.input}
            value={form.purchase_date}
            onChangeText={(text) => setForm({ ...form, purchase_date: text })}
            placeholder="YYYY-MM-DD"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Price (₱)</Text>
          <TextInput
            style={styles.input}
            value={form.price}
            onChangeText={(text) => setForm({ ...form, price: text })}
            keyboardType="numeric"
            placeholder="0.00"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Barcode</Text>
          <TextInput
            style={styles.input}
            value={form.barcode}
            onChangeText={(text) => setForm({ ...form, barcode: text })}
            placeholder="Enter barcode (optional)"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, { height: 80 }]}
            value={form.notes}
            onChangeText={(text) => setForm({ ...form, notes: text })}
            placeholder="Add notes (optional)"
            multiline
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, loading && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.saveButtonText}>Save Item</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  cancelText: { color: COLORS.primary, fontSize: 16 },
  form: { paddingHorizontal: SPACING.lg },
  inputContainer: { marginBottom: SPACING.lg },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.xs },
  input: { backgroundColor: COLORS.white, borderRadius: 8, borderWidth: 1, borderColor: COLORS.divider, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, fontSize: 16 },
  row: { flexDirection: 'row' },
  categoryScroll: { marginTop: SPACING.xs },
  categoryChip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 20, backgroundColor: COLORS.white, marginRight: SPACING.sm, borderWidth: 1, borderColor: COLORS.divider },
  categoryChipActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  categoryText: { fontSize: 13, color: COLORS.secondaryText },
  categoryTextActive: { color: COLORS.primary, fontWeight: '600' },
  unitChip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 20, backgroundColor: COLORS.white, marginRight: SPACING.sm, borderWidth: 1, borderColor: COLORS.divider },
  unitChipActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  unitText: { fontSize: 13, color: COLORS.secondaryText },
  unitTextActive: { color: COLORS.primary, fontWeight: '600' },
  saveButton: { backgroundColor: COLORS.primary, paddingVertical: SPACING.md, borderRadius: 8, alignItems: 'center', marginTop: SPACING.md, marginBottom: SPACING.xl },
  saveButtonText: { color: COLORS.white, fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.7 },
});