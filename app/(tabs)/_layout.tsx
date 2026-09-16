import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Home, Package, ChefHat, Bell, User } from 'lucide-react-native';
import { COLORS, RADII, SHADOW } from '../../src/theme';
import { useFloatingTabBar } from '../../src/hooks/useFloatingTabBar';

// 5-tab bottom navigation per the v2 UI reference. Grocery & Analytics are
// full-screen routes under app/ (opened from Home / Profile) - not tabs.
const TABS = [
  { name: 'index', label: 'Home', icon: Home },
  { name: 'inventory', label: 'Inventory', icon: Package },
  { name: 'recipes', label: 'Recipes', icon: ChefHat },
  { name: 'alerts', label: 'Alerts', icon: Bell },
  { name: 'profile', label: 'Profile', icon: User },
] as const;

// Full-screen forms/pushed screens that live under the tabs directory (so they
// share the auth/layout context) but must never appear as tab bar buttons.
const NON_TAB_ROUTES = ['inventory/add', 'inventory/details'] as const;

export default function TabLayout() {
  const { compact, height, barWidth, barLeft, bottomOffset } = useFloatingTabBar();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.secondaryText,
        tabBarStyle:
          route.name.startsWith('inventory/')
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
              <Icon
                size={22}
                color={focused ? COLORS.primary : COLORS.secondaryText}
                strokeWidth={focused ? 2.4 : 1.9}
              />
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
    backgroundColor: COLORS.white,
    borderRadius: RADII.pill,
    borderTopWidth: 0,
    // Both paddings are set explicitly because react-navigation otherwise
    // injects its own: it adds the home-indicator inset as `paddingBottom`,
    // which inside a fixed 64px bar would squeeze the icons and clip the labels.
    // The inset is spent as the gap *below* the bar instead.
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 4,
    ...SHADOW.card,
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
