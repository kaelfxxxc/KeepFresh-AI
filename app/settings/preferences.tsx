import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { colors, radii, spacing } from '../../src/theme';
import { NavHeader, SectionHeader } from '../../src/components/ui';
import { usePageGutter } from '../../src/hooks/useContentLayout';

const GROUPS: { title: string; key: 'weight_unit' | 'volume_unit' | 'currency' | 'language'; options: string[] }[] = [
  { title: 'Weight Unit', key: 'weight_unit', options: ['g', 'kg', 'oz', 'lb'] },
  { title: 'Volume Unit', key: 'volume_unit', options: ['ml', 'l', 'cups'] },
  { title: 'Currency', key: 'currency', options: ['PHP'] },
  { title: 'Language', key: 'language', options: ['English'] },
];

export default function PreferencesScreen() {
  const { gutter } = usePageGutter();
  const { profile } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, string>>({
    weight_unit: 'g', volume_unit: 'ml', currency: 'PHP', language: 'English',
  });

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', profile.id)
      .single()
      .then(({ data }) => {
        if (data) {
          const p: Record<string, string> = {};
          (Object.keys(prefs) as string[]).forEach((k) => { if (data[k]) p[k] = data[k]; });
          setPrefs((cur) => ({ ...cur, ...p }));
        }
      }, () => {});
  }, [profile]);

  const choose = async (key: string, value: string) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    if (!profile) return;
    const { error } = await supabase.from('user_preferences').upsert({ user_id: profile.id, [key]: value });
    if (error) Alert.alert('Could not save', error.message);
  };

  return (
    <View style={styles.container}>
      <NavHeader title="Units & Preferences" subtitle="How measurements are shown to you" />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.xl, paddingHorizontal: gutter }}>
        {GROUPS.map((g) => (
          <View key={g.key} style={styles.group}>
            <SectionHeader title={g.title} />
            <View style={styles.options}>
              {g.options.map((opt) => {
                const active = prefs[g.key] === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => choose(g.key, opt)}
                    style={[styles.option, active ? styles.optionActive : styles.optionInactive]}
                  >
                    <Text style={[styles.optionText, active ? styles.optionTextActive : styles.optionTextInactive]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        <Text style={styles.note}>
          These preferences apply to quantities you add to your inventory and to shopping lists.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  group: { marginBottom: spacing.lg },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, borderWidth: 1.5 },
  // Active reads as the darkest green in the palette, the same rule the filter
  // chips follow, so a chosen option looks chosen everywhere.
  optionActive: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  optionInactive: { backgroundColor: colors.surface, borderColor: colors.border },
  optionText: { fontSize: 14, fontWeight: '600' },
  optionTextActive: { color: colors.surface },
  optionTextInactive: { color: colors.textSecondary },
  note: { fontSize: 12, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.sm },
});
