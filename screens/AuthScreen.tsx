// screens/AuthScreen.tsx
//
// Step 2 of the login flow. Renders the correct auth panel based on the
// selected org's authMethod: SAML or email/password.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { type RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { signInWithEmailAndPassword, signOut, PhoneAuthProvider, signInWithCredential, signInWithPhoneNumber, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { app } from '../firebase/firebaseconfig';
import * as Linking from 'expo-linking';
import { RootStackParamList } from '../navigation/StackNavigator';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import InfoBanner from '../components/InfoBanner';
import { useOrg } from '../src/org/OrgContext';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { persistSamlHandoffFromUrl, trySamlHandoffLogin } from '../src/auth/samlAuth';
import { startSamlLogin } from '../src/auth/startSamlLogin';
import { showAlert } from '../src/utils/alerts';
import { showToast } from '../src/components/Toast';
import ErrorBanner from '../src/components/ErrorBanner';
import { auth, db } from '../firebase/firebaseconfig';
import { SHUTTLER_API_URL, GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID } from '../config';
import { markSocialSignInPending, clearSocialSignInPending } from '../src/auth/socialSignInPending';
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

type FieldErrors = Partial<Record<
  'firstName' | 'lastName' | 'phone' | 'email' | 'password' | 'confirmPassword',
  string
>>;

const PASSWORD_RULES = [
  { key: 'length',    label: 'At least 8 characters',        test: (p: string) => p.length >= 8 },
  { key: 'upper',     label: 'One uppercase letter (A–Z)',    test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower',     label: 'One lowercase letter (a–z)',    test: (p: string) => /[a-z]/.test(p) },
  { key: 'number',    label: 'One number (0–9)',              test: (p: string) => /\d/.test(p) },
  { key: 'special',   label: 'One special character (!@#…)',  test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
const STRENGTH_COLORS = ['#e5e7eb', '#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];

function PasswordStrengthBar({ score }: { score: number }) {
  return (
    <View style={styles.strengthWrap}>
      <View style={styles.strengthBar}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={[
              styles.strengthSegment,
              { backgroundColor: i <= score ? STRENGTH_COLORS[score] : '#e5e7eb' },
            ]}
          />
        ))}
      </View>
      {score > 0 && (
        <Text style={[styles.strengthLabel, { color: STRENGTH_COLORS[score] }]}>
          {STRENGTH_LABELS[score]}
        </Text>
      )}
    </View>
  );
}

function PasswordInput({
  value,
  onChangeText,
  placeholder,
  error,
  label,
  showRequirements,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  error?: string;
  label?: string;
  showRequirements?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);

  const metCount = PASSWORD_RULES.filter((r) => r.test(value)).length;
  const showReqs = showRequirements && (focused || value.length > 0);

  return (
    <>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={[styles.passwordRow, error ? styles.inputError : null]}>
        <TextInput
          style={styles.passwordInput}
          placeholder={placeholder}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#aaa"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <TouchableOpacity onPress={() => setVisible((v) => !v)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Icon name={visible ? 'visibility-off' : 'visibility'} size={20} color="#9ca3af" />
        </TouchableOpacity>
      </View>
      {showReqs && (
        <View style={styles.reqList}>
          <PasswordStrengthBar score={metCount} />
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(value);
            return (
              <View key={rule.key} style={styles.reqRow}>
                <Icon
                  name={met ? 'check-circle' : 'radio-button-unchecked'}
                  size={13}
                  color={met ? '#16a34a' : '#9ca3af'}
                />
                <Text style={[styles.reqText, met && styles.reqTextMet]}>{rule.label}</Text>
              </View>
            );
          })}
        </View>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </>
  );
}

