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
import { signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, PhoneAuthProvider, signInWithCredential, signInWithPhoneNumber } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import { app } from '../firebase/firebaseconfig';
import * as Linking from 'expo-linking';
import { RootStackParamList } from '../navigation/StackNavigator';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import InfoBanner from '../components/InfoBanner';
import { useOrg } from '../src/org/OrgContext';
import { persistSamlHandoffFromUrl, trySamlHandoffLogin } from '../src/auth/samlAuth';
import { startSamlLogin } from '../src/auth/startSamlLogin';
import { showAlert } from '../src/utils/alerts';
import { auth, db } from '../firebase/firebaseconfig';
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

type FieldErrors = Partial<Record<
  'firstName' | 'lastName' | 'phone' | 'email' | 'password' | 'confirmPassword',
  string
>>;

function PasswordInput({
  value,
  onChangeText,
  placeholder,
  error,
  label,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  error?: string;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
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
        />
        <TouchableOpacity onPress={() => setVisible((v) => !v)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Icon name={visible ? 'visibility-off' : 'visibility'} size={20} color="#9ca3af" />
        </TouchableOpacity>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </>
  );
}

function EmailPanel({ orgSlug, orgId }: { orgSlug: string; orgId: string }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setErrors({});
    setFirstName('');
    setLastName('');
    setPhone('');
    setPassword('');
    setConfirmPassword('');
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
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      // Ensure a user doc exists in orgs/{orgId}/users — accounts created outside
      // the registration flow (Firebase Console, old app versions, etc.) won't have one.
      const userRef = doc(db, 'orgs', orgId, 'users', cred.user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: cred.user.uid,
          email: cred.user.email ?? null,
          displayName: cred.user.displayName ?? cred.user.email?.split('@')[0] ?? null,
          role: 'student',
          lastLoginAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
      }
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
  }, [email, password, orgId, mode]);

  const handleSignUp = useCallback(async () => {
    if (!validate()) return;
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
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Registration failed.');
      await signInWithEmailAndPassword(auth, email.trim(), password);
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser).catch(() => {});
      }
    } catch (e: any) {
      showAlert(e?.message ?? 'Registration failed.', 'Sign Up Error');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, password, firstName, lastName, phone, confirmPassword, orgSlug, mode]);

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
          onPress={() => switchMode('signin')}
        >
          <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === 'signup' && styles.tabActive]}
          onPress={() => switchMode('signup')}
        >
          <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Create Account</Text>
        </TouchableOpacity>
      </View>

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
            {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
          </View>
        </>
      )}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Email address</Text>
        <TextInput
          style={[styles.input, errors.email ? styles.inputError : null]}
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#bbb"
        />
        {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
      </View>

      <PasswordInput
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        error={errors.password}
        label="Password"
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

      <AppButton
        label={isSubmitting ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
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

// ---- Phone Panel ----
// Used for K-12 parent sign-in. Sends an SMS OTP via Firebase Phone Auth.
// First-time users are created with role:'parent' in the org's user collection.

function PhonePanel({ orgId }: { orgId: string }) {
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
          phone: result.user.phoneNumber ?? null,
          displayName: result.user.displayName ?? result.user.phoneNumber ?? 'Parent',
          role: 'parent',
          lastLoginAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, { lastLoginAt: serverTimestamp() });
      }
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
            <Text style={styles.forgotText}>Wrong number? Start over</Text>
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
        return <EmailPanel orgSlug={org.slug} orgId={org.orgId} />;
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
});
