import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING } from '../../theme';

export default function AccountSettingsScreen() {
  const { profile, updateProfile } = useAuth();
  const [name, setName] = React.useState(profile?.full_name || '');
  const [email, setEmail] = React.useState(profile?.email || '');
  const [loading, setLoading] = React.useState(false);

  const handleSave = async () => {
    setLoading(true);
    await updateProfile({ full_name: name });
    setLoading(false);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive' },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Account Settings</Text>
      
      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} />
        </View>
        
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={loading}>
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.deleteButton} onPress={handleDeleteAccount}>
          <Text style={styles.deleteButtonText}>Delete Account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.lg },
  form: { backgroundColor: COLORS.white, borderRadius: 12, padding: SPACING.lg, gap: SPACING.md },
  inputGroup: { gap: SPACING.xs },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  input: { borderWidth: 1, borderColor: COLORS.divider, borderRadius: 8, padding: SPACING.md, fontSize: 16 },
  saveButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: 8, alignItems: 'center' },
  saveButtonText: { color: COLORS.white, fontWeight: '600' },
  deleteButton: { marginTop: SPACING.md, padding: SPACING.md, alignItems: 'center' },
  deleteButtonText: { color: COLORS.danger },
});