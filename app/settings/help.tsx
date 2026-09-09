import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native';
import { COLORS, SPACING } from '../../theme';

export default function HelpScreen() {
  const faqs = [
    { q: 'How do I add items to inventory?', a: 'Tap the + button in the Inventory tab or use the scan feature.' },
    { q: 'How does expiration tracking work?', a: 'Set expiration dates when adding items. You\'ll receive alerts before items expire.' },
    { q: 'Can I scan barcodes?', a: 'Yes, use the Scan tab to scan product barcodes.' },
    { q: 'How are recipes recommended?', a: 'Recipes are suggested based on items in your inventory.' },
    { q: 'How do I reduce food waste?', a: 'Check expiration alerts daily and plan meals around expiring items.' },
  ];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Help & Support</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
        {faqs.map((faq, i) => (
          <View key={i} style={styles.faqItem}>
            <Text style={styles.faqQuestion}>{faq.q}</Text>
            <Text style={styles.faqAnswer}>{faq.a}</Text>
          </View>
        ))}
      </View>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact Support</Text>
        <TouchableOpacity style={styles.contactButton}>
          <Text style={styles.contactText}>Email Support</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.lg },
  section: { backgroundColor: COLORS.white, borderRadius: 12, padding: SPACING.lg, marginBottom: SPACING.lg },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.md },
  faqItem: { marginBottom: SPACING.md, paddingBottom: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  faqQuestion: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  faqAnswer: { fontSize: 14, color: COLORS.secondaryText },
  contactButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: 8, alignItems: 'center' },
  contactText: { color: COLORS.white, fontWeight: '600' },
});