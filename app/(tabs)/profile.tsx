import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { uploadAvatar } from '../../src/services/avatarService';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';
import {
  UserRound, Bell, SlidersHorizontal, HelpCircle, Info, LogOut, Camera,
  Home, Store, Crown, Refrigerator, Tag, Users, Boxes,
  Package, BarChart3,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import type { ComponentType } from 'react';
import type { Href } from 'expo-router';
import {
  AvatarCircle, ListRow, PillButton, StatusBadge, StatCard, SectionHeader,
} from '../../src/components/ui';
import { useSubscription } from '../../src/context/SubscriptionContext';
import { describeStatus, daysRemaining } from '../../src/services/subscriptionService';
import { usePageGutter } from '../../src/hooks/useContentLayout';

const MENU: { label: string; icon: ComponentType<LucideProps>; path: Href; hint?: string }[] = [
  { label: 'Account Settings', icon: UserRound, path: '/settings/account', hint: 'Personal information' },
  { label: 'Notification Settings', icon: Bell, path: '/settings/notifications', hint: 'Alerts & reminders' },
  { label: 'Units & Preferences', icon: SlidersHorizontal, path: '/settings/preferences', hint: 'Units, currency, language' },
  { label: 'Help & Support', icon: HelpCircle, path: '/settings/help' },
  { label: 'About KeepFresh AI', icon: Info, path: '/settings/about' },
];

/** A tool row plus the plan badge to show when it is not in the current plan. */
interface Tool {
  label: string;
  icon: ComponentType<LucideProps>;
  path: Href;
  hint?: string;
  badge?: string;
}

export default function ProfileScreen() {
  // The page gutter. This screen's blocks each carried the margin themselves;
  // moving it to the scroll container means the column is defined once and the
  // centered avatar block needs no exception.
  const { gutter } = usePageGutter();
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
          {
            label: 'Statistics', icon: BarChart3, path: '/establishment-statistics', hint: 'Order totals and trends',
            badge: gates.establishmentStatistics.allowed ? undefined : 'Premium / Pro',
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
    // Shows the pick immediately, before the upload lands.
    setAvatarUri(uri);
    try {
      // Stored as a path in the private bucket, never `getPublicUrl` — that
      // returns a URL the bucket refuses, which is why the photo used to show
      // here (from local state) and then be missing everywhere it was read back,
      // the dashboard included.
      const path = await uploadAvatar(profile.id, uri, profile.avatar_url);
      const { error } = await updateProfile({ avatar_url: path });
      if (error) throw error;
    } catch (e) {
      // Put back the photo that was actually saved rather than leaving a local
      // file on screen that the account does not have.
      setAvatarUri(profile.avatar_url);
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not upload this photo.');
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
        contentContainerStyle={{ paddingBottom: contentInset, paddingHorizontal: gutter }}
      >
        <Text style={styles.title}>Profile</Text>

        {/* Identity */}
        <View style={styles.identityCard}>
          <Pressable onPress={pickAvatar}>
            <View>
              <AvatarCircle uri={avatarUri} initials={profile?.full_name} size={96} />
              <View style={styles.camBadge}>
                <Camera size={14} color={colors.surface} strokeWidth={2.4} />
              </View>
            </View>
          </Pressable>
          <Text style={styles.name}>{profile?.full_name || 'Your Name'}</Text>
          <Text style={styles.email}>{profile?.email || ''}</Text>
          <View style={styles.accountBadge}>
            {profile?.account_type === 'establishment' ? (
              <Store size={14} color={colors.primary} strokeWidth={2.2} />
            ) : (
              <Home size={14} color={colors.primary} strokeWidth={2.2} />
            )}
            <Text style={styles.accountBadgeText}>
              {profile?.account_type === 'establishment' ? 'Food Establishment' : 'Household'}
            </Text>
          </View>
        </View>

        {/* Plan — its own block because the status badge is the point of it. */}
        <View style={styles.block}>
          <SectionHeader title="Subscription" />
          <View style={styles.menuCard}>
            <ListRow
              icon={Crown}
              label={entitlements?.plan_name ?? 'Your plan'}
              hint={planHint}
              onPress={() => router.push('/subscription')}
              right={<StatusBadge label={planStatus.label} tone={planStatus.tone} />}
            />
            {entitlements && entitlements.is_active && (
              <View style={styles.usageRow}>
                <StatCard
                  index={0}
                  icon={Home}
                  title="Products"
                  value={`${entitlements.products_used} / ${entitlements.max_products}`}
                  caption="Items tracked"
                  iconBg={colors.primary}
                  style={styles.usageCard}
                />
                <StatCard
                  icon={Tag}
                  title="AI Scans"
                  value={`${entitlements.ai_scans_used} / ${entitlements.max_ai_scans}`}
                  caption="This month"
                  iconBg={colors.warning}
                  index={1}
                  style={styles.usageCard}
                />
              </View>
            )}
          </View>
        </View>

        {/* Tools — the plan-gated ones appear with the tier that unlocks them. */}
        <View style={styles.block}>
          <SectionHeader title={isEstablishment ? 'Stock & team' : 'Inventory tools'} />
          <View style={styles.menuCard}>
            {!isEstablishment && (
              <ListRow
                icon={Package}
                label="My Inventory"
                hint="View, update and consume your food items"
                onPress={() => router.push('/(tabs)/my-inventory')}
              />
            )}
            {isEstablishment && (
              <ListRow
                icon={Package}
                label="My Inventory"
                hint="Stock, freshness and inventory history"
                onPress={() => router.push('/my-inventory')}
              />
            )}
            {tools.map((item, i) => (
              <View key={item.label}>
                {(i > 0 || isEstablishment) && <View style={styles.sep} />}
                <ListRow
                  icon={item.icon}
                  label={item.label}
                  hint={item.hint}
                  onPress={() => router.push(item.path)}
                  right={item.badge ? <StatusBadge label={item.badge} tone="neutral" /> : undefined}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Menu */}
        <View style={styles.block}>
          <SectionHeader title="Settings" />
          <View style={styles.menuCard}>
            {MENU.map((item, i) => (
              <View key={item.label}>
                {i > 0 && <View style={styles.sep} />}
                <ListRow icon={item.icon} label={item.label} hint={item.hint} onPress={() => router.push(item.path)} />
              </View>
            ))}
          </View>
        </View>

        <PillButton
          title="Logout"
          variant="dangerOutline"
          icon={LogOut}
          onPress={handleSignOut}
          style={{ marginTop: spacing.md }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  // The scroll view fills the wrapper; the inset lives on the wrapper's padding.
  scroll: { flex: 1 },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, paddingBottom: spacing.md },
  identityCard: { alignItems: 'center', paddingBottom: spacing.lg },
  camBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.screenBg,
  },
  name: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.sm },
  email: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  accountBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.sm,
    backgroundColor: colors.mintBg,
    borderRadius: radii.pill,
    paddingVertical: 5, paddingHorizontal: 12,
  },
  accountBadgeText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  block: { marginBottom: spacing.lg },
  menuCard: {
    backgroundColor: colors.surface, borderRadius: radii.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    ...shadow.card,
  },
  // Side by side only while each card can hold its icon, counter and caption.
  //
  // These sit inside `menuCard`, which has already taken its horizontal padding,
  // so on a phone two cards leave a text column narrower than the counter it has
  // to print — `0 / 100` and "Items tracked" both truncated. `flexBasis` is what
  // Yoga measures when deciding where to break a wrapping row, so the row wraps
  // and the cards stack full width instead; they still grow to share a line
  // whenever the screen is wide enough for both. The other StatCard grids (the
  // dashboard) are on a bare page and print short values, so they are unaffected.
  usageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  usageCard: { flexBasis: 200, minWidth: 200 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 },
});
