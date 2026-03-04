// src/screens/LoginScreen.tsx

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';

import { showAlert } from '../src/utils/alerts';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { persistSamlHandoffFromUrl, trySamlHandoffLogin } from '../src/auth/samlAuth';
import { startSamlLogin } from '../src/auth/startSamlLogin';
import * as Linking from 'expo-linking';
import InfoBanner from '../components/InfoBanner';

type UserRole = 'student' | 'driver' | 'admin';

function normalizeRole(value: unknown): UserRole | null {
  if (value === 'student' || value === 'driver' || value === 'admin') {
    return value;
  }
  return null;
}

function deriveDisplayName(user: User) {
  const fromAuth = (user.displayName ?? '').trim();
  if (fromAuth) return fromAuth;

  const email = (user.email ?? '').trim();
  if (email.includes('@')) {
    const prefix = email.split('@')[0]?.trim();
    if (prefix) return prefix;
  }

  return 'Student';
}

// ✅ Updated: upserts BOTH /users and /publicUsers
async function upsertUserProfile(user: User, fallbackRole: UserRole) {
  const userRef = doc(db, 'users', user.uid);
  const existing = await getDoc(userRef);
  const existingRole = normalizeRole(existing.data()?.role);
  const roleToPersist = existingRole ?? fallbackRole;

  const displayName = deriveDisplayName(user);

  // 1) Private user profile (role lives here)
  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email ?? null,
      role: roleToPersist,
      displayName, // optional, fine to keep here too (private)
      lastLoginAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 2) Public profile (safe fields only; readable by drivers)
  await setDoc(
    doc(db, 'publicUsers', user.uid),
    {
      displayName,
      // You can add other safe fields later if needed (e.g., firstName only)
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export default function LoginScreen() {
  const [isCheckingSaml, setIsCheckingSaml] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const finishStudentLogin = useCallback(async (user: User) => {
    await upsertUserProfile(user, 'student');
  }, []);

  const handleSchoolSso = useCallback(async () => {
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);

      const signedIn = await trySamlHandoffLogin();
      if (signedIn) {
        const resolved = auth.currentUser;
        if (!resolved) throw new Error('School SSO completed but no Firebase session found.');
        await finishStudentLogin(resolved);
        return;
      }

      const redirectUrl = await startSamlLogin();
      if (!redirectUrl) return;

      await persistSamlHandoffFromUrl(redirectUrl);
      const signedInFromRedirect = await trySamlHandoffLogin(redirectUrl);
      if (!signedInFromRedirect) {
        throw new Error(
          'School SSO finished but no handoff token was found. Check ACS redirect and RelayState.'
        );
      }

      const resolved = auth.currentUser;
      if (!resolved) throw new Error('School SSO completed but no Firebase session found.');
      await finishStudentLogin(resolved);
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
        }
      } catch (e: any) {
        showAlert(e?.message ?? 'Unknown error', 'School SSO Error');
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.content}>
        <View style={styles.hero}>
          <Image source={require('../assets/mck.avif')} style={styles.logo} resizeMode="contain" />
        </View>

        <InfoBanner
          icon="lightbulb-outline"
          title="Sign in with School SSO"
          description="Use your campus SAML account to continue. Your role and app access are determined after login."
          style={styles.helperBanner}
        />

        <View style={styles.card}>
          {isCheckingSaml && <ActivityIndicator style={styles.loadingIndicator} size="small" />}

          <AppButton
            label={isSubmitting ? 'Please wait…' : 'Continue with School SSO (SAML)'}
            onPress={handleSchoolSso}
            style={styles.primaryButton}
            disabled={isCheckingSaml || isSubmitting}
          />
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section * 1.5,
    ...cardShadow,
  },
  primaryButton: {
    marginTop: spacing.item / 2,
  },
  loadingIndicator: { marginBottom: spacing.item },
  logo: {
    width: 140,
    height: 140,
    marginBottom: spacing.item,
  },
});