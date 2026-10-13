import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Switch, TextInput } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { Bell, ChefHat, ShoppingCart, BarChart3 } from 'lucide-react-native';
import { NavHeader, PillButton, IconBadge, SectionHeader, colorWithOpacity } from '../../src/components/ui';
import { usePageGutter } from '../../src/hooks/useContentLayout';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { notificationService } from '../../src/services/notificationService';
import { useRouter } from 'expo-router';

const DAYS = [1, 3, 5, 7];

export default function NotificationSettingsScreen() {
  const { gutter } = usePageGutter();
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const { entitlements } = useSubscription();
  const [expirationNotifications, setExpirationNotifications] = useState(true);
  const [daysBefore, setDaysBefore] = useState(3);
  const [recipeNotifications, setRecipeNotifications] = useState(true);
  const [groceryNotifications, setGroceryNotifications] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [lowStockNotifications, setLowStockNotifications] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsLowStock, setSmsLowStock] = useState(false);
  const [smsExpiration, setSmsExpiration] = useState(false);
  const [smsSubscription, setSmsSubscription] = useState(false);
  const [smsPhone, setSmsPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState(false);
  const [loading, setLoading] = useState(false);
  const canUseLowStock = !!entitlements?.is_active && entitlements.tier === 'pro'
    && (!!entitlements.is_verified_paid || entitlements.provider === 'manual');

  const changeLowStockPreference = async (enabled: boolean) => {
    if (enabled) {
      const allowed = await notificationService.requestPermission();
      if (!allowed) {
        Alert.alert('Notifications are off', 'Allow notifications for KeepFresh AI in your device settings to receive low-stock alerts.');
        return;
      }
    }
    setLowStockNotifications(enabled);
  };

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
          setSmsEnabled(data.sms_enabled ?? false);
          setSmsLowStock(data.sms_low_stock ?? false);
          setSmsExpiration(data.sms_expiration ?? false);
          setSmsSubscription(data.sms_subscription ?? false);
        }
      }, () => {});
    setSmsPhone(profile.phone_number?.replace(/^\+63/, '') ?? '');
    setVerifiedPhone(!!profile.phone_verified_at);
  }, [profile]);

  const verifyPhone = async () => {
    if (!profile) return;
    const digits = smsPhone.replace(/\D/g, '').replace(/^0/, '');
    if (!/^9\d{9}$/.test(digits)) { Alert.alert('Invalid PH mobile number', 'Enter 10 digits starting with 9.'); return; }
    try {
      const { data, error } = await supabase.functions.invoke('sms-otp', { body: { action: 'send', phone: `+63${digits}`, purpose: 'verify_phone' } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Could not send code.');
      setOtpSent(true);
      Alert.alert('Code sent', 'Enter the six digit verification code below.');
    } catch (error) { Alert.alert('Could not send verification code', (error as Error).message); }
  };

  const confirmPhoneCode = async () => {
    if (!profile) return;
    const digits = smsPhone.replace(/\D/g, '').replace(/^0/, '');
    const { data, error } = await supabase.functions.invoke('sms-otp', { body: { action: 'verify', phone: `+63${digits}`, code: smsCode, purpose: 'verify_phone' } });
    if (error || data?.error) { Alert.alert('Verification failed', data?.error ?? error?.message); return; }
    setVerifiedPhone(true); setOtpSent(false); setSmsCode('');
    await refreshProfile();
    Alert.alert('Phone verified', 'SMS notifications can now be enabled.');
  };

  const handleSave = async () => {
    if (!profile) return;
    setLoading(true);
    let pushEnabled = false;
    try {
      if (lowStockNotifications && canUseLowStock) {
        pushEnabled = await notificationService.enableLowStockPush(profile.id);
      }
      if (!pushEnabled) {
        await notificationService.disableLowStockPush(profile.id);
      }
    } catch (error) {
      setLoading(false);
      Alert.alert('Could not update push notifications', (error as Error).message);
      return;
    }
    const values = {
      enabled: expirationNotifications,
      days_before: daysBefore,
      recipe_notifications: profile.account_type === 'establishment' ? false : recipeNotifications,
      grocery_notifications: groceryNotifications,
      weekly_summary: weeklySummary,
      low_stock_enabled: lowStockNotifications,
      sms_enabled: smsEnabled && verifiedPhone,
      sms_low_stock: smsLowStock,
      sms_expiration: smsExpiration,
      sms_subscription: smsSubscription,
      updated_at: new Date().toISOString(),
    };
    const { data: existing, error: readError } = await supabase
      .from('notification_preferences')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (readError) {
      setLoading(false);
      Alert.alert('Could not save', readError.message);
      return;
    }

    const { error } = existing
      ? await supabase.from('notification_preferences').update(values).eq('id', existing.id)
      : await supabase.from('notification_preferences').insert({ user_id: profile.id, ...values });
    setLoading(false);
    if (error) {
      Alert.alert('Could not save', error.message);
    } else {
      const message = !lowStockNotifications
        ? 'Notification settings updated.'
        : pushEnabled
          ? 'Low-stock alerts are enabled, including system push notifications.'
          : canUseLowStock
            ? 'Low-stock alerts are enabled in the app. Allow notifications on this device to see system notifications.'
            : 'Low-stock alerts are enabled. They appear when the app is open or returns to the foreground.';
      Alert.alert('Saved', message);
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
      label: 'Low Stock Alerts',
      sub: canUseLowStock
        ? 'Notify when stock reaches its threshold; Pro also supports push when the app is closed'
        : 'Notify when stock reaches its threshold while the app is open',
      value: lowStockNotifications,
      set: changeLowStockPreference,
      disabled: false,
    },
  ];

  return (
    <View style={styles.container}>
      <NavHeader title="Notifications" subtitle="Choose what you want to hear about" />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.xl, paddingHorizontal: gutter }}>
        <View style={[styles.card, { padding: spacing.lg, marginBottom: spacing.md }]}>
          <SectionHeader title="SMS notifications" />
          <Text style={styles.settingSub}>Use your verified Philippine number. SMS alerts work while KeepFresh is closed.</Text>
          <View style={styles.phoneRow}>
            <Text style={styles.phonePrefix}>+63</Text>
            <TextInput value={smsPhone} onChangeText={(v) => { setSmsPhone(v.replace(/\D/g, '').replace(/^63/, '').replace(/^0/, '').slice(0,10)); setVerifiedPhone(false); }} keyboardType="phone-pad" placeholder="9XX XXX XXXX" style={styles.phoneInput} />
          </View>
          {verifiedPhone ? <Text style={styles.settingSub}>Phone verified</Text> : <PillButton title="Send verification code" onPress={verifyPhone} style={{ marginTop: spacing.sm }} />}
          {otpSent && <View style={styles.phoneRow}><TextInput value={smsCode} onChangeText={(v) => setSmsCode(v.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" placeholder="6 digit code" style={styles.phoneInput}/><PillButton title="Verify" onPress={confirmPhoneCode}/></View>}
          {[['All SMS alerts',smsEnabled,setSmsEnabled],['Low stock',smsLowStock,setSmsLowStock],['Food expiration (3, 1, 0 days)',smsExpiration,setSmsExpiration],['Subscription updates',smsSubscription,setSmsSubscription]].map(([label,value,set] : any) => <View key={label} style={styles.settingRow}><View style={{flex:1}}><Text style={styles.settingLabel}>{label}</Text></View><Switch value={value} onValueChange={set} disabled={!verifiedPhone || (!smsEnabled && label !== 'All SMS alerts')} trackColor={{false:colors.border,true:colors.primary}} thumbColor={colors.surface}/></View>)}
          <PillButton title="SMS history" onPress={() => router.push('/settings/sms-history')} style={{ marginTop: spacing.sm }} />
        </View>
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
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  phonePrefix: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  phoneInput: { flex: 1, height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, color: colors.textPrimary },
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
