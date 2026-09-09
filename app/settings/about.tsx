import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { COLORS, SPACING } from '../../theme';

export default function AboutScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.appInfo}>
        <Text style={styles.appName}>KeepFresh AI</Text>
        <Text style={styles.appTagline}>Smarter Food Management, Less Waste, More Savings.</Text>
        <Text style={styles.appVersion}>Version 1.0.0</Text>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.description}>
          KeepFresh AI is a smart food inventory and expiration tracking application designed to help users reduce food waste, save money, and manage their food supplies more efficiently.
        </Text>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy Policy</Text>
        <TouchableOpacity>
          <Text style={styles.linkText}>View Privacy Policy</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Terms of Service</Text>
        <TouchableOpacity>
          <Text style={styles.linkText}>View Terms of Service</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Sources</Text>
        <Text style={styles.description}>
          This app uses Supabase for authentication and database operations. All data is stored securely with row-level security enabled.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  appInfo: { alignItems: 'center', paddingVertical: SPACING.xl * 2, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  appName: { fontSize: 32, fontWeight: 'bold', color: COLORS.primary },
  appTagline: { fontSize: 14, color: COLORS.secondaryText, textAlign: 'center', marginTop: SPACING.sm },
  appVersion: { fontSize: 12, color: COLORS.secondaryText, marginTop: SPACING.sm },
  section: { backgroundColor: COLORS.white, padding: SPACING.lg, marginVertical: SPACING.sm, marginHorizontal: SPACING.lg, borderRadius: 12 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.md },
  description: { fontSize: 14, color: COLORS.secondaryText, lineHeight: 20 },
  linkText: { color: COLORS.primary, fontWeight: '600' },
});