import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { Leaf } from 'lucide-react-native';
import { NavHeader, SectionHeader, colorWithOpacity } from '../../src/components/ui';
import { usePageGutter } from '../../src/hooks/useContentLayout';

export default function AboutScreen() {
  const { gutter } = usePageGutter();
  return (
    <View style={styles.container}>
      <NavHeader title="About KeepFresh AI" />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.xl, paddingHorizontal: gutter, alignItems: 'center' }}>
        <View style={styles.appIcon}>
          <Leaf size={34} color={colors.surface} strokeWidth={2.2} />
        </View>
        <Text style={styles.appName}>KeepFresh AI</Text>
        <Text style={styles.tagline}>Smarter Food Management,{'\n'}Less Waste, More Savings.</Text>
        <Text style={styles.version}>Version 1.0.0</Text>

        <View style={styles.section}>
          <SectionHeader title="Our mission" />
          <Text style={styles.body}>
            KeepFresh AI helps households and food establishments track what they have, know what's expiring, and plan meals
            around it — so good food ends up on plates instead of in the trash.
          </Text>
        </View>

        <View style={styles.section}>
          <SectionHeader title="How it works" />
          <Text style={styles.body}>
            Build a digital inventory of your food, get alerts before items expire, browse recipes that match what you own,
            and keep a shopping list that reflects what you actually need. Insights turn your usage into savings.
          </Text>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Your data" />
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
  container: { flex: 1, backgroundColor: colors.screenBg },
  appIcon: { width: 76, height: 76, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, transform: [{ rotate: '-6deg' }] },
  appName: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.md },
  tagline: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19, marginTop: spacing.xs },
  version: {
    fontSize: 12, color: colors.textSecondary, marginTop: spacing.md,
    backgroundColor: colorWithOpacity(colors.textSecondary, 0.12),
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: radii.pill, overflow: 'hidden',
  },
  section: {
    alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radii.lg,
    padding: spacing.lg, marginTop: spacing.lg, ...shadow.card,
  },
  body: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
});
