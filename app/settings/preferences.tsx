import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING } from '../../src/theme';

export default function PreferencesScreen() {
  const { profile } = useAuth();
  
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Units & Preferences</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Weight Unit</Text>
        <View style={styles.optionGroup}>
          {['g', 'kg', 'oz', 'lb'].map(unit => (
            <TouchableOpacity key={unit} style={styles.optionButton}>
              <Text style={styles.optionText}>{unit}</Text>
            </TouchableOpacity>
          ))}
        </View>
        
        <Text style={styles.sectionTitle}>Volume Unit</Text>
        <View style={styles.optionGroup}>
          {['ml', 'l', 'cups'].map(unit => (
            <TouchableOpacity key={unit} style={styles.optionButton}>
              <Text style={styles.optionText}>{unit}</Text>
            </TouchableOpacity>
          ))}
        </View>
        
        <Text style={styles.sectionTitle}>Currency</Text>
        <View style={styles.optionGroup}>
          {['PHP'].map(unit => (
            <TouchableOpacity key={unit} style={styles.optionButton}>
              <Text style={styles.optionText}>{unit}</Text>
            </TouchableOpacity>
          ))}
        </View>
        
        <Text style={styles.sectionTitle}>Language</Text>
        <View style={styles.optionGroup}>
          {['English'].map(unit => (
            <TouchableOpacity key={unit} style={styles.optionButton}>
              <Text style={styles.optionText}>{unit}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.lg },
  section: { backgroundColor: COLORS.white, borderRadius: 12, padding: SPACING.lg, marginBottom: SPACING.lg },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.md },
  optionGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  optionButton: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 8, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.divider },
  optionText: { fontSize: 14, color: COLORS.text },
});