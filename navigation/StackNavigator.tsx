import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import MapScreen from '../screens/MapScreen';
import RequestRideScreen from '../screens/RequestRideScreen';
import AdminDriverScreen from '../screens/AdminDriverScreen';
import DriverScreen from '../screens/DriverScreen';

export type RootStackParamList = {
  Login: undefined;
  Map: undefined;
  RequestRide: undefined;
  AdminDriver: undefined;
  DriverScreen: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function StackNavigator() {
  return (
    <Stack.Navigator initialRouteName="Login">
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Map" component={MapScreen} />
      <Stack.Screen name="RequestRide" component={RequestRideScreen} />
      <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
      <Stack.Screen name="DriverScreen" component={DriverScreen} />
    </Stack.Navigator>
  );
}