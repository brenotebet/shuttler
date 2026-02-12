// src/navigation/StackNavigator.tsx

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import StudentTabs from '../tabs/StudentTabs';
import DriverTabs from '../tabs/DriverTabs';
import DriverHistoryScreen from '../screens/DriverHistoryScreen';
import AdminDriverScreen from '../screens/AdminDriverScreen';
import StudentHistoryScreen from '../screens/StudentHistoryScreen';

import { useAuth } from '../src/auth/AuthProvider';

export type RootStackParamList = {
  Login: undefined;

  // Home stacks
  StudentHome: undefined;
  DriverHome: undefined;

  // Stack-level screens
  StudentHistory: undefined;
  DriverHistory: undefined;
  AdminDriver: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}

export default function StackNavigator() {
  const { user, role, initializing } = useAuth();

  if (initializing) {
    return <LoadingScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        // Logged out
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : role === 'driver' || role === 'admin' ? (
        // Logged in as driver/admin
        <>
          <Stack.Screen name="DriverHome" component={DriverTabs} />
          <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} />
          <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
        </>
      ) : (
        // Logged in as student (default)
        <>
          <Stack.Screen name="StudentHome" component={StudentTabs} />
          <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
