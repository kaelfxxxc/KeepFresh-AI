import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView, Pressable,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { UserRound, Mail, Lock, Camera, Check, Home, Store } from 'lucide-react-native';
import { Field, PillButton, AvatarCircle } from '../../src/components/ui';

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [accountType, setAccountType] = useState<'household' | 'establishment'>('household');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please grant photo library access to add a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled) setAvatar(result.assets[0].uri);
  };

  const handleSignUp = async () => {
    if (!fullName.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert('Missing details', 'Please fill in all fields.');
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
    const { error } = await signUp(email.trim(), password, fullName.trim(), accountType);
    setLoading(false);
    if (error) {
      Alert.alert('Sign up failed', error.message);
    } else {
      Alert.alert('Welcome to KeepFresh AI!', 'Your account is ready.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/index') },
      ]);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        style={[styles.container, { paddingTop: insets.top }]}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + SPACING.lg }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <View style={styles.header}>
          <Text style={styles.logo}>Create account</Text>
          <Text style={styles.subtitle}>Join KeepFresh AI and start wasting less.</Text>
        </View>

        {/* Account type - chosen here, shown read-only on Profile */}
        <Text style={styles.typeLabel}>What best describes you?</Text>
        <View style={styles.typeRow}>
          {([
            { value: 'household', icon: Home, title: 'Household', desc: 'For my home kitchen' },
            { value: 'establishment', icon: Store, title: 'Food Establishment', desc: 'For a restaurant or business' },
          ] as const).map((opt) => {
            const active = accountType === opt.value;
            const Icon = opt.icon;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setAccountType(opt.value)}
                style={[styles.typeCard, active ? styles.typeCardActive : styles.typeCardInactive]}
              >
                <View style={[styles.typeIcon, active ? styles.typeIconActive : styles.typeIconInactive]}>
                  <Icon size={20} color={active ? COLORS.white : COLORS.primary} strokeWidth={2} />
                </View>
                <Text style={[styles.typeTitle, active ? styles.typeTitleActive : styles.typeTitleInactive]}>
                  {opt.title}
                </Text>
                <Text style={styles.typeDesc}>{opt.desc}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.form}>
          <View style={styles.avatarWrap}>
            <Pressable onPress={pickAvatar}>
              <AvatarCircle uri={avatar} initials={fullName || 'U'} size={88} />
              <View style={styles.camBadge}>
                {avatar ? <Check size={13} color={COLORS.white} strokeWidth={3} /> : <Camera size={13} color={COLORS.white} strokeWidth={2.5} />}
              </View>
            </Pressable>
            <Text style={styles.avatarHint}>Tap to add a photo</Text>
          </View>

          <Field
            label="Full Name *"
            icon={UserRound}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Enter your full name"
            autoCapitalize="words"
          />
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
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  header: { marginTop: SPACING.xl, marginBottom: SPACING.lg },
  logo: { fontSize: 28, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.secondaryText, marginTop: SPACING.xs },
  typeLabel: {
    fontSize: 13, fontWeight: '700', color: COLORS.secondaryText,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm,
  },
  typeRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  typeCard: {
    flex: 1, borderRadius: RADII.card, padding: SPACING.md,
    alignItems: 'center', gap: 4, borderWidth: 1.5,
  },
  typeCardActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  typeCardInactive: { backgroundColor: COLORS.white, borderColor: COLORS.divider },
  typeIcon: {
    width: 38, height: 38, borderRadius: RADII.icon,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  typeIconActive: { backgroundColor: COLORS.primary },
  typeIconInactive: { backgroundColor: COLORS.primaryLight },
  typeTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  typeTitleActive: { color: COLORS.primaryDark },
  typeTitleInactive: { color: COLORS.text },
  typeDesc: { fontSize: 11, color: COLORS.secondaryText, textAlign: 'center', lineHeight: 15 },
  form: { width: '100%' },
  avatarWrap: { alignItems: 'center', marginBottom: SPACING.lg, position: 'relative' },
  camBadge: {
    position: 'absolute', right: -2, bottom: 2,
    width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.background,
  },
  avatarHint: { fontSize: 12, color: COLORS.secondaryText, marginTop: SPACING.xs },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.xl },
  footerText: { color: COLORS.secondaryText, fontSize: 14 },
  footerLink: { color: COLORS.primary, fontWeight: '700', marginLeft: SPACING.xs, fontSize: 14 },
});
