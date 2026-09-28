import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { Mail, KeyRound, Crown, ChevronRight } from 'lucide-react-native';
import {
  NavHeader,
  Field,
  PillButton,
  ListRow,
  StatusBadge,
  UsageMeter,
  IconBadge,
} from '../../src/components/ui';
import { describeStatus, daysRemaining } from '../../src/services/subscriptionService';
import { usePageGutter } from '../../src/hooks/useContentLayout';

export default function AccountSettingsScreen() {
  const { gutter } = usePageGutter();
  const { profile, updateProfile, resetPassword } = useAuth();
  const { entitlements } = useSubscription();
  const router = useRouter();
  const [name, setName] = useState(profile?.full_name || '');
  const [loading, setLoading] = useState(false);

  const planStatus = describeStatus(entitlements);
  const daysLeft = daysRemaining(entitlements?.current_period_end);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter your full name.');
      return;
    }
    setLoading(true);
    const { error } = await updateProfile({ full_name: name.trim() });
    setLoading(false);
    if (error) {
      Alert.alert('Could not save', error.message);
    } else {
      Alert.alert('Saved', 'Your name has been updated.');
    }
  };

  const sendReset = async () => {
    if (!profile?.email) return;
    const { error } = await resetPassword(profile.email);
    if (error) {
      Alert.alert('Could not send link', error.message);
    } else {
      Alert.alert('Check your inbox', `A password reset link was sent to ${profile.email}.`);
    }
  };

  return (
    <View style={styles.container}>
      <NavHeader title="Account Settings" subtitle="Manage your personal information" />
      <ScrollView contentContainerStyle={{ paddingVertical: spacing.xl, paddingHorizontal: gutter }} keyboardShouldPersistTaps="handled">
        {/* Plan first: it is the thing people come to this screen to check, and
            it is the only row here that leads somewhere with a live counter. */}
        <Pressable
          onPress={() => router.push('/subscription')}
          accessibilityRole="button"
          accessibilityLabel={`Subscription plan: ${entitlements?.plan_name ?? 'loading'}`}
          style={({ pressed }) => [styles.planCard, pressed && { opacity: 0.92 }]}
        >
          <View style={styles.planTop}>
            <IconBadge color={colors.primary} size={40}>
              <Crown size={19} color={colors.primary} strokeWidth={2.3} />
            </IconBadge>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.planName} numberOfLines={1}>
                {entitlements?.plan_name ?? 'Loading your plan…'}
              </Text>
              <Text style={styles.planMeta} numberOfLines={1}>
                {entitlements
                  ? entitlements.is_active
                    ? `${formatMoney(entitlements.price_php)} · ${Math.max(daysLeft, 0)} days left`
                    : 'Plan ended — premium features are paused'
                  : '—'}
              </Text>
            </View>
            <StatusBadge label={planStatus.label} tone={planStatus.tone} />
            <ChevronRight size={18} color={colors.textSecondary} />
          </View>

          {entitlements && (
            <View style={styles.planMeters}>
              <UsageMeter
                label="Products"
                used={entitlements.products_used}
                limit={entitlements.max_products}
                style={{ flex: 1 }}
              />
              <UsageMeter
                label="AI scans"
                used={entitlements.ai_scans_used}
                limit={entitlements.max_ai_scans}
                style={{ flex: 1 }}
              />
            </View>
          )}
        </Pressable>

        <Field label="Full Name" value={name} onChangeText={setName} placeholder="Your full name" autoCapitalize="words" />

        <View style={styles.readonly}>
          <Mail size={18} color={colors.textSecondary} strokeWidth={2} style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.readonlyLabel}>Email</Text>
            <Text style={styles.readonlyValue}>{profile?.email || '—'}</Text>
          </View>
        </View>
        <Text style={styles.hint}>Email is used to sign in and can't be changed here.</Text>

        <View style={styles.card}>
          <ListRow icon={KeyRound} label="Change password" hint="We'll email you a reset link" onPress={sendReset} chevron />
        </View>

        <PillButton title="Save Changes" onPress={handleSave} loading={loading} style={{ marginTop: spacing.lg }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  planMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  planMeters: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  readonly: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.sm, paddingHorizontal: 14, minHeight: 52,
  },
  readonlyLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  readonlyValue: { fontSize: 15, color: colors.textPrimary, marginTop: 1 },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: 6, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, ...shadow.card,
  },
});

function formatMoney(value: number): string {
  return `₱${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
