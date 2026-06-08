// src/screens/DriverMenuScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import { TouchableOpacity, View, StyleSheet, Alert, ScrollView } from 'react-native'
import { Text } from '../components/Text';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useDriver } from '../drivercontext/DriverContext';
import { useLocationSharing } from '../location/LocationContext';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrg } from '../src/org/OrgContext';
import { useAccessibility } from '../src/contexts/AccessibilityContext';
import { useProfileStatus } from '../src/hooks/useProfileStatus';
import { collection, doc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { clearSamlSession } from '../src/auth/samlAuth';
import Icon from 'react-native-vector-icons/MaterialIcons';

import MenuItem from '../components/MenuItem';
import ScreenContainer from '../components/ScreenContainer';
import { cardShadow, spacing } from '../src/styles/common';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useFirstLoginOnboarding } from '../src/hooks/useFirstLoginOnboarding';

// ── Setup checklist (admins only) ────────────────────────────────────────────

type OrgSetupTab = 'profile' | 'auth' | 'stops' | 'users' | 'ops' | 'billing';

function SetupChecklist({
  orgId,
  primaryColor,
  onNavigate,
}: {
  orgId: string;
  primaryColor: string;
  onNavigate: (tab: OrgSetupTab) => void;
}) {
  const { org } = useOrg();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [hasDriver, setHasDriver] = useState<boolean | null>(null);
  const storageKey = `setup_checklist_dismissed_${orgId}`;

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((val) => setDismissed(val === '1'))
      .catch(() => setDismissed(false));
  }, [storageKey]);

  useEffect(() => {
    getDocs(query(collection(db, 'orgs', orgId, 'users'), where('role', '==', 'driver'), limit(1)))
      .then((snap) => setHasDriver(!snap.empty))
      .catch(() => setHasDriver(false));
  }, [orgId]);

  const hasStops = (org?.stops?.length ?? 0) > 0;
  const hasRoutes = (org?.routes?.length ?? 0) > 0;
  const driverReady = hasDriver === true;

  const allDone = hasStops && hasRoutes && driverReady;

  useEffect(() => {
    if (allDone) {
      AsyncStorage.setItem(storageKey, '1').catch(() => {});
      setDismissed(true);
    }
  }, [allDone, storageKey]);

  const dismiss = useCallback(() => {
    AsyncStorage.setItem(storageKey, '1').catch(() => {});
    setDismissed(true);
  }, [storageKey]);

  if (dismissed === null || dismissed || hasDriver === null) return null;

  const steps: { key: string; label: string; done: boolean; tab: OrgSetupTab }[] = [
    { key: 'stops', label: 'Add your shuttle stops', done: hasStops, tab: 'stops' },
    { key: 'routes', label: 'Create at least one route', done: hasRoutes, tab: 'stops' },
    { key: 'driver', label: 'Invite a driver', done: driverReady, tab: 'users' },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <View style={checklistStyles.card}>
      <View style={checklistStyles.header}>
        <View style={checklistStyles.titleRow}>
          <Icon name="assignment-turned-in" size={16} color={primaryColor} />
          <Text style={checklistStyles.title}>Getting Started</Text>
          <Text style={checklistStyles.progress}>{doneCount}/{steps.length}</Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Icon name="close" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <View style={checklistStyles.progressBarBg}>
        <View style={[checklistStyles.progressBarFill, { backgroundColor: primaryColor, width: `${pct}%` as any }]} />
      </View>

      {steps.map((step, i) => (
        <TouchableOpacity
          key={step.key}
          style={[checklistStyles.step, i === 0 && checklistStyles.stepFirst]}
          onPress={() => { if (!step.done) onNavigate(step.tab); }}
          disabled={step.done}
          activeOpacity={step.done ? 1 : 0.7}
        >
          <View style={[checklistStyles.circle, step.done && { backgroundColor: primaryColor, borderColor: primaryColor }]}>
            {step.done && <Icon name="check" size={11} color="#fff" />}
          </View>
          <Text style={[checklistStyles.stepLabel, step.done && checklistStyles.stepLabelDone]}>
            {step.label}
          </Text>
          {!step.done && <Icon name="chevron-right" size={18} color="#9ca3af" />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const checklistStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    marginBottom: 16,
    ...cardShadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },
  progress: {
    fontSize: 12,
    color: '#9ca3af',
    marginRight: 8,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: '#f3f4f6',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  stepFirst: {
    borderTopWidth: 0,
  },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  stepLabelDone: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
});

export default function DriverMenuScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { primaryColor } = useOrgTheme();
  const { logout: clearDriverContext } = useDriver();
  useFirstLoginOnboarding();
  const { stopSharing, isSharing } = useLocationSharing();
  const { role, displayName } = useAuth();
  const firstName = displayName?.split(' ')[0] ?? null;
  const { org } = useOrg();
  const { fontScale } = useAccessibility();
  const profileStatus = useProfileStatus();
  const needsSetup = role === 'admin' && (org?.stops?.length ?? 0) === 0;

  const handleLogout = () => {
    Alert.alert(
      'Log out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', style: 'destructive', onPress: confirmLogout },
      ],
    );
  };

  const confirmLogout = async () => {
    try {
      // 1️⃣ Stop location sharing FIRST
      if (isSharing) {
        await stopSharing();
      }

      // 2️⃣ Clear local driver UI state
      clearDriverContext();

      // 3️⃣ Clear push token from Firestore so stale notifications aren't sent to this device
      const uid = auth.currentUser?.uid;
      const orgId = org?.orgId;
      if (uid && orgId) {
        setDoc(
          doc(db, 'orgs', orgId, 'users', uid),
          { expoPushToken: null },
          { merge: true },
        ).catch(() => {});
      }

      // 4️⃣ Clear SAML session so the next login prompts for fresh credentials
      await clearSamlSession();

      // 5️⃣ Sign out of Firebase Auth
      await signOut(auth);

      // ❌ DO NOT navigate manually
      // StackNavigator will switch to Login automatically
    } catch (err) {
      console.error('Error during driver logout', err);
    }
  };

  return (
    <ScreenContainer>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
      <View style={styles.hero}>
        {firstName ? (
          <Text style={[styles.greeting, { fontSize: 14 * fontScale }]}>Hi, {firstName} 👋</Text>
        ) : null}
        <Text style={[styles.title, { color: primaryColor, fontSize: 28 * fontScale }]}>
          {role === 'admin' ? 'Admin Hub' : 'Driver Hub'}
        </Text>
        <Text style={[styles.subtitle, { fontSize: 15 * fontScale }]}>
          {role === 'admin' ? 'Manage your org and operations' : 'Stay on top of requests and routes'}
        </Text>
      </View>

      {role === 'admin' && org?.orgId ? (
        <SetupChecklist
          orgId={org.orgId}
          primaryColor={primaryColor}
          onNavigate={(tab) => navigation.navigate('AdminOrgSetup', { initialTab: tab })}
        />
      ) : null}

      <View style={styles.menuSection}>
        <MenuItem
          icon="person"
          title="My Profile"
          description={
            profileStatus.isComplete
              ? 'Edit your name, phone, and preferences'
              : `Missing: ${profileStatus.missingFields.join(', ')}`
          }
          onPress={() => navigation.navigate('Profile')}
          badge={!profileStatus.isComplete}
        />

        <MenuItem
          icon="auto-awesome"
          title="AI Assistant"
          description="Ask questions about routes, stops, or your operation"
          onPress={() => navigation.navigate('AdminChat')}
        />

<MenuItem
          icon="list"
          title="Stop Requests"
          description="See and act on active stop requests"
          onPress={() => navigation.navigate('AdminDriver')}
        />

        {role === 'admin' && (
          <View style={styles.sectionDivider}>
            <Text style={styles.sectionLabel}>Admin</Text>
          </View>
        )}

        {role === 'admin' && (
          <MenuItem
            icon="dashboard"
            title="Dashboard"
            description="Live driver activity and status"
            onPress={() => navigation.navigate('AdminDashboard')}
          />
        )}

        {role === 'admin' && (
          <MenuItem
            icon="bar-chart"
            title="Analytics"
            description="Insights, trends, and raw boarding data"
            onPress={() => navigation.navigate('AdminAnalytics')}
          />
        )}

        {role === 'admin' && (
          <MenuItem
            icon="credit-card"
            title="Billing & Plan"
            description="Manage your subscription, plan limits, and add-ons"
            onPress={() => navigation.navigate('AdminOrgSetup', { initialTab: 'billing' })}
          />
        )}

        {role === 'admin' && (
          <MenuItem
            icon="settings"
            title="Org Setup"
            description={
              needsSetup
                ? 'No stops configured yet — tap to get started'
                : 'Manage stops, routes, and users'
            }
            onPress={() => navigation.navigate('AdminOrgSetup')}
            badge={needsSetup}
          />
        )}

        <MenuItem
          icon="notifications"
          title="Notifications"
          description="Choose which push notifications you receive"
          onPress={() => navigation.navigate('NotificationPrefs')}
        />

        <MenuItem
          icon="accessibility"
          title="Accessibility"
          description="Adjust text size and motion preferences"
          onPress={() => navigation.navigate('Accessibility')}
        />

        <MenuItem
          icon="help-outline"
          title="How to Use"
          description="Step-by-step guide to the app"
          onPress={() => navigation.navigate('HowToUse', { role: role === 'admin' ? 'admin' : 'driver' })}
        />

        <MenuItem
          icon="gavel"
          title="Legal"
          description="Terms of Service and Privacy Policy"
          onPress={() => navigation.navigate('Legal')}
        />

        <MenuItem
          icon="logout"
          title="Logout"
          description="Sign out of your account"
          onPress={handleLogout}
          variant="danger"
        />
      </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.section * 3,
    paddingBottom: spacing.section * 2,
    flexGrow: 1,
  },
  hero: {
    marginBottom: spacing.section * 1.5,
  },
  greeting: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#4b5563',
  },
  menuSection: {
    marginTop: spacing.section,
  },
  sectionDivider: {
    marginTop: spacing.section,
    marginBottom: spacing.item / 2,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
