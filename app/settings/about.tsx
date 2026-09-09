import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { COLORS, SPACING } from '../../src/theme';
import { Leaf } from 'lucide-react-native';
import { NavHeader } from '../../src/components/ui';

export default function AboutScreen() {
  return (
    <View style={styles.container}>
      <NavHeader title="About KeepFresh AI" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, alignItems: 'center' }}>
        <View style={styles.appIcon}>
          <Leaf size={34} color={COLORS.white} strokeWidth={2.2} />
        </View>
        <Text style={styles.appName}>KeepFresh AI</Text>
        <Text style={styles.tagline}>Smarter Food Management,{'\n'}Less Waste, More Savings.</Text>
        <Text style={styles.version}>Version 1.0.0</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Our mission</Text>
          <Text style={styles.body}>
            KeepFresh AI helps households and food establishments track what they have, know what's expiring, and plan meals
            around it — so good food ends up on plates instead of in the trash.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How it works</Text>
          <Text style={styles.body}>
            Build a digital inventory of your food, get alerts before items expire, browse recipes that match what you own,
            and keep a shopping list that reflects what you actually need. Insights turn your usage into savings.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your data</Text>
          <Text style={styles.body}>
            Authentication and storage are powered by Supabase with row-level security, so each account can only ever see its
            own data.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  appIcon: { width: 76, height: 76, borderRadius: 22, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.lg, transform: [{ rotate: '-6deg' }] },
  appName: { fontSize: 26, fontWeight: '800', color: COLORS.text, marginTop: SPACING.md },
  tagline: { fontSize: 13, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 19, marginTop: SPACING.xs },
  version: { fontSize: 12, color: COLORS.secondaryText, marginTop: SPACING.md, backgroundColor: COLORS.mutedBg, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 50, overflow: 'hidden' },
  section: {
    alignSelf: 'stretch', backgroundColor: COLORS.white, borderRadius: 12, padding: 18, marginTop: SPACING.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  body: { fontSize: 13, color: COLORS.secondaryText, lineHeight: 20 },
});
