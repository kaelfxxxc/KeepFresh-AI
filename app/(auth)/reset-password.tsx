import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING } from '../../src/theme';
import { Lock, ShieldCheck } from 'lucide-react-native';
import { Field, PillButton } from '../../src/components/ui';

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleReset = async () => {
    if (!password || !confirmPassword) {
      Alert.alert('Missing details', 'Please fill in both password fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Passwords differ', 'Make sure both passwords match.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setDone(true);
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
          <Lock size={26} color={COLORS.primary} strokeWidth={2} />
        </View>
        <Text style={styles.logo}>{done ? 'Password updated' : 'Set a new password'}</Text>
        <Text style={styles.subtitle}>
          {done
            ? 'Your password has been changed. You can now log in with it.'
            : 'Choose a strong password you haven\'t used here before.'}
        </Text>

        {!done && (
          <View style={styles.form}>
            <Field
              label="New Password"
              icon={Lock}
              secure
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
            />
            <Field
              label="Confirm Password"
              icon={ShieldCheck}
              secure
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter your new password"
            />
            <PillButton title="Reset Password" onPress={handleReset} loading={loading} />
          </View>
        )}

        {done && (
          <PillButton title="Back to Login" onPress={() => router.replace('/login')} style={{ marginTop: SPACING.md }} />
        )}
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
});
