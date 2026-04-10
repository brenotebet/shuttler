// navigation/StackNavigator.tsx

import React from 'react';
import { ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import OrgSelectorScreen from '../screens/OrgSelectorScreen';
import AuthScreen from '../screens/AuthScreen';
import EmailVerificationScreen from '../screens/EmailVerificationScreen';
import StudentTabs from '../tabs/StudentTabs';
import DriverTabs from '../tabs/DriverTabs';
import DriverHistoryScreen from '../screens/DriverHistoryScreen';
import AdminDriverScreen from '../screens/AdminDriverScreen';
import StudentHistoryScreen from '../screens/StudentHistoryScreen';
import AdminOrgSetupScreen from '../screens/AdminOrgSetupScreen';
import CreateOrgScreen from '../screens/CreateOrgScreen';
import SuperAdminScreen from '../screens/SuperAdminScreen';
import HowToUseScreen from '../screens/HowToUseScreen';

import { useAuth } from '../src/auth/AuthProvider';
import { useOrg } from '../src/org/OrgContext';
import { PRIMARY_COLOR } from '../src/constants/theme';

export type RootStackParamList = {
  OrgSelector: undefined;
  CreateOrg: undefined;
  Auth: { orgId: string };
  EmailVerification: undefined;

  // Authenticated stacks
  StudentHome: undefined;
  DriverHome: undefined;

  // Stack-level screens
  StudentHistory: undefined;
  DriverHistory: undefined;
  AdminDriver: undefined;
  AdminOrgSetup: undefined;
  SuperAdmin: undefined;
  HowToUse: { role: 'student' | 'driver' | 'admin' | 'parent' };

  SubscriptionExpired: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={PRIMARY_COLOR} />
    </View>
  );
}

function SubscriptionExpiredScreen() {
  return (
    <View style={styles.expiredContainer}>
      <Text style={styles.expiredTitle}>Subscription Inactive</Text>
      <Text style={styles.expiredBody}>
        Your organization's Shuttler subscription is no longer active.
        Please contact your administrator to renew the plan.
      </Text>
    </View>
  );
}

export default function StackNavigator() {
  const { user, role, initializing, emailVerified, isSuperAdmin } = useAuth();
  const { org, isLoadingOrg } = useOrg();

  if (initializing || isLoadingOrg) {
    return <LoadingScreen />;
  }

  // Authenticated but org subscription lapsed (admins can always log in to manage the org)
  if (user && org && role !== 'admin' && !['trialing', 'active'].includes(org.subscriptionStatus ?? 'trialing')) {
    return <SubscriptionExpiredScreen />;
  }

  // Email auth: require verification before entering the app
  if (user && org?.authMethod === 'email' && !emailVerified) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        // Logged out — two-step login flow
        <>
          <Stack.Screen name="OrgSelector" component={OrgSelectorScreen} />
          <Stack.Screen name="CreateOrg" component={CreateOrgScreen} />
          <Stack.Screen name="Auth" component={AuthScreen} />
        </>
      ) : role === 'admin' && (org?.stops?.length ?? 0) === 0 ? (
        // Admin with no stops yet — send straight to org setup
        <>
          <Stack.Screen name="AdminOrgSetup" component={AdminOrgSetupScreen} />
          <Stack.Screen name="DriverHome" component={DriverTabs} />
          <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} />
          <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
          {isSuperAdmin && <Stack.Screen name="SuperAdmin" component={SuperAdminScreen} />}
          <Stack.Screen name="HowToUse" component={HowToUseScreen} />
        </>
      ) : role === 'parent' ? (
        // Parents see the same map as students (tracking-only UX can be refined later)
        <>
          <Stack.Screen name="StudentHome" component={StudentTabs} />
          <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} />
          <Stack.Screen name="HowToUse" component={HowToUseScreen} />
        </>
      ) : role === 'driver' || role === 'admin' ? (
        // Logged in as driver/admin with stops configured
        <>
          <Stack.Screen name="DriverHome" component={DriverTabs} />
          <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} />
          <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
          <Stack.Screen name="AdminOrgSetup" component={AdminOrgSetupScreen} />
          {isSuperAdmin && <Stack.Screen name="SuperAdmin" component={SuperAdminScreen} />}
          <Stack.Screen name="HowToUse" component={HowToUseScreen} />
        </>
      ) : (
        // Logged in as student (default)
        <>
          <Stack.Screen name="StudentHome" component={StudentTabs} />
          <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} />
          {isSuperAdmin && <Stack.Screen name="SuperAdmin" component={SuperAdminScreen} />}
          <Stack.Screen name="HowToUse" component={HowToUseScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  expiredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F8FAFC',
  },
  expiredTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e53935',
    marginBottom: 12,
    textAlign: 'center',
  },
  expiredBody: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
  },
});
