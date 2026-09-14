import React, { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, Text, StyleSheet, Animated, Easing, ActivityIndicator, ScrollView } from 'react-native';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { SubscriptionProvider } from '../src/context/SubscriptionContext';
import { supabaseConfig } from '../src/lib/supabase';
import AnimatedSplash from '../src/components/AnimatedSplash';
import { notificationService } from '../src/services/notificationService';
import { useNotificationTaps } from '../src/hooks/useNotificationTaps';

const DEEP_GREEN = '#168A45';

/**
 * Session gate + launch splash.
 *
 * - On cold start the AnimatedSplash plays (min ~2.35s) while the persisted
 *   Supabase session is restored, then fades into the app.
 * - A logged-in user on the login/signup screens is pushed to the Home tab.
 * - A logged-out user anywhere outside the (auth) group is sent to Login
 *   (this is also what makes Logout land on the Login screen).
 * - Brief login/logout transitions show a compact spinner cover instead of
 *   replaying the full animated splash.
 */
function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const coverOpacity = useRef(new Animated.Value(1)).current;

  const [minTime, setMinTime] = useState(false); // animated splash played
  const [booted, setBooted] = useState(false); // boot cover allowed to lift
  const [fadingDone, setFadingDone] = useState(false); // boot cover fully gone

  const inAuthGroup = segments[0] === '(auth)';
  const onLoginOrSignup = segments[1] === 'login' || segments[1] === 'signup';

  // Reminders shown while the app is open are only displayed at all once a
  // foreground handler is registered — see `enableForegroundPresentation`.
  // This effect is on the root navigator, so it lands before any child screen's
  // sweep can present one.
  useEffect(() => {
    notificationService.enableForegroundPresentation();
  }, []);

  // Tapping a reminder opens the screen it is about. Gated on the session so a
  // tap that launched the app waits for the user to be restored rather than
  // being redirected to Login.
  useNotificationTaps(!loading && !!user);

  // True when the visible screen doesn't match the session state yet.
  const mismatch =
    (!user && !inAuthGroup) || // logged out, but on a protected screen
    (!!user && onLoginOrSignup); // logged in, but idle on a login form

  // Give the splash its full ~2.35s even when the session restores instantly.
  useEffect(() => {
    const t = setTimeout(() => setMinTime(true), 2350);
    return () => clearTimeout(t);
  }, []);

  // Redirect to the correct area once the session is known.
  useEffect(() => {
    if (loading) return;
    if (!user && !inAuthGroup) {
      router.replace('/login');
    } else if (user && onLoginOrSignup) {
      router.replace('/(tabs)');
    }
  }, [loading, user, inAuthGroup, onLoginOrSignup, router]);

  // Boot cover lifts once the session is restored AND the splash finished.
  useEffect(() => {
    if (!loading && minTime && !booted) setBooted(true);
  }, [loading, minTime, booted]);

  // Drive the cover opacity: full during boot / mismatches, fade otherwise.
  useEffect(() => {
    if (!booted) {
      coverOpacity.setValue(1);
      return;
    }
    if (mismatch) {
      coverOpacity.setValue(1);
      setFadingDone(false);
      return;
    }
    if (fadingDone) return;
    const anim = Animated.timing(coverOpacity, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setFadingDone(true);
    });
    return () => anim.stop();
  }, [booted, mismatch, fadingDone, coverOpacity]);

  const renderOverlay = !fadingDone || (booted && mismatch);
  const showTransitionCover = booted && mismatch;

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

      {renderOverlay && (
        <Animated.View style={[styles.cover, { opacity: coverOpacity }]}>
          {showTransitionCover ? <CompactCover /> : <AnimatedSplash />}
        </Animated.View>
      )}
    </View>
  );
}

function CompactCover() {
  return (
    <View style={styles.compact}>
      <ActivityIndicator color="#FFFFFF" />
    </View>
  );
}

/**
 * Shown instead of the app when this build has no usable Supabase credentials.
 *
 * It renders before any provider and without the router, because both would
 * reach for the Supabase client during mount — AuthProvider calls
 * `supabase.auth.getSession()` in its first effect, and every route imports a
 * service that does the same. Rendering them here would turn a legible
 * configuration problem back into an unexplained crash.
 */
function ConfigurationErrorScreen({ message }: { message: string }) {
  return (
    <View style={styles.configError}>
      <Text style={styles.configErrorTitle}>Configuration error</Text>
      <Text style={styles.configErrorLead}>
        This build was made without the Supabase settings it needs, so it cannot start.
      </Text>
      <ScrollView style={styles.configErrorScroll} contentContainerStyle={styles.configErrorScrollBody}>
        <Text style={styles.configErrorDetail}>{message}</Text>
      </ScrollView>
    </View>
  );
}

export default function Layout() {
  if (!supabaseConfig.ok) {
    return <ConfigurationErrorScreen message={supabaseConfig.message} />;
  }

  return (
    <AuthProvider>
      {/* Entitlements sit inside Auth so the provider can re-read them whenever
          the signed-in user changes, and outside the navigator so every screen
          — including the auth flow's post-signup screens — can read the plan. */}
      <SubscriptionProvider>
        <RootNavigator />
      </SubscriptionProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DEEP_GREEN },
  cover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  compact: {
    flex: 1,
    backgroundColor: DEEP_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  configError: {
    flex: 1,
    backgroundColor: DEEP_GREEN,
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 32,
  },
  configErrorTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  configErrorLead: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 20,
  },
  configErrorScroll: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    borderRadius: 12,
  },
  configErrorScrollBody: {
    padding: 16,
  },
  configErrorDetail: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'monospace',
  },
});
