import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Leaf } from 'lucide-react-native';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { COLORS, SPACING, RADII } from '../src/theme';

/**
 * Session gate.
 *
 * - While the persisted Supabase session is being restored we show a branded
 *   splash so the login form never flashes for a returning user.
 * - A logged-in user on the login/signup screens is pushed to the Home tab.
 * - A logged-out user anywhere outside the (auth) group is sent to Login
 *   (this is also what makes Logout land on the Login screen).
 */
function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const inAuthGroup = segments[0] === '(auth)';
  const onLoginOrSignup = segments[1] === 'login' || segments[1] === 'signup';

  // True when the visible screen doesn't match the session state yet - we keep
  // the splash covering until navigation has parked us on the right screen.
  const mismatch =
    (!user && !inAuthGroup) || // logged out, but on a protected screen
    (!!user && onLoginOrSignup); // logged in, but idle on a login form

  useEffect(() => {
    if (loading) return;
    if (!user && !inAuthGroup) {
      router.replace('/login');
    } else if (user && onLoginOrSignup) {
      router.replace('/(tabs)');
    }
  }, [loading, user, inAuthGroup, onLoginOrSignup, router]);

  const covering = loading || mismatch;

  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/signup" />
        <Stack.Screen name="(auth)/forgot-password" />
        <Stack.Screen name="(auth)/reset-password" />
      </Stack>

      {covering && (
        <View style={styles.splash}>
          <View style={styles.logoBadge}>
            <Leaf size={34} color={COLORS.primary} strokeWidth={2.2} />
          </View>
          <Text style={styles.brand}>KeepFresh AI</Text>
          <ActivityIndicator color={COLORS.white} style={{ marginTop: SPACING.lg }} />
        </View>
      )}
    </View>
  );
}

export default function Layout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  logoBadge: {
    width: 76,
    height: 76,
    borderRadius: RADII.icon * 2,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
    transform: [{ rotate: '-8deg' }],
  },
  brand: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.white,
    letterSpacing: -0.4,
  },
});
