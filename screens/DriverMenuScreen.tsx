// src/screens/DriverMenuScreen.tsx

import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';

import { useDriver } from '../drivercontext/DriverContext';
import { useLocationSharing } from '../location/LocationContext';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrg } from '../src/org/OrgContext';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { clearSamlSession } from '../src/auth/samlAuth';

import MenuItem from '../components/MenuItem';
import ScreenContainer from '../components/ScreenContainer';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { spacing } from '../src/styles/common';

export default function DriverMenuScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { logout: clearDriverContext } = useDriver();
  const { stopSharing, isSharing } = useLocationSharing();
  const { role, isSuperAdmin, displayName } = useAuth();
  const firstName = displayName?.split(' ')[0] ?? null;
  const { org } = useOrg();
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

      // 3️⃣ Clear SAML session so the next login prompts for fresh credentials
      await clearSamlSession();

      // 4️⃣ Sign out of Firebase Auth
      await signOut(auth);

      // ❌ DO NOT navigate manually
      // StackNavigator will switch to Login automatically
    } catch (err) {
      console.error('Error during driver logout', err);
    }
  };

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.hero}>
        {firstName ? (
          <Text style={styles.greeting}>Hi, {firstName} 👋</Text>
        ) : null}
        <Text style={styles.title}>Driver Hub</Text>
        <Text style={styles.subtitle}>Stay on top of requests and routes</Text>
      </View>

      <View style={styles.menuSection}>
        <MenuItem
          icon="history"
          title="History"
          description="Take a look at your past completed rides"
          onPress={() => navigation.navigate('DriverHistory')}
        />

        <MenuItem
          icon="list"
          title="Requested Rides"
          description="View and manage current ride requests"
          onPress={() => navigation.navigate('AdminDriver')}
        />

        {role === 'admin' && (
          <MenuItem
            icon="dashboard"
            title="Dashboard"
            description="Live driver activity, pickups, and stop trends"
            onPress={() => navigation.navigate('AdminDashboard')}
          />
        )}

        {role === 'admin' && (
          <MenuItem
            icon="settings"
            title="Org Setup"
            description={
              needsSetup
                ? '⚠️ No stops configured — tap to set up your org'
                : 'Manage stops, routes, users and billing'
            }
            onPress={() => navigation.navigate('AdminOrgSetup')}
          />
        )}

        {isSuperAdmin && (
          <MenuItem
            icon="admin-panel-settings"
            title="Org Applications"
            description="Review and approve pending organization sign-ups"
            onPress={() => navigation.navigate('SuperAdmin')}
          />
        )}

        <MenuItem
          icon="help-outline"
          title="How to Use"
          description="Step-by-step guide to the app"
          onPress={() => navigation.navigate('HowToUse', { role: role === 'admin' ? 'admin' : 'driver' })}
        />

        <MenuItem
          icon="logout"
          title="Logout"
          description="Sign out of your account"
          onPress={handleLogout}
          variant="danger"
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.section * 3,
    paddingBottom: spacing.section * 2,
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
    color: PRIMARY_COLOR,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#4b5563',
  },
  menuSection: {
    marginTop: spacing.section,
  },
});
