import { Stack } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { AuthProvider } from '../src/context/AuthContext';

export default function Layout() {
  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}