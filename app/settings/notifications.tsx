import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { Bell, ChefHat, ShoppingCart, BarChart3 } from 'lucide-react-native';
import { NavHeader, PillButton, IconBadge, SectionHeader, colorWithOpacity } from '../../src/components/ui';
import { usePageGutter } from '../../src/hooks/useContentLayout';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { notificationService } from '../../src/services/notificationService';

const DAYS = [1, 3, 5, 7];

export default function NotificationSettingsScreen() {
  const { gutter } = usePageGutter();
  const { profile } = useAuth();
  const { entitlements } = useSubscription();
  const [expirationNotifications, setExpirationNotifications] = useState(true);
  const [daysBefore, setDaysBefore] = useState(3);
  const [recipeNotifications, setRecipeNotifications] = useState(true);
  const [groceryNotifications, setGroceryNotifications] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [lowStockNotifications, setLowStockNotifications] = useState(false);
  const [loading, setLoading] = useState(false);
  const canUseLowStock = !!entitlements?.is_active && entitlements.tier === 'pro'
    && (!!entitlements.is_verified_paid || entitlements.provider === 'manual');

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
          if (profile.account_type !== 'establishment') {
            setRecipeNotifications(data.recipe_notifications);
          }
          setGroceryNotifications(data.grocery_notifications);
          setWeeklySummary(data.weekly_summary);
          setLowStockNotifications(data.low_stock_enabled ?? false);
        }
      }, () => {});
  }, [profile]);

  const handleSave = async () => {
    if (!profile) return;
    setLoading(true);
    let lowStockEnabled = lowStockNotifications && canUseLowStock;
    try {
      if (lowStockEnabled) {
        lowStockEnabled = await notificationService.enableLowStockPush(profile.id);
      } else {
        await notificationService.disableLowStockPush(profile.id);
      }
    } catch (error) {
      setLoading(false);
      Alert.alert('Could not update push notifications', (error as Error).message);
      return;
    }
    const { error } = await supabase.from('notification_preferences').upsert({
      user_id: profile.id,
      enabled: expirationNotifications,
      days_before: daysBefore,
      recipe_notifications: profile.account_type === 'establishment' ? false : recipeNotifications,
      grocery_notifications: groceryNotifications,
      weekly_summary: weeklySummary,
      low_stock_enabled: lowStockEnabled,
    });
    setLoading(false);
    if (error) {
      Alert.alert('Could not save', error.message);
    } else {
      setLowStockNotifications(lowStockEnabled);
      Alert.alert('Saved', lowStockNotifications && !lowStockEnabled
        ? 'Settings saved. Allow notifications in your device settings to receive low stock alerts.'
        : 'Notification settings updated.');
    }
  };

  const rows = [
    { icon: Bell, label: 'Expiration Alerts', sub: 'Warn before items expire', value: expirationNotifications, set: setExpirationNotifications },
    ...(profile?.account_type === 'establishment' ? [] : [
      { icon: ChefHat, label: 'Recipe Suggestions', sub: 'Meal ideas from your stock', value: recipeNotifications, set: setRecipeNotifications },
    ]),
    { icon: ShoppingCart, label: 'Grocery Reminders', sub: 'Remind you to restock', value: groceryNotifications, set: setGroceryNotifications },
    { icon: BarChart3, label: 'Weekly Waste Summary', sub: 'A recap every Monday', value: weeklySummary, set: setWeeklySummary },
    {
      icon: Bell,
      label: 'Low Stock Push Alerts',
      sub: canUseLowStock ? 'Push when an item reaches its stock threshold' : 'Available on the active Pro plan',
      value: lowStockNotifications && canUseLowStock,
      set: setLowStockNotifications,
      disabled: !canUseLowStock,
    },
  ];

  return (
    <View style={styles.container}>
      <NavHeader title="Notifications" subtitle="Choose what you want to hear about" />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.xl, paddingHorizontal: gutter }}>
        <View style={styles.card}>
          {rows.map((r, i) => (
            <View key={r.label} style={[styles.settingRow, i < rows.length - 1 && styles.sep]}>
              <IconBadge color={colors.primary} size={40}>
                <r.icon size={18} color={colors.primary} strokeWidth={2.1} />
              </IconBadge>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>{r.label}</Text>
                <Text style={styles.settingSub}>{r.sub}</Text>
              </View>
              <Switch
                value={r.value}
                onValueChange={r.set}
                disabled={!!r.disabled}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>
          ))}
        </View>

        {expirationNotifications && (
          <View style={styles.daysCard}>
            <SectionHeader title="Alert me" />
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

        <PillButton title="Save Settings" onPress={handleSave} loading={loading} style={{ marginTop: spacing.md }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs,
    ...shadow.card,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  sep: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  settingLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  settingSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  daysCard: {
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.md,
    ...shadow.card,
  },
  dayRow: { flexDirection: 'row', justifyContent: 'space-around' },
  dayChip: {
    width: 44, height: 44, borderRadius: radii.pill, textAlignVertical: 'center',
    textAlign: 'center', overflow: 'hidden', fontSize: 16, fontWeight: '700',
    backgroundColor: colorWithOpacity(colors.textSecondary, 0.12), color: colors.textSecondary, lineHeight: 44,
  },
  dayChipActive: { backgroundColor: colors.primaryDark, color: colors.surface },
  dayLabel: { fontSize: 10, color: colors.textSecondary, marginTop: 6 },
});
