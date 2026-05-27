// src/navigation/DriverTabs.tsx

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DriverScreen from '../screens/DriverScreen';
import DriverMenuScreen from '../screens/DriverMenuScreen';
import RoutesScreen from '../screens/RoutesScreen';
import ProfileScreen from '../screens/ProfileScreen';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CARD_BACKGROUND, TEXT_SECONDARY } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useAuth } from '../src/auth/AuthProvider';

const Tab = createBottomTabNavigator();

export default function DriverTabs() {
  const { primaryColor } = useOrgTheme();
  const { role } = useAuth();
  return (
    <Tab.Navigator
      initialRouteName={role === 'admin' ? 'Menu' : 'LiveLocation'}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: CARD_BACKGROUND,
          borderTopWidth: 1,
          borderTopColor: '#E2E8F0',
          elevation: 8,
          height: 80,
          paddingBottom: 5,
        },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, string> = {
            LiveLocation: 'location-on',
            Routes: 'directions-bus',
            Profile: 'person',
            Menu: 'menu',
          };
          return <Icon name={icons[route.name] ?? 'help-outline'} size={size} color={color} />;
        },
        tabBarActiveTintColor: primaryColor,
        tabBarInactiveTintColor: TEXT_SECONDARY,
      })}
    >
      <Tab.Screen name="LiveLocation" component={DriverScreen} />
      <Tab.Screen name="Routes" component={RoutesScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="Menu" component={DriverMenuScreen} />
    </Tab.Navigator>
  );
}
