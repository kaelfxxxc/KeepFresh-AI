import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ScrollView, Pressable,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING } from '../../src/theme';
import { UserRound, Mail, Lock, Camera, Check } from 'lucide-react-native';
import { Field, PillButton, AvatarCircle } from '../../src/components/ui';

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
    const { error } = await signUp(email.trim(), password, fullName.trim());
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
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={[styles.container, { paddingTop: insets.top }]}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + SPACING.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.logo}>Create account</Text>
          <Text style={styles.subtitle}>Join KeepFresh AI and start wasting less.</Text>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.lg },
  header: { marginTop: SPACING.xl, marginBottom: SPACING.lg },
  logo: { fontSize: 28, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 14, color: COLORS.secondaryText, marginTop: SPACING.xs },
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
