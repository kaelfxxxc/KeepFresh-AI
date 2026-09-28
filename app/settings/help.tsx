import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { ChevronDown, LifeBuoy, Mail } from 'lucide-react-native';
import { NavHeader, IconBadge, SectionHeader } from '../../src/components/ui';
import { usePageGutter } from '../../src/hooks/useContentLayout';

const FAQS = [
  { q: 'How do I add items to inventory?', a: 'Tap Add Item on the Inventory tab, scan a barcode on the Scan screen, or add details manually. Set an expiration date so KeepFresh can alert you.' },
  { q: 'How does expiration tracking work?', a: 'When you add an item with an expiration date, it appears in Expiration Alerts as the date approaches so you can use it in time.' },
  { q: 'Can I scan barcodes?', a: 'Yes — open the Scan screen from Inventory and point the camera at a product barcode. KeepFresh auto-fills the product details for you to review, then adds it to your inventory. If the barcode is already tracked, it will ask whether you want to view the item or add another.' },
  { q: 'How are recipes recommended?', a: 'Recipes are shown by category. Pair them with ingredients you already own to cook before things expire.' },
  { q: 'How do I reduce food waste?', a: 'Check Expiration Alerts daily, buy only what\'s on your grocery list, and cook meals around items expiring soon.' },
];

export default function HelpScreen() {
  const { gutter } = usePageGutter();
  const [open, setOpen] = useState<number | null>(0);

  const email = 'support@keepfresh.app';
  const contact = () => {
    Linking.openURL(`mailto:${email}?subject=KeepFresh%20AI%20support`).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <NavHeader title="Help & Support" subtitle="Answers to common questions" />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.xl, paddingHorizontal: gutter }}>
        <View style={styles.card}>
          {FAQS.map((f, i) => {
            const expanded = open === i;
            return (
              <View key={i} style={[styles.faqItem, i < FAQS.length - 1 && styles.sep]}>
                <Pressable style={styles.faqQ} onPress={() => setOpen(expanded ? null : i)}>
                  <Text style={styles.faqQText}>{f.q}</Text>
                  <ChevronDown size={18} color={colors.textSecondary} style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
                </Pressable>
                {expanded && <Text style={styles.faqAText}>{f.a}</Text>}
              </View>
            );
          })}
        </View>

        <SectionHeader title="Still need help?" />
        <View style={styles.card}>
          <Pressable style={styles.contactRow} onPress={contact}>
            <IconBadge color={colors.primary} size={40}>
              <Mail size={18} color={colors.primary} strokeWidth={2.1} />
            </IconBadge>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactTitle}>Email Support</Text>
              <Text style={styles.contactSub}>{email}</Text>
            </View>
          </Pressable>
          <View style={styles.contactRow}>
            <IconBadge color={colors.primary} size={40}>
              <LifeBuoy size={18} color={colors.primary} strokeWidth={2.1} />
            </IconBadge>
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
  container: { flex: 1, backgroundColor: colors.screenBg },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.lg,
    paddingHorizontal: spacing.lg, ...shadow.card,
  },
  faqItem: { paddingVertical: 6 },
  sep: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  faqQ: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  faqQText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  faqAText: { fontSize: 13, color: colors.textSecondary, lineHeight: 20, paddingBottom: 14, paddingRight: spacing.md },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  contactTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  contactSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});
