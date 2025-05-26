import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import StackNavigator from './navigation/StackNavigator';
import { LocationProvider } from './location/LocationContext';

export default function App() {
  return (
    <LocationProvider>
      <NavigationContainer>
        <StackNavigator />
      </NavigationContainer>
    </LocationProvider>
  );
}