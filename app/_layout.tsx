import React, { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View, StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import AnimatedSplash from '../src/components/AnimatedSplash';

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

export default function Layout() {
  return (
    <AuthProvider>
      <RootNavigator />
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
});
