import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import AdminDriverScreen from '../screens/AdminDriverScreen';
import DriverHistoryScreen from '../screens/DriverHistoryScreen';
import StudentHistoryScreen from '../screens/StudentHistoryScreen';
import StudentTabs from '../tabs/StudentTabs';
import DriverTabs from '../tabs/DriverTabs';

export type RootStackParamList = {
  Login: undefined;
  StudentHome: undefined;
  DriverHome: undefined;
  AdminDriver: undefined;
  DriverHistory: undefined;
  StudentHistory: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function StackNavigator() {
  return (
    <Stack.Navigator initialRouteName="Login">
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StudentHome" component={StudentTabs} options={{ headerShown: false }} />
      <Stack.Screen name="DriverHome" component={DriverTabs} options={{ headerShown: false }} />
      <Stack.Screen name="AdminDriver" component={AdminDriverScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}