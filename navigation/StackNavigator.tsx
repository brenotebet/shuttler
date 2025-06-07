import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import MapScreen from '../screens/MapScreen';
import RequestRideScreen from '../screens/RequestRideScreen';
import AdminDriverScreen from '../screens/AdminDriverScreen';
import DriverScreen from '../screens/DriverScreen';
import StudentTabs from '../tabs/StudentTabs';
import DriverTabs from '../tabs/DriverTabs';

export type RootStackParamList = {
  Login: undefined;
  StudentHome: undefined;
  DriverHome: undefined;
  Map: undefined;
  RequestRide: undefined;
  RideHistory: undefined;
  AdminDriver: undefined;
  DriverScreen: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function StackNavigator() {
  return (
    <Stack.Navigator initialRouteName="Login">
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StudentHome" component={StudentTabs} options={{ headerShown: false }} />
      <Stack.Screen name="DriverHome" component={DriverTabs} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}