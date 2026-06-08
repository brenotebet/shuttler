import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MapScreen from '../screens/MapScreen';
import StudentMenuScreen from '../screens/StudentMenuScreen';
import RoutesScreen from '../screens/RoutesScreen';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { CARD_BACKGROUND, TEXT_SECONDARY } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';

export type StudentTabParamList = {
  Map: { focusStopId?: string; focusStopName?: string } | undefined;
  Routes: undefined;
  Menu: undefined;
};

const Tab = createBottomTabNavigator<StudentTabParamList>();

export default function StudentTabs() {
  const { primaryColor } = useOrgTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: primaryColor,
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
          const icons: Record<string, string> = {
            Map: 'map',
            Routes: 'directions-bus',
            Menu: 'menu',
          };
          return <Icon name={icons[route.name] ?? 'help-outline'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Routes" component={RoutesScreen} />
      <Tab.Screen name="Menu" component={StudentMenuScreen} />
    </Tab.Navigator>
  );
}
