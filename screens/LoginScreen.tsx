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
  Image,
} from 'react-native';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';

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
import { persistSamlHandoffFromUrl, trySamlHandoffLogin } from '../src/auth/samlAuth';
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

async function upsertUserProfile(user: User, role: 'student' | 'driver' | 'admin') {
  // NOTE: merge:true so we never wipe existing fields
  await setDoc(
    doc(db, 'users', user.uid),
    {
      uid: user.uid,
      email: user.email ?? null,
      role,
      lastLoginAt: serverTimestamp(),
      // createdAt only set on first create by using merge + checking not possible in client rules;
      // fine to always send; serverTimestamp will just overwrite, but that's okay for now.
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [isDriver, setIsDriver] = useState(false);

  const [isCheckingSaml, setIsCheckingSaml] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const finishStudentLogin = useCallback(
    async (user: User) => {
      await upsertUserProfile(user, 'student');
      navigation.replace('StudentHome');
    },
    [navigation]
  );

  const handleLogin = useCallback(async () => {
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    // TEMP driver gate (NOT secure) — keep for demo/testing only.
      if (isDriver) {
      try {
        setIsSubmitting(true);

        const cred = await signInWithEmailAndPassword(
          auth,
          trimmedEmail,
          trimmedPassword
        );

        await upsertUserProfile(cred.user, 'driver');

        navigation.replace('DriverHome');
      } catch (err: any) {
        showAlert(err?.message ?? 'Driver login failed');
      } finally {
        setIsSubmitting(false);
      }
      return;
  }


    try {
      setIsSubmitting(true);

      try {
        const cred = await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
        await finishStudentLogin(cred.user);
      } catch (err: any) {
        if (err?.code === 'auth/user-not-found') {
          const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
          await finishStudentLogin(cred.user);
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      showAlert(err?.message ?? 'Unknown error', 'Login Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, isDriver, navigation, finishStudentLogin, isSubmitting]);

  const handleQuickLaunch = useCallback(async () => {
    if (isSubmitting) return;
    try {
      setIsSubmitting(true);
      const user = await signInWithQuickLaunch(); // should return Firebase user or sign in under the hood
      // If your function doesn't return a user, use auth.currentUser
      const resolved = (user as any)?.user ?? auth.currentUser;
      if (!resolved) throw new Error('SSO completed but no Firebase session found.');
      await finishStudentLogin(resolved);
    } catch (e: any) {
      showAlert(e?.message ?? 'Unknown error', 'SSO Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [finishStudentLogin, isSubmitting]);

  const handleSchoolSso = useCallback(async () => {
    if (isSubmitting) return;
    try {
      setIsSubmitting(true);

      const signedIn = await trySamlHandoffLogin();
      if (signedIn) {
        const resolved = auth.currentUser;
        if (!resolved) throw new Error('School SSO completed but no Firebase session found.');
        await finishStudentLogin(resolved);
      } else {
        showAlert(
          'Open the shuttle app from the school app to reuse your SSO session.',
          'Waiting for school SSO'
        );
      }
    } catch (e: any) {
      showAlert(e?.message ?? 'Unknown error', 'School SSO Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [finishStudentLogin, isSubmitting]);

  useEffect(() => {
    let isMounted = true;

    const attemptSamlLogin = async () => {
      try {
        const signedIn = await trySamlHandoffLogin();
        if (signedIn && isMounted) {
          const resolved = auth.currentUser;
          if (resolved) {
            await upsertUserProfile(resolved, 'student');
            navigation.replace('StudentHome');
          } else {
            navigation.replace('StudentHome');
          }
        }
      } catch (e: any) {
        showAlert(e?.message ?? 'Unknown error', 'School SSO Error');
      } finally {
        if (isMounted) setIsCheckingSaml(false);
      }
    };

    attemptSamlLogin();

    const subscription = Linking.addEventListener('url', async ({ url }) => {
      await persistSamlHandoffFromUrl(url);
      try {
        const signedIn = await trySamlHandoffLogin(url);
        if (signedIn && isMounted) {
          const resolved = auth.currentUser;
          if (resolved) {
            await upsertUserProfile(resolved, 'student');
          }
          navigation.replace('StudentHome');
        }
      } catch (e: any) {
        showAlert(e?.message ?? 'Unknown error', 'School SSO Error');
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
              {/* Prefer PNG/JPG for reliability */}
              <Image
                source={require('../assets/mck.avif')}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            <InfoBanner
              icon="lightbulb-outline"
              title="Need a quick refresher?"
              description="Use your @mckendree.edu email to sign in. Toggle Driver mode for bus staff, or tap Quick Launch / School SSO to reuse your campus login."
              style={styles.helperBanner}
            />

            {isDriver && (
              <View style={styles.driverWarning}>
                <Text style={styles.driverWarningText}>
                  Driver mode is currently a temporary demo login. For production, drivers will use
                  SSO/Firebase Auth and role-based access.
                </Text>
              </View>
            )}

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
                label={isSubmitting ? 'Please wait…' : 'Login / Sign Up'}
                onPress={handleLogin}
                style={styles.primaryButton}
                disabled={isSubmitting}
              />

              <AppButton
                label={isCheckingSaml ? 'Checking SSO…' : 'Use School SSO (SAML)'}
                onPress={handleSchoolSso}
                variant="secondary"
                style={styles.secondaryButton}
                disabled={isCheckingSaml || isSubmitting}
              />

              <AppButton
                label="Login with QuickLaunch"
                onPress={handleQuickLaunch}
                variant="secondary"
                style={styles.secondaryButton}
                disabled={isSubmitting}
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
    marginBottom: spacing.section,
  },
  helperBanner: {
    marginBottom: spacing.section,
  },
  driverWarning: {
    backgroundColor: '#fff7ed',
    borderRadius: 12,
    padding: 12,
    marginBottom: spacing.section,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  driverWarningText: {
    color: '#9a3412',
    fontSize: 13,
    lineHeight: 18,
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
  logo: {
    width: 140,
    height: 140,
    marginBottom: spacing.item,
  },
});
