// src/navigation/DriverTabs.tsx

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DriverScreen from '../screens/DriverScreen';
import DriverMenuScreen from '../screens/DriverMenuScreen';
import RoutesScreen from '../screens/RoutesScreen';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CARD_BACKGROUND, TEXT_SECONDARY, BORDER_COLOR } from '../src/constants/theme';
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
        tabBarStyle: {
          backgroundColor: CARD_BACKGROUND,
          borderTopWidth: 1,
          borderTopColor: BORDER_COLOR,
          elevation: 8,
          height: 80,
          paddingBottom: 5,
        },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, string> = {
            LiveLocation: 'location-on',
            Routes: 'directions-bus',
            Menu: 'menu',
          };
          return <Icon name={icons[route.name] ?? 'help-outline'} size={size} color={color} />;
        },
        tabBarActiveTintColor: primaryColor,
        tabBarInactiveTintColor: TEXT_SECONDARY,
      })}
    >
      <Tab.Screen name="LiveLocation" component={DriverScreen} options={{ tabBarLabel: 'Live' }} />
      <Tab.Screen name="Routes" component={RoutesScreen} />
      <Tab.Screen name="Menu" component={DriverMenuScreen} />
    </Tab.Navigator>
  );
}
