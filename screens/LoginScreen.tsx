// src/screens/LoginScreen.tsx

import React, { useState, useCallback, useEffect } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  Switch,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { signInWithQuickLaunch } from '../quicklaunch/quicklaunchAuth';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import { useDriver } from '../drivercontext/DriverContext';
import { showAlert } from '../src/utils/alerts';
import { PRIMARY_COLOR } from '../src/constants/theme';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import FormField from '../components/FormField';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import {
  persistSamlHandoffFromUrl,
  trySamlHandoffLogin,
} from '../src/auth/samlAuth';
import * as Linking from 'expo-linking';
import InfoBanner from '../components/InfoBanner';

const adminAccounts: { [key: string]: string } = {
  driver1: 'bus123',
  driver2: 'bus456',
  driver3: 'bus789',
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isDriver, setIsDriver] = useState(false);
  const { setDriverId } = useDriver();
  const [isCheckingSaml, setIsCheckingSaml] = useState(true);

  const handleLogin = useCallback(async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (isDriver) {
      if (adminAccounts[trimmedEmail] === trimmedPassword) {
        setDriverId(trimmedEmail);
        navigation.replace('DriverHome');
      } else {
        showAlert('Invalid driver credentials');
      }
      return;
    }

    if (!trimmedEmail.endsWith('@mckendree.edu')) {
      showAlert('Only McKendree emails are allowed.');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
      navigation.replace('StudentHome');
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        try {
          await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
          navigation.replace('StudentHome');
        } catch (e: any) {
          showAlert(e.message, 'Error creating account');
        }
      } else {
        showAlert(err.message, 'Login Error');
      }
    }
  }, [email, password, isDriver, navigation, setDriverId]);

  const handleQuickLaunch = useCallback(async () => {
    try {
      await signInWithQuickLaunch();
      navigation.replace('StudentHome');
    } catch (e: any) {
      showAlert(e.message, 'SSO Error');
    }
  }, [navigation]);

  const handleSchoolSso = useCallback(async () => {
    try {
      const signedIn = await trySamlHandoffLogin();
      if (signedIn) {
        navigation.replace('StudentHome');
      } else {
        showAlert(
          'Open the shuttle app from the school app to reuse your SSO session.',
          'Waiting for school SSO',
        );
      }
    } catch (e: any) {
      showAlert(e.message, 'School SSO Error');
    }
  }, [navigation]);

  useEffect(() => {
    let isMounted = true;

    const attemptSamlLogin = async () => {
      try {
        const signedIn = await trySamlHandoffLogin();
        if (signedIn && isMounted) {
          navigation.replace('StudentHome');
        }
      } catch (e: any) {
        showAlert(e.message, 'School SSO Error');
      } finally {
        if (isMounted) {
          setIsCheckingSaml(false);
        }
      }
    };

    attemptSamlLogin();

    const subscription = Linking.addEventListener('url', async ({ url }) => {
      await persistSamlHandoffFromUrl(url);
      try {
        const signedIn = await trySamlHandoffLogin(url);
        if (signedIn && isMounted) {
          navigation.replace('StudentHome');
        }
      } catch (e: any) {
        showAlert(e.message, 'School SSO Error');
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [navigation]);

  return (
    <ScreenContainer>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.content}>
            <View style={styles.hero}>
              <Text style={styles.brand}>BogeyBus</Text>
              <Text style={styles.subtitle}>
                Seamless rides for students and drivers alike.
              </Text>
            </View>

            <InfoBanner
              icon="lightbulb-outline"
              title="Need a quick refresher?"
              description="Use your @mckendree.edu email to sign in. Toggle Driver mode for bus staff, or tap Quick Launch / School SSO to reuse your campus login."
              style={styles.helperBanner}
            />

            <View style={styles.card}>
              <FormField
                label={isDriver ? 'Driver ID' : 'Student Email'}
                placeholder={isDriver ? 'driver1' : 'you@mckendree.edu'}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />

              <FormField
                label="Password"
                placeholder="••••••••"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Login as Driver</Text>
                <Switch
                  trackColor={{ false: '#d1d5db', true: PRIMARY_COLOR }}
                  thumbColor="#fff"
                  onValueChange={setIsDriver}
                  value={isDriver}
                />
              </View>

              <AppButton
                label="Login / Sign Up"
                onPress={handleLogin}
                style={styles.primaryButton}
              />

              <AppButton
                label="Use School SSO (SAML)"
                onPress={handleSchoolSso}
                variant="secondary"
                style={styles.secondaryButton}
                disabled={isCheckingSaml}
              />

              <AppButton
                label="Login with QuickLaunch"
                onPress={handleQuickLaunch}
                variant="secondary"
                style={styles.secondaryButton}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.section * 1.5,
  },
  brand: {
    fontSize: 32,
    fontWeight: '700',
    color: PRIMARY_COLOR,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    textAlign: 'center',
    color: '#4b5563',
  },
  helperBanner: {
    marginBottom: spacing.section,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section * 1.5,
    ...cardShadow,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.section,
  },
  switchLabel: {
    fontSize: 16,
    color: '#333',
  },
  primaryButton: {
    marginBottom: spacing.item,
  },
  secondaryButton: {
    marginTop: spacing.item / 2,
  },
});
