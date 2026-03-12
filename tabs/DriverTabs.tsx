// src/navigation/DriverTabs.tsx

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DriverScreen from '../screens/DriverScreen';
import DriverMenuScreen from '../screens/DriverMenuScreen';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR, CARD_BACKGROUND, TEXT_SECONDARY } from '../src/constants/theme';

const Tab = createBottomTabNavigator();

export default function DriverTabs() {
  return (
    <Tab.Navigator
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
        tabBarIcon: ({ focused, color, size }) => {
          let iconName = 'help-outline';
          if (route.name === 'LiveLocation') {
            iconName = 'location-on';
          } else if (route.name === 'Menu') {
            iconName = 'menu';
          }
          return <Icon name={iconName} size={28} color={color} />;
        },
        tabBarActiveTintColor: PRIMARY_COLOR,
        tabBarInactiveTintColor: TEXT_SECONDARY,
      })}
    >
      <Tab.Screen name="LiveLocation" component={DriverScreen} />
      <Tab.Screen name="Menu" component={DriverMenuScreen} />
    </Tab.Navigator>
  );
}
