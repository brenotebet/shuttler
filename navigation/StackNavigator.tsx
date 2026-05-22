// navigation/StackNavigator.tsx

import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import OrgSelectorScreen from '../screens/OrgSelectorScreen';
import AuthScreen from '../screens/AuthScreen';
import EmailVerificationScreen from '../screens/EmailVerificationScreen';
import StudentTabs from '../tabs/StudentTabs';
import DriverTabs from '../tabs/DriverTabs';
import DriverHistoryScreen from '../screens/DriverHistoryScreen';
import AdminDriverScreen from '../screens/AdminDriverScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import StudentHistoryScreen from '../screens/StudentHistoryScreen';
import AdminOrgSetupScreen from '../screens/AdminOrgSetupScreen';
import CreateOrgScreen from '../screens/CreateOrgScreen';
import HowToUseScreen from '../screens/HowToUseScreen';
import ParentChildLinkScreen from '../screens/ParentChildLinkScreen';

import { useAuth } from '../src/auth/AuthProvider';
import { useOrg } from '../src/org/OrgContext';
import { PRIMARY_COLOR } from '../src/constants/theme';

export type RootStackParamList = {
  OrgSelector: undefined;
  CreateOrg: undefined;
  Auth: { orgId: string; initialEmail?: string };
  EmailVerification: undefined;

  // Authenticated stacks
  StudentHome: undefined;
  DriverHome: undefined;

  // Stack-level screens
  StudentHistory: undefined;
  ParentChildLink: undefined;
  DriverHistory: undefined;
  AdminDriver: undefined;
  AdminDashboard: undefined;
  AdminOrgSetup: undefined;
  HowToUse: { role: 'student' | 'driver' | 'admin' | 'parent'; isOnboarding?: boolean };

  SubscriptionExpired: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
      <ActivityIndicator size="large" color={PRIMARY_COLOR} />
    </View>
  );
}

function SubscriptionExpiredScreen() {
  const { org } = useOrg();
  return (
    <View style={styles.expiredContainer}>
      <Icon name="credit-card-off" size={52} color="#ef4444" style={{ marginBottom: 16 }} />
      <Text style={styles.expiredTitle}>Subscription Inactive</Text>
      {org?.name ? (
        <Text style={styles.expiredOrgName}>{org.name}</Text>
      ) : null}
      <Text style={styles.expiredBody}>
        Your organization's Shuttler subscription is no longer active.
        Please contact your administrator to renew the plan.
      </Text>
      <TouchableOpacity style={styles.expiredSignOutBtn} onPress={() => signOut(auth).catch(() => {})}>
        <Icon name="logout" size={16} color={PRIMARY_COLOR} />
        <Text style={styles.expiredSignOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

function RejectedOrgScreen() {
  const { org } = useOrg();
  return (
    <View style={styles.expiredContainer}>
      <Icon name="cancel" size={52} color="#ef4444" style={{ marginBottom: 16 }} />
      <Text style={styles.expiredTitle}>Application Not Approved</Text>
      {org?.name ? (
        <Text style={styles.expiredOrgName}>{org.name}</Text>
      ) : null}
      {org?.rejectionReason ? (
        <View style={styles.rejectionReasonBox}>
          <Text style={styles.rejectionReasonLabel}>Reason</Text>
          <Text style={styles.rejectionReasonText}>{org.rejectionReason}</Text>
        </View>
      ) : null}
      <Text style={styles.expiredBody}>
        Your Shuttler application was not approved. Please check your email for details
        or reply to our message if you have questions.
      </Text>
      <TouchableOpacity style={styles.expiredSignOutBtn} onPress={() => signOut(auth).catch(() => {})}>
        <Icon name="logout" size={16} color={PRIMARY_COLOR} />
        <Text style={styles.expiredSignOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function StackNavigator() {
  const { user, role, initializing, signingOut, emailVerified } = useAuth();
  const { org, isLoadingOrg } = useOrg();
  useEffect(() => {
    if (!initializing && !isLoadingOrg) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [initializing, isLoadingOrg]);

  // During signout (e.g. unauthorized user kicked out) skip all screens and
  // go straight to a blank view — the auth stack renders as soon as user=null.
  if (signingOut) {
    return <LoadingScreen />;
  }

  if (initializing || isLoadingOrg) {
    return <LoadingScreen />;
  }

  // User is in an org but their role hasn't resolved yet (new account race condition).
  // Hold on the loading screen rather than briefly showing the wrong stack.
  // The effect above will sign them out after 4s if the role never arrives.
  if (user && org && !role) {
    return <LoadingScreen />;
  }

  // Hard-block if org application was rejected
  if (user && org && org.reviewStatus === 'rejected') {
    return <RejectedOrgScreen />;
  }

  // Hard-block non-admins only on fully canceled/unpaid (past_due gets a grace period)
  if (user && org && role !== 'admin' && ['canceled', 'unpaid'].includes(org.subscriptionStatus ?? '')) {
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
      ) : role === 'parent' ? (
        <>
          <Stack.Screen name="StudentHome" component={StudentTabs} />
          <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} />
          <Stack.Screen name="ParentChildLink" component={ParentChildLinkScreen} />
          <Stack.Screen name="HowToUse" component={HowToUseScreen} />
        </>
      ) : role === 'driver' || role === 'admin' ? (
        // New admin with no stops goes straight to org setup; others start at DriverHome
        role === 'admin' && !(org?.stops?.length) ? (
          <>
            <Stack.Screen name="AdminOrgSetup" component={AdminOrgSetupScreen} />
            <Stack.Screen name="DriverHome" component={DriverTabs} />
            <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} />
            <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
            <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
            <Stack.Screen name="HowToUse" component={HowToUseScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="DriverHome" component={DriverTabs} />
            <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} />
            <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
            <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
            <Stack.Screen name="AdminOrgSetup" component={AdminOrgSetupScreen} />
            <Stack.Screen name="HowToUse" component={HowToUseScreen} />
          </>
        )
      ) : (
        // Logged in as student (default)
        <>
          <Stack.Screen name="StudentHome" component={StudentTabs} />
          <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} />
          <Stack.Screen name="ParentChildLink" component={ParentChildLinkScreen} />
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
    marginBottom: 28,
  },
  expiredOrgName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  expiredSignOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: PRIMARY_COLOR,
  },
  expiredSignOutText: {
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY_COLOR,
  },
  rejectionReasonBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    alignSelf: 'stretch',
  },
  rejectionReasonLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#991b1b',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rejectionReasonText: {
    fontSize: 14,
    color: '#7f1d1d',
    lineHeight: 20,
  },
});
