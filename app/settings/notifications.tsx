import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { Bell, ChefHat, ShoppingCart, BarChart3 } from 'lucide-react-native';
import { NavHeader, PillButton } from '../../src/components/ui';

const DAYS = [1, 3, 5, 7];

export default function NotificationSettingsScreen() {
  const { profile } = useAuth();
  const [expirationNotifications, setExpirationNotifications] = useState(true);
  const [daysBefore, setDaysBefore] = useState(3);
  const [recipeNotifications, setRecipeNotifications] = useState(true);
  const [groceryNotifications, setGroceryNotifications] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile) return;
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', profile.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setExpirationNotifications(data.enabled);
          setDaysBefore(data.days_before);
          setRecipeNotifications(data.recipe_notifications);
          setGroceryNotifications(data.grocery_notifications);
          setWeeklySummary(data.weekly_summary);
        }
      })
      .catch(() => {});
  }, [profile]);

  const handleSave = async () => {
    if (!profile) return;
    setLoading(true);
    const { error } = await supabase.from('notification_preferences').upsert({
      user_id: profile.id,
      enabled: expirationNotifications,
      days_before: daysBefore,
      recipe_notifications: recipeNotifications,
      grocery_notifications: groceryNotifications,
      weekly_summary: weeklySummary,
    });
    setLoading(false);
    if (error) {
      Alert.alert('Could not save', error.message);
    } else {
      Alert.alert('Saved', 'Notification settings updated.');
    }
  };

  const rows = [
    { icon: Bell, label: 'Expiration Alerts', sub: 'Warn before items expire', value: expirationNotifications, set: setExpirationNotifications },
    { icon: ChefHat, label: 'Recipe Suggestions', sub: 'Meal ideas from your stock', value: recipeNotifications, set: setRecipeNotifications },
    { icon: ShoppingCart, label: 'Grocery Reminders', sub: 'Remind you to restock', value: groceryNotifications, set: setGroceryNotifications },
    { icon: BarChart3, label: 'Weekly Waste Summary', sub: 'A recap every Monday', value: weeklySummary, set: setWeeklySummary },
  ];

  return (
    <View style={styles.container}>
      <NavHeader title="Notifications" subtitle="Choose what you want to hear about" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
        <View style={styles.card}>
          {rows.map((r, i) => (
            <View key={r.label} style={[styles.settingRow, i < rows.length - 1 && styles.sep]}>
              <View style={styles.iconWrap}><r.icon size={18} color={COLORS.primary} strokeWidth={2.1} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>{r.label}</Text>
                <Text style={styles.settingSub}>{r.sub}</Text>
              </View>
              <Switch
                value={r.value}
                onValueChange={r.set}
                trackColor={{ false: COLORS.disabled, true: COLORS.secondary }}
                thumbColor={COLORS.white}
              />
            </View>
          ))}
        </View>

        {expirationNotifications && (
          <View style={styles.daysCard}>
            <Text style={styles.daysTitle}>Alert me</Text>
            <View style={styles.dayRow}>
              {DAYS.map((d) => (
                <View key={d} style={{ alignItems: 'center' }}>
                  <Text
                    style={[styles.dayChip, daysBefore === d && styles.dayChipActive]}
                    onPress={() => setDaysBefore(d)}
                  >
                    {d}
                  </Text>
                  <Text style={styles.dayLabel}>{d === 1 ? 'day' : 'days'} before</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <PillButton title="Save Settings" onPress={handleSave} loading={loading} style={{ marginTop: SPACING.md }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  card: {
    backgroundColor: COLORS.white, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  sep: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider },
  iconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  settingSub: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  daysCard: {
    backgroundColor: COLORS.white, borderRadius: 12, padding: 16, marginTop: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  daysTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-around' },
  dayChip: {
    width: 44, height: 44, borderRadius: RADII.pill, textAlignVertical: 'center',
    textAlign: 'center', overflow: 'hidden', fontSize: 16, fontWeight: '700',
    backgroundColor: COLORS.mutedBg, color: COLORS.secondaryText, lineHeight: 44,
  },
  dayChipActive: { backgroundColor: COLORS.primary, color: COLORS.white },
  dayLabel: { fontSize: 10, color: COLORS.secondaryText, marginTop: 6 },
});
