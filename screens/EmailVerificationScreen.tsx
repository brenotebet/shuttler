// screens/EmailVerificationScreen.tsx

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { sendEmailVerification, signOut } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { showAlert } from '../src/utils/alerts';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { spacing, borderRadius, cardShadow } from '../src/styles/common';
import { useAuth } from '../src/auth/AuthProvider';
import Icon from 'react-native-vector-icons/MaterialIcons';

export default function EmailVerificationScreen() {
  const { reloadUser } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  const email = auth.currentUser?.email ?? '';

  const handleCheck = async () => {
    setChecking(true);
    try {
      await reloadUser();
      if (!auth.currentUser?.emailVerified) {
        showAlert("Your email hasn't been verified yet. Click the link in the email we sent you.", 'Not verified yet');
      }
      // If emailVerified is now true, AuthProvider state updates and StackNavigator re-routes automatically.
    } catch (e: any) {
      showAlert(e?.message ?? 'Could not check verification status.', 'Error');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (!auth.currentUser) return;
    setResending(true);
    try {
      await sendEmailVerification(auth.currentUser);
      showAlert(`Verification email sent to ${email}.`, 'Email sent');
    } catch (e: any) {
      const msg =
        e?.code === 'auth/too-many-requests'
          ? 'Too many requests. Please wait a few minutes before trying again.'
          : e?.message ?? 'Failed to resend verification email.';
      showAlert(msg, 'Error');
    } finally {
      setResending(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <Icon name="mark-email-unread" size={64} color={PRIMARY_COLOR} style={styles.icon} />

        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.body}>
          We sent a verification link to{'\n'}
          <Text style={styles.email}>{email}</Text>
        </Text>
        <Text style={styles.hint}>
          Click the link in the email, then tap the button below to continue.
        </Text>

        <View style={styles.card}>
          <AppButton
            label={checking ? 'Checking…' : "I've verified my email"}
            onPress={handleCheck}
            disabled={checking}
          />

          <TouchableOpacity
            onPress={handleResend}
            disabled={resending}
            style={styles.resendButton}
          >
            <Text style={styles.resendText}>
              {resending ? 'Sending…' : 'Resend verification email'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleSignOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.section,
  },
  icon: {
    marginBottom: spacing.section,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
    marginBottom: spacing.item,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.item / 2,
  },
  email: {
    fontWeight: '600',
    color: '#111',
  },
  hint: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.section,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    ...cardShadow,
    marginBottom: spacing.section,
  },
  resendButton: {
    alignItems: 'center',
    paddingTop: spacing.item,
  },
  resendText: {
    color: PRIMARY_COLOR,
    fontSize: 14,
  },
  signOutButton: {
    paddingVertical: spacing.item / 2,
  },
  signOutText: {
    color: '#9ca3af',
    fontSize: 14,
  },
});
