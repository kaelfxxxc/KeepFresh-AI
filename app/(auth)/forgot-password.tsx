import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView, Pressable,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING } from '../../src/theme';
import { Mail, KeyRound, ArrowLeft } from 'lucide-react-native';
import { Field, PillButton } from '../../src/components/ui';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { resetPassword } = useAuth();

  const handleReset = async () => {
    if (!email.trim()) {
      Alert.alert('Missing email', 'Please enter the email on your account.');
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email.trim());
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSubmitted(true);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        style={[styles.container, { paddingTop: insets.top }]}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingBottom: insets.bottom + SPACING.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <View style={styles.iconWrap}>
          <KeyRound size={28} color={COLORS.primary} strokeWidth={2} />
        </View>
        <Text style={styles.logo}>{submitted ? 'Check your inbox' : 'Reset your password'}</Text>
        <Text style={styles.subtitle}>
          {submitted
            ? `We've sent reset instructions to ${email}.\nOpen the link to choose a new password.`
            : 'Enter the email for your account and we\'ll send you a link to reset your password.'}
        </Text>

        {!submitted && (
          <View style={styles.form}>
            <Field
              label="Email"
              icon={Mail}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <PillButton title="Send Reset Link" onPress={handleReset} loading={loading} />
          </View>
        )}

        <Pressable style={styles.back} onPress={() => router.push('/login')}>
          <ArrowLeft size={16} color={COLORS.primary} strokeWidth={2.2} />
          <Text style={styles.backText}>Back to Login</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  iconWrap: {
    alignSelf: 'center', width: 60, height: 60, borderRadius: 20,
    backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  logo: { fontSize: 26, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 21, marginTop: SPACING.sm, marginBottom: SPACING.lg },
  form: { width: '100%' },
  back: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: SPACING.lg, paddingVertical: SPACING.sm,
  },
  backText: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
});
