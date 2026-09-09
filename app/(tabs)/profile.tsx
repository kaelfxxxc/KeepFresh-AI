import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING } from '../../src/theme';

export default function ProfileScreen() {
  const { profile, signOut, updateProfile } = useAuth();
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url || null);

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please grant photo library permission');
      return;
    }
    
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setAvatarUri(uri);
      
      const fileName = `${profile?.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, { uri, name: fileName, type: 'image/jpeg' } as any);
      
      if (!uploadError) {
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
        await updateProfile({ avatar_url: publicUrl });
      }
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: signOut },
      ]
    );
  };

  const menuItems = [
    { label: 'Account Settings', icon: '👤', path: '/settings/account' },
    { label: 'Notification Settings', icon: '🔔', path: '/settings/notifications' },
    { label: 'Units & Preferences', icon: '⚙️', path: '/settings/preferences' },
    { label: 'Help & Support', icon: '❓', path: '/settings/help' },
    { label: 'About KeepFresh AI', icon: 'ℹ️', path: '/settings/about' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.profileSection}>
        <TouchableOpacity style={styles.avatarContainer} onPress={pickAvatar}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>👤</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.userName}>{profile?.full_name || 'User'}</Text>
        <Text style={styles.userEmail}>{profile?.email || ''}</Text>
        <Text style={styles.accountType}>
          {profile?.account_type === 'household' ? 'Household Account' : 'Food Establishment'}
        </Text>
      </View>

      <View style={styles.menuSection}>
        {menuItems.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={styles.menuItem}
            onPress={() => router.push(item.path)}
          >
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <Text style={styles.menuLabel}>{item.label}</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  profileSection: { alignItems: 'center', paddingVertical: SPACING.xl, borderBottomColor: COLORS.divider, borderBottomWidth: 1 },
  avatarContainer: { marginBottom: SPACING.md },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 36 },
  userName: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  userEmail: { fontSize: 14, color: COLORS.secondaryText, marginTop: 2 },
  accountType: { fontSize: 12, color: COLORS.primary, marginTop: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, backgroundColor: COLORS.primaryLight, borderRadius: 12 },
  menuSection: { paddingVertical: SPACING.md },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  menuIcon: { fontSize: 20, marginRight: SPACING.md },
  menuLabel: { flex: 1, fontSize: 16, color: COLORS.text },
  menuArrow: { fontSize: 20, color: COLORS.secondaryText },
  logoutButton: { marginHorizontal: SPACING.lg, marginTop: 'auto', marginBottom: SPACING.xl, paddingVertical: SPACING.md, backgroundColor: COLORS.danger, borderRadius: 8, alignItems: 'center' },
  logoutText: { color: COLORS.white, fontWeight: '600', fontSize: 16 },
});