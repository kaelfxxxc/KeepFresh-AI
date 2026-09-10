import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { ChevronDown, LifeBuoy, Mail } from 'lucide-react-native';
import { NavHeader } from '../../src/components/ui';

const FAQS = [
  { q: 'How do I add items to inventory?', a: 'Tap Add Item on the Inventory tab, scan a barcode on the Scan screen, or add details manually. Set an expiration date so KeepFresh can alert you.' },
  { q: 'How does expiration tracking work?', a: 'When you add an item with an expiration date, it appears in Expiration Alerts as the date approaches so you can use it in time.' },
  { q: 'Can I scan barcodes?', a: 'Yes — open the Scan screen from Inventory and point the camera at a product barcode. KeepFresh auto-fills the product details for you to review, then adds it to your inventory. If the barcode is already tracked, it will ask whether you want to view the item or add another.' },
  { q: 'How are recipes recommended?', a: 'Recipes are shown by category. Pair them with ingredients you already own to cook before things expire.' },
  { q: 'How do I reduce food waste?', a: 'Check Expiration Alerts daily, buy only what\'s on your grocery list, and cook meals around items expiring soon.' },
];

export default function HelpScreen() {
  const [open, setOpen] = useState<number | null>(0);

  const email = 'support@keepfresh.app';
  const contact = () => {
    Linking.openURL(`mailto:${email}?subject=KeepFresh%20AI%20support`).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <NavHeader title="Help & Support" subtitle="Answers to common questions" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
        <View style={styles.card}>
          {FAQS.map((f, i) => {
            const expanded = open === i;
            return (
              <View key={i} style={[styles.faqItem, i < FAQS.length - 1 && styles.sep]}>
                <Pressable style={styles.faqQ} onPress={() => setOpen(expanded ? null : i)}>
                  <Text style={styles.faqQText}>{f.q}</Text>
                  <ChevronDown size={18} color={COLORS.secondaryText} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
                </Pressable>
                {expanded && <Text style={styles.faqAText}>{f.a}</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Still need help?</Text>
        <View style={styles.card}>
          <Pressable style={styles.contactRow} onPress={contact}>
            <View style={styles.contactIcon}><Mail size={18} color={COLORS.primary} strokeWidth={2.1} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactTitle}>Email Support</Text>
              <Text style={styles.contactSub}>{email}</Text>
            </View>
          </Pressable>
          <View style={styles.contactRow}>
            <View style={styles.contactIcon}><LifeBuoy size={18} color={COLORS.primary} strokeWidth={2.1} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactTitle}>Response time</Text>
              <Text style={styles.contactSub}>Usually within one business day</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  card: { backgroundColor: COLORS.white, borderRadius: 12, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider },
  faqItem: { paddingVertical: 6 },
  sep: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider },
  faqQ: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  faqQText: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.text },
  faqAText: { fontSize: 13, color: COLORS.secondaryText, lineHeight: 20, paddingBottom: 14, paddingRight: SPACING.md },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  contactIcon: { width: 38, height: 38, borderRadius: RADII.icon, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  contactTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  contactSub: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
});
