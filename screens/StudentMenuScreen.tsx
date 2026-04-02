// src/screens/StudentMenuScreen.tsx

import React from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { signOut } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ScreenContainer from '../components/ScreenContainer';
import MenuItem from '../components/MenuItem';
import { auth } from '../firebase/firebaseconfig';
import { clearSamlSession } from '../src/auth/samlAuth';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { spacing } from '../src/styles/common';
import type { RootStackParamList } from '../navigation/StackNavigator';

export default function StudentMenuScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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
    <ScreenContainer style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title}>Student Center</Text>
        <Text style={styles.subtitle}>Manage your rides and profile</Text>
      </View>

      <View style={styles.menuSection}>
        <MenuItem
          icon="history"
          title="History"
          description="Take a look at your past completed rides"
          onPress={() => navigation.navigate('StudentHistory')}
        />

        <MenuItem
          icon="help-outline"
          title="How to Use"
          description="Step-by-step guide to requesting a ride"
          onPress={() => navigation.navigate('HowToUse', { role: 'student' })}
        />

        <MenuItem
          icon="logout"
          title="Logout"
          description="Sign out of your account"
          onPress={handleLogout}
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
