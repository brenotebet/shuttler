// src/navigation/DriverTabs.tsx

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AdminDriverScreen from '../screens/AdminDriverScreen';
import DriverScreen from '../screens/DriverScreen';
import DriverHistoryScreen from '../screens/DriverHistoryScreen';
import Icon from 'react-native-vector-icons/MaterialIcons';

const Tab = createBottomTabNavigator();

export default function DriverTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 0,
          elevation: 8,
          height: 80,
          paddingBottom: 5,
        },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName = 'help-outline';
          if (route.name === 'AdminPanel') {
            iconName = 'list-alt';
          } else if (route.name === 'LiveLocation') {
            iconName = 'location-on';
          } else if (route.name === 'RideHistory') {
            iconName = 'history';
          }
          return <Icon name={iconName} size={28} color={color} />;
        },
        tabBarActiveTintColor: '#4B2E83',
        tabBarInactiveTintColor: '#aaa',
      })}
    >
      <Tab.Screen name="AdminPanel" component={AdminDriverScreen} />
      <Tab.Screen name="LiveLocation" component={DriverScreen} />
      <Tab.Screen name="RideHistory" component={DriverHistoryScreen} />
    </Tab.Navigator>
  );
}
