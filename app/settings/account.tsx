import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING } from '../../src/theme';
import { Mail, KeyRound } from 'lucide-react-native';
import { NavHeader, Field, PillButton, ListRow } from '../../src/components/ui';

export default function AccountSettingsScreen() {
  const { profile, updateProfile, resetPassword } = useAuth();
  const [name, setName] = useState(profile?.full_name || '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Missing name', 'Please enter your full name.');
      return;
    }
    setLoading(true);
    const { error } = await updateProfile({ full_name: name.trim() });
    setLoading(false);
    if (error) {
      Alert.alert('Could not save', error.message);
    } else {
      Alert.alert('Saved', 'Your name has been updated.');
    }
  };

  const sendReset = async () => {
    if (!profile?.email) return;
    const { error } = await resetPassword(profile.email);
    if (error) {
      Alert.alert('Could not send link', error.message);
    } else {
      Alert.alert('Check your inbox', `A password reset link was sent to ${profile.email}.`);
    }
  };

  return (
    <View style={styles.container}>
      <NavHeader title="Account Settings" subtitle="Manage your personal information" />
      <ScrollView contentContainerStyle={{ padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
        <Field label="Full Name" value={name} onChangeText={setName} placeholder="Your full name" autoCapitalize="words" />

        <View style={styles.readonly}>
          <Mail size={18} color={COLORS.secondaryText} strokeWidth={2} style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.readonlyLabel}>Email</Text>
            <Text style={styles.readonlyValue}>{profile?.email || '—'}</Text>
          </View>
        </View>
        <Text style={styles.hint}>Email is used to sign in and can't be changed here.</Text>

        <View style={styles.card}>
          <ListRow icon={KeyRound} label="Change password" hint="We'll email you a reset link" onPress={sendReset} chevron />
        </View>

        <PillButton title="Save Changes" onPress={handleSave} loading={loading} style={{ marginTop: SPACING.lg }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  readonly: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.divider,
    borderRadius: 8, paddingHorizontal: 14, minHeight: 52,
  },
  readonlyLabel: { fontSize: 11, color: COLORS.secondaryText, fontWeight: '600' },
  readonlyValue: { fontSize: 15, color: COLORS.text, marginTop: 1 },
  hint: { fontSize: 12, color: COLORS.secondaryText, marginTop: 6, marginBottom: SPACING.lg },
  card: {
    backgroundColor: COLORS.white, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
});
