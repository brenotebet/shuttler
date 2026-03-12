// screens/AuthScreen.tsx
//
// Step 2 of the login flow. Renders the correct auth panel based on the
// selected org's authMethod: SAML, email/password, or Google.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { type RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
import * as Linking from 'expo-linking';
import { RootStackParamList } from '../navigation/StackNavigator';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import InfoBanner from '../components/InfoBanner';
import { useOrg } from '../src/org/OrgContext';
import { persistSamlHandoffFromUrl, trySamlHandoffLogin } from '../src/auth/samlAuth';
import { startSamlLogin } from '../src/auth/startSamlLogin';
import { showAlert } from '../src/utils/alerts';
import { auth } from '../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../config';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Auth'>;
type RouteT = RouteProp<RootStackParamList, 'Auth'>;

// ---- SAML Panel ----

function SamlPanel({ orgSlug }: { orgSlug: string }) {
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    // Try completing a pending SAML handoff on mount (e.g. after deep link redirect)
    (async () => {
      try {
        await trySamlHandoffLogin();
      } catch {
        // No pending token — that's fine
      } finally {
        if (isMounted.current) setIsChecking(false);
      }
    })();

    const sub = Linking.addEventListener('url', async ({ url }) => {
      await persistSamlHandoffFromUrl(url);
      try {
        await trySamlHandoffLogin(url);
      } catch (e: any) {
        showAlert(e?.message ?? 'SSO error', 'Sign In Error');
      }
    });

    return () => sub.remove();
  }, []);

  const handleSso = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const redirectUrl = await startSamlLogin(orgSlug);
      if (!redirectUrl) return;
      await persistSamlHandoffFromUrl(redirectUrl);
      const ok = await trySamlHandoffLogin(redirectUrl);
      if (!ok) throw new Error('SSO finished but sign-in did not complete. Please try again.');
    } catch (e: any) {
      showAlert(e?.message ?? 'Unknown SSO error', 'Sign In Error');
    } finally {
      if (isMounted.current) setIsSubmitting(false);
    }
  }, [isSubmitting, orgSlug]);

  return (
    <>
      <InfoBanner
        icon="lightbulb-outline"
        title="Sign in with your organization SSO"
        description="You'll be redirected to your organization's identity provider to authenticate."
        style={styles.banner}
      />
      <View style={styles.card}>
        {isChecking && <ActivityIndicator style={styles.loadingIndicator} size="small" />}
        <AppButton
          label={isSubmitting ? 'Please wait…' : 'Continue with SSO'}
          onPress={handleSso}
          style={styles.primaryButton}
          disabled={isChecking || isSubmitting}
        />
      </View>
    </>
  );
}

// ---- Email Panel ----

