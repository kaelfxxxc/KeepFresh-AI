import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { Home, Package, ChefHat, Bell, User } from 'lucide-react-native';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';

// 5-tab bottom navigation per the v2 UI reference. Grocery & Analytics are
// full-screen routes under app/ (opened from Home / Profile) - not tabs.
const TABS = [
  { name: 'index', label: 'Home', icon: Home },
  { name: 'inventory', label: 'Products', icon: Package },
  { name: 'recipes', label: 'Recipes', icon: ChefHat },
  { name: 'alerts', label: 'Alerts', icon: Bell },
  { name: 'profile', label: 'Profile', icon: User },
] as const;

// Full-screen forms/pushed screens that live under the tabs directory (so they
// share the auth/layout context) but must never appear as tab bar buttons.
const NON_TAB_ROUTES = ['inventory/add', 'inventory/details', 'my-inventory'] as const;

export default function TabLayout() {
  const { compact, height, barWidth, barLeft, bottomOffset } = useFloatingTabBar();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle:
          route.name.startsWith('inventory/') || route.name === 'my-inventory'
            ? { display: 'none' } // full-screen add/details forms
            : [
                styles.tabBar,
                // Geometry last, so the device-dependent parts of the float are
                // applied together and nothing can half-override them.
                { width: barWidth, left: barLeft, bottom: bottomOffset, height },
              ],
        tabBarLabelStyle: compact ? [styles.tabBarLabel, styles.tabBarLabelCompact] : styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
      })}
    >
      {TABS.map(({ name, label, icon: Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            tabBarLabel: label,
            tabBarIcon: ({ focused }) => (
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <Icon
                  size={22}
                  color={focused ? colors.primaryDark : colors.textSecondary}
                  strokeWidth={focused ? 2.4 : 1.9}
                />
                {focused && (
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: colors.primary,
                    marginTop: 2,
                  }} />
                )}
              </View>
            ),
          }}
        />
      ))}
      {NON_TAB_ROUTES.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  /**
   * The floating bar. `position: absolute` lifts it out of the layout flow so
   * the screen scrolls underneath it, and the rounding plus the shadow are what
   * make it read as a card resting on the screen rather than a strip welded to
   * the bottom edge.
   *
   * Width, `left`, `bottom` and `height` are not here — they depend on the
   * device and come from `useFloatingTabBar`, which the tab screens also read so
   * they can keep their last row clear of the bar.
   */
  tabBar: {
    position: 'absolute',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderTopWidth: 0,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    ...shadow.card,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  // Five labels in a bar that is inset from both edges: at 320pt "Inventory" is
  // the widest thing in the row and 11pt pushes the items into each other.
  tabBarLabelCompact: {
    fontSize: 10,
  },
  tabBarItem: {
    paddingVertical: 2,
  },
});
