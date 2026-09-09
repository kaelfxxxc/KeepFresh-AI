import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Home, Package, ChefHat, Bell, User } from 'lucide-react-native';
import { COLORS } from '../../src/theme';

// 5-tab bottom navigation per the v2 UI reference. Grocery & Analytics are
// full-screen routes under app/ (opened from Home / Profile) - not tabs.
const TABS = [
  { name: 'index', label: 'Home', icon: Home },
  { name: 'inventory', label: 'Inventory', icon: Package },
  { name: 'recipes', label: 'Recipes', icon: ChefHat },
  { name: 'alerts', label: 'Alerts', icon: Bell },
  { name: 'profile', label: 'Profile', icon: User },
] as const;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.secondaryText,
        tabBarStyle:
          route.name.startsWith('inventory/')
            ? { display: 'none' } // full-screen add/details forms
            : styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
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
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.white,
    borderTopColor: COLORS.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 62,
    paddingTop: 7,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 8,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  tabBarItem: {
    paddingVertical: 2,
  },
});