function EmailPanel({ orgSlug }: { orgSlug: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSignIn = useCallback(async () => {
    if (!email.trim() || !password) return;
    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e: any) {
      const msg =
        e?.code === 'auth/invalid-credential' || e?.code === 'auth/wrong-password'
          ? 'Incorrect email or password.'
          : e?.code === 'auth/user-not-found'
          ? 'No account found with that email.'
          : e?.message ?? 'Sign in failed.';
      showAlert(msg, 'Sign In Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password]);

  const handleSignUp = useCallback(async () => {
    if (!email.trim() || !password || !displayName.trim()) {
      showAlert('Please fill in all fields.', 'Missing Info');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`${SHUTTLER_API_URL}/auth/email/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug, email: email.trim(), password, displayName: displayName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Registration failed.');
      // Account created — sign in and send verification email
      await signInWithEmailAndPassword(auth, email.trim(), password);
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser).catch(() => {});
      }
    } catch (e: any) {
      showAlert(e?.message ?? 'Registration failed.', 'Sign Up Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, displayName, orgSlug]);

  const handleForgotPassword = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      showAlert('Enter your email address above, then tap "Forgot password?".', 'Email required');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, trimmed);
      showAlert(`Password reset email sent to ${trimmed}. Check your inbox.`, 'Email sent');
    } catch (e: any) {
      const msg =
        e?.code === 'auth/user-not-found'
          ? 'No account found with that email.'
          : e?.message ?? 'Failed to send reset email.';
      showAlert(msg, 'Error');
    }
  }, [email]);

  return (
    <View style={styles.card}>
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, mode === 'signin' && styles.tabActive]}
          onPress={() => setMode('signin')}
        >
          <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === 'signup' && styles.tabActive]}
          onPress={() => setMode('signup')}
        >
          <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Create Account</Text>
        </TouchableOpacity>
      </View>

      {mode === 'signup' && (
        <TextInput
          style={styles.input}
          placeholder="Full name"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          autoCorrect={false}
          placeholderTextColor="#aaa"
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#aaa"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholderTextColor="#aaa"
      />

      <AppButton
        label={
          isSubmitting
            ? 'Please wait…'
            : mode === 'signin'
            ? 'Sign In'
            : 'Create Account'
        }
        onPress={mode === 'signin' ? handleSignIn : handleSignUp}
        style={styles.primaryButton}
        disabled={isSubmitting}
      />

      {mode === 'signin' && (
        <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotButton}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---- Main AuthScreen ----

export default function AuthScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const { org } = useOrg();

  if (!org) {
    // Org not loaded yet — go back to selector
    navigation.replace('OrgSelector');
    return null;
  }

  const renderContent = () => {
    switch (org.authMethod) {
      case 'saml':
        return <SamlPanel orgSlug={org.slug} />;
      case 'email':
        return <EmailPanel orgSlug={org.slug} />;
      default:
        return (
          <View style={styles.card}>
            <Text style={styles.unsupportedText}>
              Auth method "{org.authMethod}" is not yet supported in this version.
            </Text>
          </View>
        );
    }
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Back to org selector */}
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.replace('OrgSelector')}>
          <Icon name="arrow-back" size={20} color={PRIMARY_COLOR} />
          <Text style={styles.backText}>Change organization</Text>
        </TouchableOpacity>

        {/* Org identity */}
        <View style={styles.orgHeader}>
          {org.logoUrl ? (
            <Image source={{ uri: org.logoUrl }} style={styles.orgLogo} resizeMode="contain" />
          ) : (
            <View style={[styles.orgLogo, styles.orgLogoPlaceholder]}>
              <Icon name="directions-bus" size={30} color={PRIMARY_COLOR} />
            </View>
          )}
          <Text style={styles.orgName}>{org.name}</Text>
        </View>

        {renderContent()}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.item,
    paddingHorizontal: spacing.section,
    gap: 6,
  },
  backText: {
    color: PRIMARY_COLOR,
    fontSize: 14,
  },
  orgHeader: {
    alignItems: 'center',
    paddingVertical: spacing.section,
  },
  orgLogo: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.item,
  },
  orgLogoPlaceholder: {
    backgroundColor: '#f0f4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
  },
  banner: {
    marginHorizontal: spacing.section,
    marginBottom: spacing.section,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    marginHorizontal: spacing.section,
    ...cardShadow,
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: spacing.item,
    borderRadius: borderRadius.md,
    backgroundColor: '#f2f2f2',
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  tabActive: {
    backgroundColor: '#fff',
    ...cardShadow,
  },
  tabText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  tabTextActive: {
    color: PRIMARY_COLOR,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.item,
    paddingVertical: Platform.OS === 'ios' ? 12 : 9,
    fontSize: 15,
    color: '#111',
    marginBottom: spacing.item / 2,
  },
  primaryButton: {
    marginTop: spacing.item / 2,
  },
  loadingIndicator: {
    marginBottom: spacing.item,
  },
  forgotButton: {
    alignItems: 'center',
    paddingTop: spacing.item,
  },
  forgotText: {
    color: PRIMARY_COLOR,
    fontSize: 14,
  },
  unsupportedText: {
    color: '#888',
    textAlign: 'center',
    fontSize: 14,
  },
});
