import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ActivityIndicator, ScrollView,
  Platform, Pressable, Image, useWindowDimensions, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { Mail, Lock, ArrowRight, Home, Store } from 'lucide-react-native';
import { Field, PillButton } from '../../src/components/ui';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [typeVisible, setTypeVisible] = useState(false);
  const { signIn, signInWithGoogle, signInWithFacebook } = useAuth();

  // Responsive logo: scales with the screen width, clamped for very large/small.
  const logoSize = Math.max(72, Math.min(Math.round(width * 0.24), 120));
  const logoRadius = Math.round(logoSize * 0.22); // rounded square, not sharp

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) Alert.alert('Login failed', error.message);
  };

  const run = async (fn: () => Promise<{ error: Error | null }>, failTitle: string) => {
    setLoading(true);
    const { error } = await fn();
    setLoading(false);
    if (error) Alert.alert(failTitle, error.message);
  };

  const chooseType = (type: 'household' | 'establishment') => {
    setTypeVisible(false);
    router.push({ pathname: '/signup', params: { type } });
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
        <View style={styles.header}>
          <View
            style={[
              styles.logoWrap,
              {
                width: logoSize,
                height: logoSize,
                borderRadius: logoRadius,
                shadowRadius: logoSize * 0.08,
                elevation: Math.min(5, logoSize * 0.04),
              },
            ]}
          >
            <Image
              source={require('../../assets/images/keepfresh-logo-only.png')}
              style={{ width: logoSize, height: logoSize, borderRadius: logoRadius }}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.logo}>KeepFresh AI</Text>
          <Text style={styles.subtitle}>
            Track your food, reduce waste,{'\n'}and save more — in one place.
          </Text>
        </View>

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
          <Field
            label="Password"
            icon={Lock}
            secure
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            autoCapitalize="none"
          />

          <Pressable style={styles.forgot} onPress={() => router.push('/forgot-password')}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>

          <PillButton title="Login" onPress={handleLogin} loading={loading} icon={ArrowRight} />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.socialRow}>
            <Pressable
              style={styles.socialBtn}
              disabled={loading}
              onPress={() => run(signInWithGoogle, 'Google sign-in failed')}
            >
              <View style={styles.gBadge}><Text style={styles.gText}>G</Text></View>
              <Text style={styles.socialText}>Google</Text>
            </Pressable>
            <Pressable
              style={styles.socialBtn}
              disabled={loading}
              onPress={() => run(signInWithFacebook, 'Facebook sign-in failed')}
            >
              <View style={styles.fBadge}><Text style={styles.fText}>f</Text></View>
              <Text style={styles.socialText}>Facebook</Text>
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
            <Pressable onPress={() => setTypeVisible(true)} hitSlop={8}>
              <Text style={styles.footerLink}>Sign up</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Account type picker - pops up when tapping "Sign up" */}
      <Modal
        visible={typeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTypeVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setTypeVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Create your account</Text>
            <Text style={styles.modalSubtitle}>What best describes you?</Text>

            <Pressable style={styles.modalOption} onPress={() => chooseType('household')}>
              <View style={styles.modalOptionIcon}>
                <Home size={20} color={COLORS.white} strokeWidth={2} />
              </View>
              <View style={styles.modalOptionText}>
                <Text style={styles.modalOptionTitle}>Household</Text>
                <Text style={styles.modalOptionDesc}>For my home kitchen</Text>
              </View>
              <ArrowRight size={18} color={COLORS.primary} />
            </Pressable>

            <Pressable style={styles.modalOption} onPress={() => chooseType('establishment')}>
              <View style={styles.modalOptionIcon}>
                <Store size={20} color={COLORS.white} strokeWidth={2} />
              </View>
              <View style={styles.modalOptionText}>
                <Text style={styles.modalOptionTitle}>Food Establishment</Text>
                <Text style={styles.modalOptionDesc}>For a restaurant or business</Text>
              </View>
              <ArrowRight size={18} color={COLORS.primary} />
            </Pressable>

            <Pressable style={styles.modalCancel} onPress={() => setTypeVisible(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  header: { alignItems: 'center', marginBottom: SPACING.xl },
  logoWrap: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
  },
  logo: { fontSize: 30, fontWeight: '800', color: COLORS.primaryDark, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 21, marginTop: SPACING.sm },
  form: { width: '100%' },
  forgot: { alignSelf: 'flex-end', marginBottom: SPACING.lg },
  forgotText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.lg },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: COLORS.divider },
  dividerText: { color: COLORS.secondaryText, fontSize: 12, marginHorizontal: SPACING.md },
  socialRow: { flexDirection: 'row', gap: SPACING.md },
  socialBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
    borderRadius: RADII.input, height: 50,
  },
  gBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center' },
  gText: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  fBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#1877F2', alignItems: 'center', justifyContent: 'center' },
  fText: { color: COLORS.white, fontSize: 12, fontWeight: '800' },
  socialText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.xl },
  footerText: { color: COLORS.secondaryText, fontSize: 14 },
  footerLink: { color: COLORS.primary, fontWeight: '700', marginLeft: SPACING.xs, fontSize: 14 },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
  },
  modalCard: {
    width: '100%', maxWidth: 400,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.lg,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  modalSubtitle: {
    fontSize: 14, color: COLORS.secondaryText, textAlign: 'center',
    marginTop: SPACING.xs, marginBottom: SPACING.md,
  },
  modalOption: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    borderWidth: 1.5, borderColor: COLORS.divider, borderRadius: RADII.card,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  modalOptionIcon: {
    width: 40, height: 40, borderRadius: RADII.icon,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  modalOptionText: { flex: 1 },
  modalOptionTitle: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  modalOptionDesc: { fontSize: 12, color: COLORS.secondaryText, marginTop: 2 },
  modalCancel: { alignItems: 'center', paddingVertical: SPACING.sm, marginTop: SPACING.xs },
  modalCancelText: { color: COLORS.secondaryText, fontSize: 14, fontWeight: '700' },
});
