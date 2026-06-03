// src/screens/StudentMenuScreen.tsx

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Switch, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ScreenContainer from '../components/ScreenContainer';
import MenuItem from '../components/MenuItem';
import { auth } from '../firebase/firebaseconfig';
import { clearSamlSession } from '../src/auth/samlAuth';
import { useAuth } from '../src/auth/AuthProvider';
import { spacing } from '../src/styles/common';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useAccessibility } from '../src/contexts/AccessibilityContext';
import { FEEDBACK_ENABLED_KEY } from '../src/components/PickupConfirmModal';
import type { RootStackParamList } from '../navigation/StackNavigator';

export default function StudentMenuScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { role, displayName } = useAuth();
  const { primaryColor } = useOrgTheme();
  const isParent = role === 'parent';
  const firstName = displayName?.split(' ')[0] ?? null;
  const { fontScale } = useAccessibility();
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(FEEDBACK_ENABLED_KEY).then((val) => {
      if (val === 'false') setFeedbackEnabled(false);
    });
  }, []);

  const toggleFeedback = (value: boolean) => {
    setFeedbackEnabled(value);
    AsyncStorage.setItem(FEEDBACK_ENABLED_KEY, value ? 'true' : 'false');
  };

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
      await clearSamlSession();
      await signOut(auth);
    } catch (err) {
      console.error('Error signing out', err);
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
        <Text style={[styles.title, { color: primaryColor, fontSize: 28 * fontScale }]}>{isParent ? 'Parent Center' : 'Rider Center'}</Text>
        <Text style={[styles.subtitle, { fontSize: 15 * fontScale }]}>
          {isParent ? 'Track your child\'s shuttle' : 'Manage your rides and profile'}
        </Text>
      </View>

      <View style={styles.menuSection}>
        {isParent && (
          <MenuItem
            icon="people"
            title="My Children"
            description="Link your child's account to track their shuttle"
            onPress={() => navigation.navigate('ParentChildLink')}
          />
        )}

        <MenuItem
          icon="person"
          title="My Profile"
          description="Edit your name, phone, and preferences"
          onPress={() => navigation.navigate('Profile')}
        />

        <MenuItem
          icon="auto-awesome"
          title="AI Assistant"
          description="Ask questions about routes, stops, or how to use the app"
          onPress={() => navigation.navigate('AdminChat')}
        />

<MenuItem
          icon="help-outline"
          title="How to Use"
          description={isParent ? 'Guide for parents tracking the shuttle' : 'Step-by-step guide to requesting a ride'}
          onPress={() => navigation.navigate('HowToUse', { role: isParent ? 'parent' : 'student' })}
        />

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Pickup Feedback</Text>
            <Text style={styles.toggleDesc}>After a confirmed pickup, show a one-question survey</Text>
          </View>
          <Switch
            value={feedbackEnabled}
            onValueChange={toggleFeedback}
            trackColor={{ false: '#e5e7eb', true: `${primaryColor}60` }}
            thumbColor={feedbackEnabled ? primaryColor : '#9ca3af'}
          />
        </View>

        <MenuItem
          icon="accessibility"
          title="Accessibility"
          description="Adjust text size and motion preferences"
          onPress={() => navigation.navigate('Accessibility')}
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    marginBottom: 4,
  },
  toggleInfo: { flex: 1, marginRight: 16 },
  toggleTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  toggleDesc: { fontSize: 13, color: '#6b7280', marginTop: 2 },
});
