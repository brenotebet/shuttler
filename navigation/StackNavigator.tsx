// navigation/StackNavigator.tsx

import React, { useEffect } from 'react';
import { ActivityIndicator, Animated, View, StyleSheet, TouchableOpacity } from 'react-native'
import { Text } from '../components/Text';
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
import AdminChatScreen from '../screens/AdminChatScreen';
import AdminAnalyticsScreen from '../screens/AdminAnalyticsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import LegalScreen from '../screens/LegalScreen';
import AccessibilityScreen from '../screens/AccessibilityScreen';
import PhoneVerificationScreen from '../screens/PhoneVerificationScreen';
import NotificationPrefsScreen from '../screens/NotificationPrefsScreen';
import AnnouncementsScreen from '../screens/AnnouncementsScreen';

import { useAuth } from '../src/auth/AuthProvider';
import { useOrg } from '../src/org/OrgContext';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { ToastContainer } from '../src/components/Toast';

export type RootStackParamList = {
  OrgSelector: undefined;
  CreateOrg: undefined;
  Auth: { orgId: string; initialEmail?: string };
  EmailVerification: undefined;

  // Authenticated stacks
  StudentHome: { screen: 'Map'; params: { focusStopId?: string; focusStopName?: string } } | undefined;
  DriverHome: undefined;

  // Stack-level screens
  StudentHistory: undefined;
  ParentChildLink: undefined;
  DriverHistory: undefined;
  AdminDriver: undefined;
  AdminDashboard: undefined;
  AdminOrgSetup: { initialTab?: 'profile' | 'auth' | 'stops' | 'users' | 'ops' | 'billing' } | undefined;
  AdminAnalytics: undefined;
  AdminChat: undefined;
  Profile: undefined;
  HowToUse: { role: 'student' | 'driver' | 'admin' | 'parent'; isOnboarding?: boolean };
  Legal: undefined;
  Accessibility: undefined;
  PhoneVerification: { phone?: string } | undefined;
  NotificationPrefs: undefined;
  Announcements: undefined;

  SubscriptionExpired: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingOverlay({ visible }: { visible: boolean }) {
  const opacity = React.useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [visible]);
  if (!visible) return null;
  return (
    <Animated.View style={[styles.loadingOverlay, { opacity }]} pointerEvents="auto">
      <ActivityIndicator size="large" color={PRIMARY_COLOR} />
    </Animated.View>
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

  // Show overlay (not a black screen) for all transient loading states so the
  // user stays on whatever they were looking at while auth resolves.
  const isLoading = signingOut || initializing || isLoadingOrg || (!!user && !!org && !role);

  // Decide which content to render beneath the overlay.
  // Hard-block screens (rejected, expired) are only surfaced once loading clears.
  const renderContent = () => {
    if (isLoading || !user || !org) {
      // While loading: show login stack as placeholder — it's fully hidden by the overlay.
      // When not loading and no user (or no org selected): login stack is the correct destination.
      return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="OrgSelector" component={OrgSelectorScreen} />
          <Stack.Screen name="CreateOrg" component={CreateOrgScreen} />
          <Stack.Screen name="Auth" component={AuthScreen} />
        </Stack.Navigator>
      );
    }

    if (org?.reviewStatus === 'rejected') return <RejectedOrgScreen />;

    if (role !== 'admin' && ['canceled', 'unpaid'].includes(org?.subscriptionStatus ?? '')) {
      return <SubscriptionExpiredScreen />;
    }

    // Email auth: block until address is verified.
    // This is a stable (non-loading) gate, so no overlay needed here.
    if (org?.authMethod === 'email' && !emailVerified) {
      return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
        </Stack.Navigator>
      );
    }

    if (role === 'parent') {
      return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="StudentHome" component={StudentTabs} />
          <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} />
          <Stack.Screen name="ParentChildLink" component={ParentChildLinkScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="AdminChat" component={AdminChatScreen} />
          <Stack.Screen name="HowToUse" component={HowToUseScreen} />
          <Stack.Screen name="Legal" component={LegalScreen} />
          <Stack.Screen name="Accessibility" component={AccessibilityScreen} />
          <Stack.Screen name="NotificationPrefs" component={NotificationPrefsScreen} />
          <Stack.Screen name="PhoneVerification" component={PhoneVerificationScreen} />
        </Stack.Navigator>
      );
    }

    if (role === 'driver' || role === 'admin') {
      // New admin with no stops goes straight to org setup
      if (role === 'admin' && !(org?.stops?.length)) {
        return (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="AdminOrgSetup" component={AdminOrgSetupScreen} />
            <Stack.Screen name="DriverHome" component={DriverTabs} />
            <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} />
            <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
            <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
            <Stack.Screen name="AdminAnalytics" component={AdminAnalyticsScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="AdminChat" component={AdminChatScreen} />
            <Stack.Screen name="HowToUse" component={HowToUseScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
            <Stack.Screen name="Accessibility" component={AccessibilityScreen} />
            <Stack.Screen name="NotificationPrefs" component={NotificationPrefsScreen} />
            <Stack.Screen name="Announcements" component={AnnouncementsScreen} />
            <Stack.Screen name="PhoneVerification" component={PhoneVerificationScreen} />
          </Stack.Navigator>
        );
      }
      return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="DriverHome" component={DriverTabs} />
          <Stack.Screen name="DriverHistory" component={DriverHistoryScreen} />
          <Stack.Screen name="AdminDriver" component={AdminDriverScreen} />
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
          <Stack.Screen name="AdminOrgSetup" component={AdminOrgSetupScreen} />
          <Stack.Screen name="AdminAnalytics" component={AdminAnalyticsScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="AdminChat" component={AdminChatScreen} />
          <Stack.Screen name="HowToUse" component={HowToUseScreen} />
          <Stack.Screen name="Legal" component={LegalScreen} />
          <Stack.Screen name="Accessibility" component={AccessibilityScreen} />
          <Stack.Screen name="NotificationPrefs" component={NotificationPrefsScreen} />
          <Stack.Screen name="Announcements" component={AnnouncementsScreen} />
          <Stack.Screen name="PhoneVerification" component={PhoneVerificationScreen} />
        </Stack.Navigator>
      );
    }

    // Default: student
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="StudentHome" component={StudentTabs} />
        <Stack.Screen name="StudentHistory" component={StudentHistoryScreen} />
        <Stack.Screen name="ParentChildLink" component={ParentChildLinkScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="AdminChat" component={AdminChatScreen} />
        <Stack.Screen name="HowToUse" component={HowToUseScreen} />
        <Stack.Screen name="Legal" component={LegalScreen} />
        <Stack.Screen name="Accessibility" component={AccessibilityScreen} />
        <Stack.Screen name="NotificationPrefs" component={NotificationPrefsScreen} />
        <Stack.Screen name="PhoneVerification" component={PhoneVerificationScreen} />
      </Stack.Navigator>
    );
  };

  return (
    <View style={styles.root}>
      {renderContent()}
      <LoadingOverlay visible={isLoading} />
      <ToastContainer />
    </View>
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
  root: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
