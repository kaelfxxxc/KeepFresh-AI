import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { COLORS, RADII, SPACING } from '../../src/theme';
import { Mail, KeyRound, Crown, ChevronRight } from 'lucide-react-native';
import {
  NavHeader,
  Field,
  PillButton,
  ListRow,
  StatusBadge,
  UsageMeter,
} from '../../src/components/ui';
import { describeStatus, daysRemaining } from '../../src/services/subscriptionService';

export default function AccountSettingsScreen() {
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
      <ScrollView contentContainerStyle={{ padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
        {/* Plan first: it is the thing people come to this screen to check, and
            it is the only row here that leads somewhere with a live counter. */}
        <Pressable
          onPress={() => router.push('/subscription')}
          accessibilityRole="button"
          accessibilityLabel={`Subscription plan: ${entitlements?.plan_name ?? 'loading'}`}
          style={({ pressed }) => [styles.planCard, pressed && { opacity: 0.92 }]}
        >
          <View style={styles.planTop}>
            <View style={styles.planIconWrap}>
              <Crown size={19} color={COLORS.primary} strokeWidth={2.3} />
            </View>
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
            <ChevronRight size={18} color={COLORS.secondaryText} />
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
          <Mail size={18} color={COLORS.secondaryText} strokeWidth={2} style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.readonlyLabel}>Email</Text>
            <Text style={styles.readonlyValue}>{profile?.email || '—'}</Text>
          </View>
        </View>
        <Text style={styles.hint}>Email is used to sign in and can't be changed here.</Text>

        <View style={styles.card}>
          <ListRow icon={KeyRound} label="Change password" hint="We'll email you a reset link" onPress={sendReset} chevron />
        </View>

        <PillButton title="Save Changes" onPress={handleSave} loading={loading} style={{ marginTop: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  planCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADII.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIconWrap: {
    width: 38,
    height: 38,
    borderRadius: RADII.icon,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  planMeta: { fontSize: 12, color: COLORS.secondaryText, marginTop: 1 },
  planMeters: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  readonly: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
    borderRadius: 8, paddingHorizontal: 14, minHeight: 52,
  },
  readonlyLabel: { fontSize: 11, color: COLORS.secondaryText, fontWeight: '600' },
  readonlyValue: { fontSize: 15, color: COLORS.text, marginTop: 1 },
  hint: { fontSize: 12, color: COLORS.secondaryText, marginTop: 6, marginBottom: SPACING.lg },
  card: {
    backgroundColor: COLORS.white, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
});

function formatMoney(value: number): string {
  return `₱${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
