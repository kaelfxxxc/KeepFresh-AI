import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { NavHeader } from '../../src/components/ui';

const GROUPS: { title: string; key: 'weight_unit' | 'volume_unit' | 'currency' | 'language'; options: string[] }[] = [
  { title: 'Weight Unit', key: 'weight_unit', options: ['g', 'kg', 'oz', 'lb'] },
  { title: 'Volume Unit', key: 'volume_unit', options: ['ml', 'l', 'cups'] },
  { title: 'Currency', key: 'currency', options: ['PHP'] },
  { title: 'Language', key: 'language', options: ['English'] },
];

export default function PreferencesScreen() {
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
      <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
        {GROUPS.map((g) => (
          <View key={g.key} style={styles.group}>
            <Text style={styles.groupTitle}>{g.title}</Text>
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
  container: { flex: 1, backgroundColor: COLORS.background },
  group: { marginBottom: SPACING.lg },
  groupTitle: { fontSize: 13, fontWeight: '700', color: COLORS.secondaryText, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  option: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: RADII.pill, borderWidth: 1.5 },
  optionActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optionInactive: { backgroundColor: COLORS.white, borderColor: COLORS.divider },
  optionText: { fontSize: 14, fontWeight: '600' },
  optionTextActive: { color: COLORS.white },
  optionTextInactive: { color: COLORS.secondaryText },
  note: { fontSize: 12, color: COLORS.secondaryText, lineHeight: 18, marginTop: SPACING.sm },
});
