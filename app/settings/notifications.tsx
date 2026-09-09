import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Alert } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING } from '../../src/theme';

export default function NotificationSettingsScreen() {
  const { profile } = useAuth();
  const [expirationNotifications, setExpirationNotifications] = useState(true);
  const [daysBefore, setDaysBefore] = useState(3);
  const [recipeNotifications, setRecipeNotifications] = useState(true);
  const [groceryNotifications, setGroceryNotifications] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(true);

  const handleSave = async () => {
    if (!profile) return;
    
    const { error } = await supabase.from('notification_preferences').upsert({
      user_id: profile.id,
      enabled: expirationNotifications,
      days_before: daysBefore,
      recipe_notifications: recipeNotifications,
      grocery_notifications: groceryNotifications,
      weekly_summary: weeklySummary,
    });
    
    if (error) {
      Alert.alert('Error', 'Unable to save preferences');
    } else {
      Alert.alert('Success', 'Notification settings saved');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notification Settings</Text>
      
      <View style={styles.section}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Expiration Notifications</Text>
          <Switch value={expirationNotifications} onValueChange={setExpirationNotifications} />
        </View>
        
        {expirationNotifications && (
          <View style={styles.daysSelector}>
            <Text style={styles.daysLabel}>Alert days before:</Text>
            {[1, 3, 5, 7].map(days => (
              <TouchableOpacity
                key={days}
                style={[styles.dayOption, daysBefore === days && styles.dayOptionActive]}
                onPress={() => setDaysBefore(days)}
              >
                <Text style={[styles.dayText, daysBefore === days && styles.dayTextActive]}>{days}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Recipe Suggestions</Text>
          <Switch value={recipeNotifications} onValueChange={setRecipeNotifications} />
        </View>
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Grocery Reminders</Text>
          <Switch value={groceryNotifications} onValueChange={setGroceryNotifications} />
        </View>
        
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Weekly Waste Summary</Text>
          <Switch value={weeklySummary} onValueChange={setWeeklySummary} />
        </View>
      </View>
      
      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Text style={styles.saveButtonText}>Save Settings</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.lg },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.lg },
  section: { backgroundColor: COLORS.white, borderRadius: 12, padding: SPACING.lg },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  settingLabel: { fontSize: 15, color: COLORS.text },
  daysSelector: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  daysLabel: { fontSize: 13, color: COLORS.secondaryText },
  dayOption: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 20, backgroundColor: COLORS.background },
  dayOptionActive: { backgroundColor: COLORS.primary },
  dayText: { fontSize: 13, color: COLORS.secondaryText },
  dayTextActive: { color: COLORS.white, fontWeight: '600' },
  saveButton: { backgroundColor: COLORS.primary, padding: SPACING.md, borderRadius: 8, alignItems: 'center', marginTop: SPACING.xl },
  saveButtonText: { color: COLORS.white, fontWeight: '600' },
});