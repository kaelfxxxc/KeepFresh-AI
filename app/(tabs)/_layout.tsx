import { Tabs } from 'expo-router';
import { Text, StyleSheet } from 'react-native';
import { COLORS } from '../../src/theme';

function TabBarIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: '🏠',
    Inventory: '📦',
    Recipes: '🍳',
    Alerts: '⏰',
    Profile: '👤',
  };
  return (
    <Text style={[styles.icon, focused ? styles.iconActive : styles.iconInactive]}>
      {icons[label] || '•'}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.secondaryText,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused }) => <TabBarIcon label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          tabBarLabel: 'Inventory',
          tabBarIcon: ({ focused }) => <TabBarIcon label="Inventory" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          tabBarLabel: 'Recipes',
          tabBarIcon: ({ focused }) => <TabBarIcon label="Recipes" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          tabBarLabel: 'Alerts',
          tabBarIcon: ({ focused }) => <TabBarIcon label="Alerts" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused }) => <TabBarIcon label="Profile" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.white,
    borderTopColor: COLORS.divider,
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  icon: {
    fontSize: 22,
  },
  iconActive: {
    // color set by tabBarActiveTintColor
  },
  iconInactive: {
    // color set by tabBarInactiveTintColor
  },
});