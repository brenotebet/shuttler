import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MapScreen from '../screens/MapScreen';
import StudentMenuScreen from '../screens/StudentMenuScreen';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { PRIMARY_COLOR, CARD_BACKGROUND, TEXT_SECONDARY } from '../src/constants/theme';

export type StudentTabParamList = {
  Map: undefined;
  Menu: undefined;
};

const Tab = createBottomTabNavigator<StudentTabParamList>();

export default function StudentTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: PRIMARY_COLOR,
        tabBarInactiveTintColor: TEXT_SECONDARY,
        tabBarStyle: {
          backgroundColor: CARD_BACKGROUND,
          borderTopWidth: 1,
          borderTopColor: '#E2E8F0',
          elevation: 8,
          height: 80,
          paddingBottom: 5,
        },
        tabBarIcon: ({ color, size }) => {
          let iconName: string = 'map';

          if (route.name === 'Menu') {
            iconName = 'menu';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Menu" component={StudentMenuScreen} />
    </Tab.Navigator>
  );
}