function EmailPanel({ orgSlug, orgId, initialEmail }: { orgSlug: string; orgId: string; initialEmail?: string }) {
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [mode, setMode] = useState<'signin' | 'signup'>(initialEmail ? 'signup' : 'signin');

  // ---- Google Sign-In ----
  const [, googleResponse, promptGoogleAsync] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID || undefined,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
  });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Shared post-auth handler for Google and Apple sign-in.
  // User doc creation is fully delegated to the backend so Admin SDK handles
  // the Firestore write — the client-side Firestore security rule for user doc
  // creation calls orgIsActive(), which requires existing membership to read
  // the org doc, creating a deadlock for brand-new users.
  const completeSocialSignIn = useCallback(async (
    firebaseUser: import('firebase/auth').User,
  ) => {
    // Detect multi-org: user already has a claim for a different org.
    let claimedOrgId: string | undefined;
    try {
      const tokenResult = await firebaseUser.getIdTokenResult();
      claimedOrgId = tokenResult.claims.orgId as string | undefined;
    } catch {}
    const isAddingToExistingAccount = !!(claimedOrgId && claimedOrgId !== orgId);

    const token = await firebaseUser.getIdToken();
    const res = await fetch(`${SHUTTLER_API_URL}/auth/social/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? 'Failed to complete sign-in. Please try again.');
    }
    const { isNew } = await res.json();

    if (isNew) {
      showToast(
        isAddingToExistingAccount
          ? (org?.name ? `Added to ${org.name}!` : 'Added to organization!')
          : 'Account created! Welcome to Shuttler.',
        'success',
      );
    }
  }, [orgId, org?.name]);

  // React to Google OAuth response
  useEffect(() => {
    if (googleResponse?.type !== 'success') {
      if (googleResponse?.type === 'error') {
        setFormError('Google sign-in was cancelled or failed. Please try again.');
      }
      return;
    }
    const idToken = (googleResponse as any).params?.id_token;
    if (!idToken) {
      setFormError('Google did not return a token. Please try again.');
      return;
    }

    setIsSocialLoading(true);
    const credential = GoogleAuthProvider.credential(idToken);
    // Mark pending BEFORE signInWithCredential so AuthProvider's snapshot
    // doesn't evict the user while the user doc is being created.
    markSocialSignInPending();
    (async () => {
      try {
        const result = await signInWithCredential(auth, credential);
        await completeSocialSignIn(result.user);
      } catch (e: any) {
        // Ensure clean auth state — no half-authenticated user stuck in memory.
        await signOut(auth).catch(() => {});
        const msg =
          e?.code === 'auth/account-exists-with-different-credential'
            ? 'An account already exists with this email using a different sign-in method.'
            : e?.code === 'auth/invalid-credential'
            ? 'Google sign-in failed — please try again. If the problem persists, contact support.'
            : e?.message ?? 'Google sign-in failed.';
        // showAlert persists across navigation (rendered at root), so the user
        // sees it even if they're sent back to OrgSelector.
        showAlert(msg, 'Sign In Failed');
      } finally {
        clearSocialSignInPending();
        setIsSocialLoading(false);
      }
    })();
  }, [googleResponse, completeSocialSignIn]);

  const handleAppleSignIn = useCallback(async () => {
    setIsSocialLoading(true);
    setFormError(null);
    try {
      const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        nonce,
      );
      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!appleCredential.identityToken) {
        throw new Error('Apple did not return a sign-in token. Please try again.');
      }
      const provider = new OAuthProvider('apple.com');
      const firebaseCredential = provider.credential({
        idToken: appleCredential.identityToken,
        rawNonce: nonce,
      });
      // Mark pending BEFORE signInWithCredential so AuthProvider's snapshot
      // doesn't evict the user while the user doc is being created.
      markSocialSignInPending();
      const result = await signInWithCredential(auth, firebaseCredential);
      await completeSocialSignIn(result.user);
    } catch (e: any) {
      // Ensure clean auth state — no half-authenticated user stuck in memory.
      await signOut(auth).catch(() => {});
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      const msg =
        e?.code === 'auth/account-exists-with-different-credential'
          ? 'An account already exists with this email using a different sign-in method.'
          : e?.code === 'auth/invalid-credential'
          ? 'Apple sign-in failed — invalid credential. Please try again.'
          : e?.code === 'auth/user-disabled'
          ? 'This account has been disabled. Contact support for help.'
          : e?.message ?? 'Apple sign-in failed. Please try again.';
      // showAlert persists across navigation (rendered at root), so the user
      // sees it even if they're sent back to OrgSelector.
      showAlert(msg, 'Sign In Failed');
    } finally {
      clearSocialSignInPending();
      setIsSocialLoading(false);
    }
  }, [completeSocialSignIn]);

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setErrors({});
    setFormError(null);
    setFirstName('');
    setLastName('');
    setPhone('');
    setPassword('');
    setConfirmPassword('');
    setAgreedToTerms(false);
  };

  const validate = (): boolean => {
    const errs: FieldErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\+?[\d\s\-(). ]{7,15}$/;

    if (!email.trim() || !emailRegex.test(email.trim())) {
      errs.email = 'Enter a valid email address.';
    }
    if (!password) {
      errs.password = 'Password is required.';
    } else if (mode === 'signup') {
      const unmet = PASSWORD_RULES.filter((r) => !r.test(password));
      if (unmet.length > 0) {
        errs.password = `Password must include: ${unmet.map((r) => r.label.toLowerCase()).join(', ')}.`;
      }
    } else if (password.length < 8) {
      errs.password = 'Password must be at least 8 characters.';
    }

    if (mode === 'signup') {
      if (!firstName.trim()) errs.firstName = 'First name is required.';
      if (!lastName.trim()) errs.lastName = 'Last name is required.';
      if (!phone.trim()) {
        errs.phone = 'Phone number is required.';
      } else if (!phoneRegex.test(phone.trim())) {
        errs.phone = 'Enter a valid phone number.';
      }
      if (!confirmPassword) {
        errs.confirmPassword = 'Please confirm your password.';
      } else if (password !== confirmPassword) {
        errs.confirmPassword = 'Passwords do not match.';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSignIn = useCallback(async () => {
    setFormError(null);
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);

      // Read token claims NOW while we're definitively authenticated.
      // Doing this before getDoc avoids a race where AuthProvider's snapshot
      // fires permission-denied and signs the user out before we can read claims.
      let claimedOrgId: string | undefined;
      try {
        const tokenResult = await cred.user.getIdTokenResult();
        claimedOrgId = tokenResult.claims.orgId as string | undefined;
      } catch {}

      // Verify this account belongs to the selected org.
      const userRef = doc(db, 'orgs', orgId, 'users', cred.user.uid);
      let memberExists = false;
      try {
        const snap = await getDoc(userRef);
        memberExists = snap.exists();
      } catch {
        // permission-denied — not a member of this org
      }

      if (!memberExists) {
        // Build the message before signing out so we always have the right copy.
        let message = "You don't have an account with this organization. Ask your administrator to add you.";
        let title = 'Access Denied';
        if (claimedOrgId && claimedOrgId !== orgId) {
          try {
            const orgRes = await fetch(`${SHUTTLER_API_URL}/orgs/by-id/${claimedOrgId}`);
            if (orgRes.ok) {
              const otherOrg = await orgRes.json();
              message = `Your account is registered with "${otherOrg.name}". Go back and select that organization, or create a new account here.`;
              title = 'Wrong Organization';
            }
          } catch {}
        }
        await signOut(auth);
        showAlert(message, title);
        return;
      }

      await updateDoc(userRef, { lastLoginAt: serverTimestamp() }).catch(() => {});
      // Success — AuthProvider's snapshot resolves the role.
      // StackNavigator routes to EmailVerificationScreen if email is not yet verified.
    } catch (e: any) {
      const msg =
        e?.code === 'auth/invalid-credential' || e?.code === 'auth/wrong-password'
          ? 'Incorrect email or password.'
          : e?.code === 'auth/user-not-found'
          ? 'No account found with that email.'
          : e?.message ?? 'Sign in failed.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, orgId]);

  const handleSignUp = useCallback(async () => {
    setFormError(null);
    if (!validate()) return;
    if (!agreedToTerms) {
      setFormError('Please accept the Terms of Service and Privacy Policy to continue.');
      return;
    }
    setIsSubmitting(true);
    const displayName = `${firstName.trim()} ${lastName.trim()}`;
    try {
      const res = await fetch(`${SHUTTLER_API_URL}/auth/email/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgSlug,
          email: email.trim(),
          password,
          displayName,
          phone: phone.trim(),
          agreedToTerms: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Registration failed.');
      await signInWithEmailAndPassword(auth, email.trim(), password);
      if (auth.currentUser) {
        // Send branded verification email via backend instead of Firebase default
        const token = await auth.currentUser.getIdToken();
        fetch(`${SHUTTLER_API_URL}/auth/send-verification`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {}); // fire-and-forget; user can resend from EmailVerificationScreen
        showToast('Account created! Check your email to verify your address.', 'success');
      }
    } catch (e: any) {
      const msg =
        e?.message?.includes('already') || e?.message?.includes('email-already-in-use')
          ? 'An account with that email already exists. Try signing in instead.'
          : e?.message ?? 'Registration failed. Please try again.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, firstName, lastName, phone, confirmPassword, agreedToTerms, orgSlug, mode]);

  const handleForgotPassword = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setFormError('Enter your email address above, then tap "Forgot password?".');
      return;
    }
    try {
      const res = await fetch(`${SHUTTLER_API_URL}/auth/send-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      // Always show success — the endpoint never reveals whether the email exists
      if (res.ok || res.status < 500) {
        showToast(`If an account exists for ${trimmed}, a reset link has been sent.`, 'success');
      } else {
        throw new Error(`Server error ${res.status}`);
      }
    } catch (e: any) {
      setFormError(e?.message ?? 'Failed to send reset email.');
    }
  }, [email]);

  return (
    <View style={styles.card}>
      <ErrorBanner message={formError} onDismiss={() => setFormError(null)} />
      {initialEmail ? (
        <View style={styles.founderBanner}>
          <Icon name="admin-panel-settings" size={18} color="#1d4ed8" />
          <Text style={styles.founderBannerText}>
            Creating your admin account for <Text style={{ fontWeight: '700' }}>{initialEmail}</Text>
          </Text>
        </View>
      ) : (
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, mode === 'signin' && styles.tabActive, mode === 'signin' && { borderBottomColor: primaryColor }]}
            onPress={() => switchMode('signin')}
          >
            <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive, mode === 'signin' && { color: primaryColor }]}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === 'signup' && styles.tabActive, mode === 'signup' && { borderBottomColor: primaryColor }]}
            onPress={() => switchMode('signup')}
          >
            <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive, mode === 'signup' && { color: primaryColor }]}>Create Account</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'signup' && (
        <>
          <View style={styles.nameRow}>
            <View style={styles.nameField}>
              <Text style={styles.fieldLabel}>First name</Text>
              <TextInput
                style={[styles.input, errors.firstName ? styles.inputError : null]}
                placeholder="Jane"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
                autoCorrect={false}
                placeholderTextColor="#bbb"
              />
              {errors.firstName ? <Text style={styles.errorText}>{errors.firstName}</Text> : null}
            </View>
            <View style={styles.nameField}>
              <Text style={styles.fieldLabel}>Last name</Text>
              <TextInput
                style={[styles.input, errors.lastName ? styles.inputError : null]}
                placeholder="Doe"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
                autoCorrect={false}
                placeholderTextColor="#bbb"
              />
              {errors.lastName ? <Text style={styles.errorText}>{errors.lastName}</Text> : null}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput
              style={[styles.input, errors.phone ? styles.inputError : null]}
              placeholder="+1 555 000 1234"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholderTextColor="#bbb"
            />
            {errors.phone
              ? <Text style={styles.errorText}>{errors.phone}</Text>
              : <Text style={styles.fieldHint}>Used for account recovery and ride notifications. Format: +1 555 000 1234</Text>}
          </View>
        </>
      )}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Email address</Text>
        <TextInput
          style={[styles.input, errors.email ? styles.inputError : null, initialEmail ? styles.inputLocked : null]}
          placeholder="you@example.com"
          value={email}
          onChangeText={initialEmail ? undefined : setEmail}
          editable={!initialEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#bbb"
        />
        {errors.email
          ? <Text style={styles.errorText}>{errors.email}</Text>
          : initialEmail
            ? <Text style={styles.fieldHint}>This is your founder email and will be your admin login.</Text>
            : mode === 'signup'
              ? <Text style={styles.fieldHint}>Use your school or work email. This will be your login.</Text>
              : null}
      </View>

      <PasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        error={errors.password}
        label="Password"
        showRequirements={mode === 'signup'}
      />

      {mode === 'signup' && (
        <PasswordInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="••••••••"
          error={errors.confirmPassword}
          label="Confirm password"
        />
      )}

      {mode === 'signup' && (
        <TouchableOpacity
          style={styles.termsRow}
          onPress={() => setAgreedToTerms((v) => !v)}
          activeOpacity={0.8}
        >
          <Icon
            name={agreedToTerms ? 'check-box' : 'check-box-outline-blank'}
            size={22}
            color={agreedToTerms ? primaryColor : '#9ca3af'}
          />
          <Text style={styles.termsText}>
            I agree to Shuttler's{' '}
            <Text
              style={[styles.termsLink, { color: primaryColor }]}
              onPress={() => Linking.openURL('https://shuttler.net/terms')}
            >
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text
              style={[styles.termsLink, { color: primaryColor }]}
              onPress={() => Linking.openURL('https://shuttler.net/privacy')}
            >
              Privacy Policy
            </Text>
          </Text>
        </TouchableOpacity>
      )}

      <AppButton
        label={isSubmitting ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : mode === 'signin' ? 'Sign In' : 'Create Account'}
        onPress={mode === 'signin' ? handleSignIn : handleSignUp}
        style={styles.primaryButton}
        disabled={isSubmitting}
      />

      {mode === 'signin' && (
        <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotButton}>
          <Text style={[styles.forgotText, { color: primaryColor }]}>Forgot password?</Text>
        </TouchableOpacity>
      )}

      {GOOGLE_WEB_CLIENT_ID ? (
        <>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={styles.socialHint}>
            Google{Platform.OS === 'ios' && Constants.appOwnership !== 'expo' ? ' and Apple' : ''} sign-in creates your account automatically — no separate sign-up needed.
          </Text>

          <TouchableOpacity
            style={[styles.socialButton, isSocialLoading && styles.socialButtonDisabled]}
            onPress={() => { setFormError(null); promptGoogleAsync(); }}
            disabled={isSocialLoading}
            activeOpacity={0.8}
          >
            <Icon name="login" size={18} color="#4285F4" />
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </TouchableOpacity>

          {Platform.OS === 'ios' && Constants.appOwnership !== 'expo' && (
            <TouchableOpacity
              style={[styles.socialButton, styles.appleButton, isSocialLoading && styles.socialButtonDisabled]}
              onPress={handleAppleSignIn}
              disabled={isSocialLoading}
              activeOpacity={0.8}
            >
              <Icon name="apple" size={18} color="#fff" />
              <Text style={[styles.socialButtonText, styles.appleButtonText]}>Continue with Apple</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.socialDisclaimer}>
            By continuing with Google{Platform.OS === 'ios' && Constants.appOwnership !== 'expo' ? ' or Apple' : ''}, you agree to our{' '}
            <Text style={{ color: primaryColor }} onPress={() => Linking.openURL('https://shuttler.net/terms')}>
              Terms
            </Text>
            {' & '}
            <Text style={{ color: primaryColor }} onPress={() => Linking.openURL('https://shuttler.net/privacy')}>
              Privacy Policy
            </Text>
          </Text>
        </>
      ) : null}
    </View>
  );
}

// ---- Phone Panel ----
// Used for K-12 parent sign-in. Sends an SMS OTP via Firebase Phone Auth.
// First-time users are created with role:'parent' in the org's user collection.

function PhonePanel({ orgId }: { orgId: string }) {
  const { primaryColor } = useOrgTheme();
  const recaptchaVerifier = useRef<FirebaseRecaptchaVerifierModal>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSendCode = useCallback(async () => {
    const cleaned = phoneNumber.trim();
    if (!cleaned.startsWith('+')) {
      showAlert('Enter your phone number in international format, e.g. +1 555 000 1234.', 'Format required');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await signInWithPhoneNumber(auth, cleaned, recaptchaVerifier.current!);
      setVerificationId(result.verificationId);
    } catch (e: any) {
      showAlert(e?.message ?? 'Failed to send code. Check the number and try again.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [phoneNumber]);

  const handleVerifyCode = useCallback(async () => {
    if (!verificationId || !code.trim()) return;
    setIsSubmitting(true);
    try {
      const credential = PhoneAuthProvider.credential(verificationId, code.trim());
      const result = await signInWithCredential(auth, credential);
      const userRef = doc(db, 'orgs', orgId, 'users', result.user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: result.user.uid,
          orgId,
          phone: result.user.phoneNumber ?? null,
          displayName: result.user.displayName ?? result.user.phoneNumber ?? 'Parent',
          role: 'parent',
          lastLoginAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
      }
      // Set orgId custom claim so AuthProvider can resolve the org on cold start
      // even if OrgContext fails to restore from AsyncStorage.
      result.user.getIdToken().then((token) =>
        fetch(`${SHUTTLER_API_URL}/auth/social/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orgId }),
        }).catch(() => {}),
      ).catch(() => {});
    } catch (e: any) {
      const msg =
        e?.code === 'auth/invalid-verification-code'
          ? 'That code is incorrect. Please try again.'
          : e?.code === 'auth/code-expired'
          ? 'The code expired. Tap "Send Code" to get a new one.'
          : e?.message ?? 'Verification failed.';
      showAlert(msg, 'Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [verificationId, code, orgId]);

  return (
    <View style={styles.card}>
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaVerifier}
        firebaseConfig={app.options}
        attemptInvisibleVerification
      />

      <InfoBanner
        icon="sms"
        title="Parent sign-in"
        description="Enter your phone number and we'll send a one-time code to verify it."
        style={{ marginBottom: spacing.item }}
      />

      {!verificationId ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="+1 555 000 1234"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
            autoCorrect={false}
            placeholderTextColor="#aaa"
          />
          <AppButton
            label={isSubmitting ? 'Sending…' : 'Send Code'}
            onPress={handleSendCode}
            style={styles.primaryButton}
            disabled={isSubmitting || !phoneNumber.trim()}
          />
        </>
      ) : (
        <>
          <Text style={styles.phoneHint}>
            Code sent to {phoneNumber}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoCorrect={false}
            placeholderTextColor="#aaa"
          />
          <AppButton
            label={isSubmitting ? 'Verifying…' : 'Verify & Sign In'}
            onPress={handleVerifyCode}
            style={styles.primaryButton}
            disabled={isSubmitting || code.trim().length < 6}
          />
          <TouchableOpacity
            onPress={() => { setVerificationId(null); setCode(''); }}
            style={styles.forgotButton}
          >
            <Text style={[styles.forgotText, { color: primaryColor }]}>Wrong number? Start over</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ---- Main AuthScreen ----

export default function AuthScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const { initialEmail } = route.params;

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
      case 'google':
      case 'email+google':
        return <EmailPanel orgSlug={org.slug} orgId={org.orgId} initialEmail={initialEmail} />;
      case 'phone':
        return <PhonePanel orgId={org.orgId} />;
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
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back to org selector */}
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.replace('OrgSelector')}>
            <Icon name="arrow-back" size={20} color={primaryColor} />
            <Text style={[styles.backText, { color: primaryColor }]}>Change organization</Text>
          </TouchableOpacity>

          {/* Org identity */}
          <View style={styles.orgHeader}>
            {org.logoUrl ? (
              <Image source={{ uri: org.logoUrl }} style={styles.orgLogo} resizeMode="contain" />
            ) : (
              <View style={[styles.orgLogo, styles.orgLogoPlaceholder, { backgroundColor: `${primaryColor}15` }]}>
                <Icon name="directions-bus" size={30} color={primaryColor} />
              </View>
            )}
            <Text style={styles.orgName}>{org.name}</Text>
          </View>

          {renderContent()}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.section,
  },
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
    paddingTop: spacing.section * 3,
    paddingBottom: spacing.section * 2,
  },
  orgLogo: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.item,
  },
  orgLogoPlaceholder: {
    backgroundColor: '#f0f4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111',
    textAlign: 'center',
    letterSpacing: -0.3,
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
    marginBottom: spacing.item * 1.5,
    borderBottomWidth: 1.5,
    borderBottomColor: '#f0f0f0',
  },
  tab: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1.5,
  },
  tabActive: {
    borderBottomColor: PRIMARY_COLOR,
  },
  tabText: {
    fontSize: 14,
    color: '#9ca3af',
    fontWeight: '500',
  },
  tabTextActive: {
    color: PRIMARY_COLOR,
    fontWeight: '700',
  },
  fieldGroup: {
    marginBottom: spacing.item / 2,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 5,
    letterSpacing: 0.1,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.item,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fafafa',
    marginBottom: 0,
  },
  inputError: {
    borderColor: '#dc2626',
  },
  inputLocked: {
    backgroundColor: '#f1f5f9',
    color: '#475569',
  },
  founderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  founderBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#1e40af',
    lineHeight: 18,
  },
  errorText: {
    fontSize: 12,
    color: '#dc2626',
    marginBottom: spacing.item / 2,
    marginTop: -2,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.item / 2,
  },
  nameField: {
    flex: 1,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.item,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    marginBottom: spacing.item / 2,
    backgroundColor: '#fafafa',
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
    color: '#111',
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
  phoneHint: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: spacing.item,
  },
  fieldHint: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
    marginBottom: spacing.item / 2,
    lineHeight: 15,
  },
  reqList: {
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  strengthBar: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    height: 4,
  },
  strengthSegment: {
    flex: 1,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 11,
    fontWeight: '600',
    width: 68,
    textAlign: 'right',
  },
  reqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  reqText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  reqTextMet: {
    color: '#16a34a',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 20,
    paddingTop: 2,
  },
  termsLink: {
    textDecorationLine: 'underline',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    gap: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  dividerText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '500',
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    marginBottom: 10,
    backgroundColor: '#fafafa',
  },
  appleButton: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  socialButtonDisabled: {
    opacity: 0.5,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  appleButtonText: {
    color: '#fff',
  },
  socialHint: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  socialDisclaimer: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
  },
});
