import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING, RADII } from '../../src/theme';
import {
  UserRound, Bell, SlidersHorizontal, HelpCircle, Info, LogOut, Camera,
} from 'lucide-react-native';
import { AvatarCircle, ListRow, PillButton } from '../../src/components/ui';
import type { Profile } from '../../src/types';

const MENU: { label: string; icon: any; path: string; hint?: string }[] = [
  { label: 'Account Settings', icon: UserRound, path: '/settings/account', hint: 'Personal information' },
  { label: 'Notification Settings', icon: Bell, path: '/settings/notifications', hint: 'Alerts & reminders' },
  { label: 'Units & Preferences', icon: SlidersHorizontal, path: '/settings/preferences', hint: 'Units, currency, language' },
  { label: 'Help & Support', icon: HelpCircle, path: '/settings/help' },
  { label: 'About KeepFresh AI', icon: Info, path: '/settings/about' },
];

export default function ProfileScreen() {
  const { profile, signOut, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url || null);

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please grant photo library permission to change your photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (result.canceled || !profile) return;
    const uri = result.assets[0].uri;
    setAvatarUri(uri);
    const fileName = `${profile.id}/avatar.jpg`;
    try {
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, { uri, name: fileName, type: 'image/jpeg' } as any, { upsert: true });
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
        await updateProfile({ avatar_url: publicUrl });
      } else {
        Alert.alert('Upload failed', uploadError.message);
      }
    } catch {
      Alert.alert('Upload failed', 'Could not upload this photo.');
    }
  };

  const handleSignOut = () => {
    Alert.alert('Logout', 'Are you sure you want to log out of KeepFresh AI?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: signOut },
    ]);
  };

  const setAccountType = async (account_type: Profile['account_type']) => {
    if (!profile || profile.account_type === account_type) return;
    const { error } = await updateProfile({ account_type });
    if (error) Alert.alert('Could not update', error.message);
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 6 }]}
      contentContainerStyle={{ paddingBottom: SPACING.xl }}
    >
      <Text style={styles.title}>Profile</Text>

      {/* Identity */}
      <View style={styles.identityCard}>
        <Pressable onPress={pickAvatar}>
          <View>
            <AvatarCircle uri={avatarUri} initials={profile?.full_name} size={96} />
            <View style={styles.camBadge}>
              <Camera size={14} color={COLORS.white} strokeWidth={2.4} />
            </View>
          </View>
        </Pressable>
        <Text style={styles.name}>{profile?.full_name || 'Your Name'}</Text>
        <Text style={styles.email}>{profile?.email || ''}</Text>
        <Text style={styles.accountPill}>
          {profile?.account_type === 'household' ? 'Household Account' : 'Food Establishment'}
        </Text>
      </View>

      {/* Account type selector */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>Account Type</Text>
        <View style={styles.radioRow}>
          {(['household', 'establishment'] as const).map((t) => {
            const active = profile?.account_type === t;
            return (
              <Pressable
                key={t}
                style={[styles.radio, active ? styles.radioActive : styles.radioInactive]}
                onPress={() => setAccountType(t)}
              >
                <Text style={[styles.radioText, active ? styles.radioTextActive : styles.radioTextInactive]}>
                  {t === 'household' ? 'Household' : 'Food Establishment'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.blockHint}>
          Switching changes how servings and shopping suggestions are tailored for you.
        </Text>
      </View>

      {/* Menu */}
      <View style={styles.block}>
        <Text style={styles.blockLabel}>Settings</Text>
        <View style={styles.menuCard}>
          {MENU.map((item, i) => (
            <View key={item.path}>
              {i > 0 && <View style={styles.sep} />}
              <ListRow icon={item.icon} label={item.label} hint={item.hint} onPress={() => router.push(item.path as any)} />
            </View>
          ))}
        </View>
      </View>

      <PillButton
        title="Logout"
        variant="dangerOutline"
        icon={LogOut}
        onPress={handleSignOut}
        style={{ marginHorizontal: SPACING.lg, marginTop: SPACING.md }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  identityCard: { alignItems: 'center', paddingBottom: SPACING.lg },
  camBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.background,
  },
  name: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginTop: SPACING.sm },
  email: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  accountPill: {
    fontSize: 12, fontWeight: '700', color: COLORS.primary,
    marginTop: SPACING.sm, paddingHorizontal: 14, paddingVertical: 5,
    backgroundColor: COLORS.primaryLight, borderRadius: RADII.pill, overflow: 'hidden',
  },
  block: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  blockLabel: {
    fontSize: 13, fontWeight: '700', color: COLORS.secondaryText,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm,
  },
  radioRow: { flexDirection: 'row', gap: SPACING.sm },
  radio: {
    flex: 1, paddingVertical: 13, borderRadius: RADII.pill, alignItems: 'center',
    borderWidth: 1.5,
  },
  radioActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  radioInactive: { backgroundColor: COLORS.white, borderColor: COLORS.divider },
  radioText: { fontSize: 14, fontWeight: '700' },
  radioTextActive: { color: COLORS.white },
  radioTextInactive: { color: COLORS.secondaryText },
  blockHint: { fontSize: 12, color: COLORS.secondaryText, marginTop: SPACING.sm, lineHeight: 17 },
  menuCard: {
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
    ...({ borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider } as any),
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.divider, marginLeft: 52 },
});
