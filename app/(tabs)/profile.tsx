import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';
import {
  UserRound, Bell, SlidersHorizontal, HelpCircle, Info, LogOut, Camera,
  Home, Store, Crown, Refrigerator, Tag, Users, Boxes,
} from 'lucide-react-native';
import { AvatarCircle, ListRow, PillButton, StatusBadge } from '../../src/components/ui';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { describeStatus, daysRemaining } from '../../src/services/subscriptionService';

const MENU: { label: string; icon: any; path: string; hint?: string }[] = [
  { label: 'Account Settings', icon: UserRound, path: '/settings/account', hint: 'Personal information' },
  { label: 'Notification Settings', icon: Bell, path: '/settings/notifications', hint: 'Alerts & reminders' },
  { label: 'Units & Preferences', icon: SlidersHorizontal, path: '/settings/preferences', hint: 'Units, currency, language' },
  { label: 'Help & Support', icon: HelpCircle, path: '/settings/help' },
  { label: 'About KeepFresh AI', icon: Info, path: '/settings/about' },
];

/** A tool row plus the plan badge to show when it is not in the current plan. */
interface Tool {
  label: string;
  icon: any;
  path: string;
  hint?: string;
  badge?: string;
}

export default function ProfileScreen() {
  const { profile, signOut, updateProfile } = useAuth();
  const { entitlements, gates } = useSubscription();
  const insets = useSafeAreaInsets();
  // The bottom nav floats over this screen. This screen used to pad a flat 120
  // to clear the old fixed bar; the bar's real height and offset are the only
  // thing that can say how much room it actually needs.
  const { contentInset } = useFloatingTabBar();
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url || null);

  const isEstablishment = profile?.account_type === 'establishment';

  // The tools the plan gates, listed whether or not they are unlocked — the
  // badge says which tier opens them, and the screen itself explains why.
  // Staff and bulk operations belong to Food Establishment plans only, so they
  // are not offered to a household account that could never buy them.
  const tools: Tool[] = [
    { label: 'Storage Areas', icon: Refrigerator, path: '/storage-areas', hint: 'Fridge, freezer, pantry' },
    {
      label: 'Price Tracking', icon: Tag, path: '/price-tracking', hint: 'What your groceries cost',
      badge: gates.priceTracking.allowed ? undefined : 'Premium',
    },
    ...(isEstablishment
      ? ([
          {
            label: 'Staff & Roles', icon: Users, path: '/staff', hint: 'Owner, manager, staff',
            badge: gates.staffManagement.allowed ? undefined : 'Pro',
          },
          {
            label: 'Bulk Inventory', icon: Boxes, path: '/bulk-inventory', hint: 'Many items at once',
            badge: gates.bulkInventory.allowed ? undefined : 'Pro',
          },
        ] as Tool[])
      : []),
  ];

  const planStatus = describeStatus(entitlements);
  const daysLeft = daysRemaining(entitlements?.current_period_end);
  const planHint = !entitlements
    ? 'Loading…'
    : entitlements.is_active
      ? `${entitlements.products_used} / ${entitlements.max_products} products · ${entitlements.ai_scans_used} / ${entitlements.max_ai_scans} AI scans · ${Math.max(daysLeft, 0)} days left`
      : 'Plan ended — upgrade to restore premium features';

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

  return (
    // The safe-area inset goes on a plain wrapper, never on the ScrollView's own
    // `style`. Padding there is applied to the scroll view itself and iOS lays its
    // content out ignoring it, so the title rendered at y=0 — up behind the status
    // bar — and scrolled content slid underneath it. Same shape as the Inventory
    // tab, and as the dashboard.
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: contentInset }}
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
          <View style={styles.accountBadge}>
            {profile?.account_type === 'establishment' ? (
              <Store size={14} color={COLORS.primary} strokeWidth={2.2} />
            ) : (
              <Home size={14} color={COLORS.primary} strokeWidth={2.2} />
            )}
            <Text style={styles.accountBadgeText}>
              {profile?.account_type === 'establishment' ? 'Food Establishment' : 'Household'}
            </Text>
          </View>
        </View>

        {/* Plan — its own block because the status badge is the point of it. */}
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Subscription</Text>
          <View style={styles.menuCard}>
            <ListRow
              icon={Crown}
              label={entitlements?.plan_name ?? 'Your plan'}
              hint={planHint}
              onPress={() => router.push('/subscription')}
              right={<StatusBadge label={planStatus.label} tone={planStatus.tone} />}
            />
          </View>
        </View>

        {/* Tools — the plan-gated ones appear with the tier that unlocks them. */}
        <View style={styles.block}>
          <Text style={styles.blockLabel}>{isEstablishment ? 'Stock & team' : 'Inventory tools'}</Text>
          <View style={styles.menuCard}>
            {tools.map((item, i) => (
              <View key={item.path}>
                {i > 0 && <View style={styles.sep} />}
                <ListRow
                  icon={item.icon}
                  label={item.label}
                  hint={item.hint}
                  onPress={() => router.push(item.path as any)}
                  right={item.badge ? <StatusBadge label={item.badge} tone="neutral" /> : undefined}
                />
              </View>
            ))}
          </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  // The scroll view fills the wrapper; the inset lives on the wrapper's padding.
  scroll: { flex: 1 },
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
  accountBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADII.icon,
    paddingVertical: 5, paddingHorizontal: 12,
  },
  accountBadgeText: { color: COLORS.primaryDark, fontSize: 13, fontWeight: '800' },
  block: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  blockLabel: {
    fontSize: 13, fontWeight: '700', color: COLORS.secondaryText,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SPACING.sm,
  },
  menuCard: {
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
    ...({ borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider } as any),
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.divider, marginLeft: 52 },
});
