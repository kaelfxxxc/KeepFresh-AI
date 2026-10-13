import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView, Pressable, TextInput,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { UserRound, Mail, Lock, Home, Store } from 'lucide-react-native';
import { Field, PillButton } from '../../src/components/ui';

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Account type is chosen on the account-type screen (before the form).
  const { type } = useLocalSearchParams<{ type?: string }>();
  const accountType: 'household' | 'establishment' = type === 'establishment' ? 'establishment' : 'household';
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();

  const handleSignUp = async () => {
    if (!fullName.trim() || !phoneNumber.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert('Missing details', 'Please fill in all fields.');
      return;
    }
    const mobile = phoneNumber.replace(/\D/g, '').replace(/^0/, '');
    if (!/^9\d{9}$/.test(mobile)) {
      Alert.alert('Invalid PH mobile number', 'Enter a 10-digit Philippine mobile number starting with 9.');
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
    const { error, requiresEmailConfirmation } = await signUp(
      email.trim(),
      password,
      fullName.trim(),
      accountType,
      `+63${mobile}`,
    );
    setLoading(false);
    if (error) {
      Alert.alert('Sign up failed', error.message);
    } else if (requiresEmailConfirmation) {
      Alert.alert(
        'Check your email',
        'We sent you a confirmation link. Confirm it, then log in.',
        [{ text: 'OK', onPress: () => router.replace('/login') }]
      );
    } else {
      Alert.alert('Welcome to KeepFresh AI!', 'Your account is ready.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') },
      ]);
    }
  };

  // The inset belongs on the wrapper, not on the ScrollView's own `style`:
  // padding there is applied to the scroll view itself and iOS lays its content
  // out ignoring it, which pushed the centred form up under the status bar.
  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + SPACING.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <View style={styles.header}>
          <Text style={styles.logo}>Create account</Text>
          <Text style={styles.subtitle}>Join KeepFresh AI and start wasting less.</Text>
        </View>

        {/* Account type - chosen on the previous step, read-only here */}
        <Pressable style={styles.typeChip} onPress={() => router.replace('/account-type')}>
          <View style={styles.typeChipIcon}>
            {accountType === 'establishment' ? (
              <Store size={15} color={COLORS.primary} strokeWidth={2} />
            ) : (
              <Home size={15} color={COLORS.primary} strokeWidth={2} />
            )}
          </View>
          <Text style={styles.typeChipText}>
            {accountType === 'establishment' ? 'Food Establishment' : 'Household'}
          </Text>
          <Text style={styles.typeChipEdit}>Change</Text>
        </Pressable>

        <View style={styles.form}>
          <Field
            label="Full Name *"
            icon={UserRound}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Enter your full name"
            autoCapitalize="words"
          />
          <View style={styles.phoneField}>
            <Text style={styles.phoneLabel}>PH Mobile Number *</Text>
            <View style={styles.phoneInputRow}>
              <View style={styles.phonePrefix}><Text style={styles.phonePrefixText}>+63</Text></View>
              <TextInput
                value={phoneNumber}
                onChangeText={(value) => setPhoneNumber(value.replace(/\D/g, '').replace(/^63/, '').replace(/^0/, '').slice(0, 10))}
                placeholder="9XX XXX XXXX"
                placeholderTextColor={COLORS.secondaryText}
                keyboardType="phone-pad"
                autoComplete="tel-national"
                style={styles.phoneInput}
              />
            </View>
            <Text style={styles.phoneHint}>Enter the 10 digits after +63.</Text>
          </View>
          <Field
            label="Email *"
            icon={Mail}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Field
            label="Password *"
            icon={Lock}
            secure
            value={password}
            onChangeText={setPassword}
            placeholder="Create a password (min 6 characters)"
          />
          <Field
            label="Confirm Password *"
            icon={Lock}
            secure
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter your password"
          />

          <PillButton title="Create Account" onPress={handleSignUp} loading={loading} style={{ marginTop: SPACING.sm }} />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <Pressable onPress={() => router.push('/login')} hitSlop={8}>
              <Text style={styles.footerLink}>Login</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.lg,
  },
  header: { marginTop: SPACING.xl, marginBottom: SPACING.lg },
  logo: { fontSize: 28, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.secondaryText, marginTop: SPACING.xs },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    alignSelf: 'flex-start', marginBottom: SPACING.lg,
    backgroundColor: COLORS.primaryLight, borderRadius: RADII.icon,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  typeChipIcon: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center',
  },
  typeChipText: { color: COLORS.primaryDark, fontSize: 13, fontWeight: '800' },
  typeChipEdit: { color: COLORS.primary, fontSize: 12, fontWeight: '700', marginLeft: 4, textDecorationLine: 'underline' },
  form: { width: '100%' },
  phoneField: { marginBottom: SPACING.md },
  phoneLabel: { color: COLORS.text, fontSize: 13, fontWeight: '600', marginBottom: SPACING.xs },
  phoneInputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  phonePrefix: { height: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: COLORS.divider, borderRadius: RADII.input, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.white },
  phonePrefixText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  phoneInput: { flex: 1, minHeight: 50, borderWidth: 1, borderColor: COLORS.divider, borderRadius: RADII.input, backgroundColor: COLORS.white, paddingHorizontal: 14, color: COLORS.text, fontSize: 15 },
  phoneHint: { color: COLORS.secondaryText, fontSize: 11, marginTop: 5 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.xl },
  footerText: { color: COLORS.secondaryText, fontSize: 14 },
  footerLink: { color: COLORS.primary, fontWeight: '700', marginLeft: SPACING.xs, fontSize: 14 },
});
