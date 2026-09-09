import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from '../lib/supabase';

export const notificationService = {
  async requestPermission(): Promise<boolean> {
    if (!Device.isDevice) return false;
    
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  },

  async registerForPushNotificationsAsync(): Promise<string | null> {
    if (!Device.isDevice) return null;
    
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return token;
  },

  async scheduleExpirationNotification(
    userId: string,
    itemId: string,
    title: string,
    message: string,
    secondsFromNow: number
  ): Promise<string | null> {
    try {
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body: message,
          sound: true,
        },
        trigger: {
          seconds: secondsFromNow,
        },
      });
      
      await supabase.from('notification_logs').insert({
        user_id: userId,
        inventory_item_id: itemId,
        notification_type: 'expiration',
        sent_at: new Date().toISOString(),
      });
      
      return identifier;
    } catch (error) {
      console.error('Error scheduling notification:', error);
      return null;
    }
  },

  async cancelNotification(identifier: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },

  async getPermissions(): Promise<Notifications.NotificationPermissionsStatus> {
    return await Notifications.getPermissionsAsync();
  },

  async getNotificationPreferences(userId: string) {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error) throw error;
    return data;
  },

  async updateNotificationPreferences(userId: string, preferences: any): Promise<void> {
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
};