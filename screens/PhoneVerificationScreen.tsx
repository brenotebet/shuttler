// screens/PhoneVerificationScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { Text } from '../components/Text';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import {
  PhoneAuthProvider,
  linkWithCredential,
  signInWithPhoneNumber,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';

import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import AppButton from '../components/AppButton';
import PhoneInput, { isValidE164 } from '../src/components/PhoneInput';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { auth, db, app } from '../firebase/firebaseconfig';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { cardShadow } from '../src/styles/common';
import type { RootStackParamList } from '../navigation/StackNavigator';

type RouteT = RouteProp<RootStackParamList, 'PhoneVerification'>;

type Step = 'phone' | 'otp' | 'success';

const RESEND_COOLDOWN = 30;

function friendlyAuthError(e: any): string {
  switch (e?.code) {
    case 'auth/invalid-verification-code': return 'That code is incorrect. Please try again.';
    case 'auth/code-expired': return 'The code expired. Tap "Resend code" to get a new one.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a minute before trying again.';
    case 'auth/invalid-phone-number': return 'That phone number is invalid. Check the format and country code.';
    case 'auth/missing-phone-number': return 'Please enter a phone number.';
    case 'auth/captcha-check-failed': return 'reCAPTCHA check failed. Please try again.';
    case 'auth/network-request-failed': return 'Network error. Check your connection and try again.';
    default: return e?.message ?? 'Something went wrong. Please try again.';
  }
}

export default function PhoneVerificationScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteT>();
  const { user, orgId } = useAuth();
  const { primaryColor } = useOrgTheme();

  const recaptchaVerifier = useRef<FirebaseRecaptchaVerifierModal>(null);
  const [phone, setPhone] = useState(route.params?.phone ?? '');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('phone');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Tick down the resend cooldown every second
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const sendCode = useCallback(async (phoneNumber: string) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier.current!);
      setVerificationId(result.verificationId);
      setStep('otp');
      setResendCooldown(RESEND_COOLDOWN);
    } catch (e: any) {
      setError(friendlyAuthError(e));
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const handleSendCode = useCallback(async () => {
    const cleaned = phone.trim();
    if (!isValidE164(cleaned)) {
      setError('Enter a valid phone number with country code (e.g. +1 555 123 4567).');
      return;
    }
    await sendCode(cleaned);
  }, [phone, sendCode]);

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || isSubmitting) return;
    setCode('');
    setError(null);
    await sendCode(phone.trim());
  }, [phone, resendCooldown, isSubmitting, sendCode]);

  const handleVerifyCode = useCallback(async () => {
    if (!verificationId || code.trim().length < 6 || !user || !orgId) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const credential = PhoneAuthProvider.credential(verificationId, code.trim());

      try {
        await linkWithCredential(user, credential);
      } catch (linkErr: any) {
        // credential-already-in-use: phone is linked to a different account — user proved
        // ownership via OTP, so treat as verified.
        // provider-already-linked: this user already has this phone linked — fine.
        const code_ = linkErr?.code ?? '';
        if (
          code_ !== 'auth/credential-already-in-use' &&
          code_ !== 'auth/provider-already-linked'
        ) {
          throw linkErr;
        }
      }

      // Mark verified in Firestore — AuthProvider's onSnapshot picks this up immediately
      await setDoc(
        doc(db, 'orgs', orgId, 'users', user.uid),
        { phone: phone.trim(), phoneVerified: true },
        { merge: true },
      );

      setStep('success');
    } catch (e: any) {
      setError(friendlyAuthError(e));
    } finally {
      setIsSubmitting(false);
    }
  }, [verificationId, code, user, orgId, phone]);

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Verify Phone Number" />

      {/* reCAPTCHA must be rendered in the tree even when not visible */}
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaVerifier}
        firebaseConfig={app.options}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'success' ? (
            <SuccessView phone={phone} onDone={() => navigation.goBack()} primaryColor={primaryColor} />
          ) : (
            <>
              <View style={s.infoCard}>
                <Icon name="verified-user" size={22} color={primaryColor} />
                <Text style={s.infoText}>
                  We'll send a 6-digit code to confirm you own this number. Standard messaging rates may apply.
                </Text>
              </View>

              {step === 'phone' && (
                <>
                  <Text style={s.fieldLabel}>Phone number</Text>
                  <PhoneInput
                    value={phone}
                    onChange={(v) => { setPhone(v); setError(null); }}
                    editable={!isSubmitting}
                    style={s.phoneInput}
                  />
                  {error && <Text style={s.errorText}>{error}</Text>}
                  <AppButton
                    label={isSubmitting ? 'Sending…' : 'Send Code'}
                    onPress={handleSendCode}
                    disabled={isSubmitting || !isValidE164(phone.trim())}
                    style={[s.btn, { backgroundColor: primaryColor }]}
                  />
                </>
              )}

              {step === 'otp' && (
                <>
                  <View style={s.sentRow}>
                    <Icon name="check-circle" size={16} color="#16a34a" />
                    <Text style={s.sentText}>Code sent to {phone}</Text>
                  </View>
                  <Text style={s.fieldLabel}>6-digit code</Text>
                  <TextInput
                    style={s.codeInput}
                    value={code}
                    onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 6)); setError(null); }}
                    keyboardType="number-pad"
                    placeholder="· · · · · ·"
                    placeholderTextColor="#d1d5db"
                    maxLength={6}
                    autoFocus
                  />
                  {error && <Text style={s.errorText}>{error}</Text>}
                  <AppButton
                    label={isSubmitting ? 'Verifying…' : 'Verify'}
                    onPress={handleVerifyCode}
                    disabled={isSubmitting || code.trim().length < 6}
                    style={[s.btn, { backgroundColor: primaryColor }]}
                  />
                  <View style={s.resendRow}>
                    <TouchableOpacity
                      onPress={handleResend}
                      disabled={resendCooldown > 0 || isSubmitting}
                    >
                      <Text style={[s.resendText, { color: resendCooldown > 0 ? '#9ca3af' : primaryColor }]}>
                        {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={s.resendSep}>·</Text>
                    <TouchableOpacity
                      onPress={() => { setStep('phone'); setCode(''); setVerificationId(null); setError(null); setResendCooldown(0); }}
                    >
                      <Text style={[s.resendText, { color: primaryColor }]}>Wrong number?</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function SuccessView({ phone, onDone, primaryColor }: { phone: string; onDone: () => void; primaryColor: string }) {
  return (
    <View style={s.successContainer}>
      <View style={[s.successIcon, { backgroundColor: `${primaryColor}18` }]}>
        <Icon name="verified" size={48} color={primaryColor} />
      </View>
      <Text style={s.successTitle}>Phone verified!</Text>
      <Text style={s.successSub}>{phone} is now verified on your profile.</Text>
      <AppButton
        label="Done"
        onPress={onDone}
        style={[s.btn, { backgroundColor: primaryColor, marginTop: 8 }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 14,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#166534',
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  phoneInput: {
    marginBottom: 12,
  },
  codeInput: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 12,
    ...cardShadow,
  },
  btn: {
    borderRadius: 14,
  },
  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  sentText: {
    fontSize: 14,
    color: '#374151',
  },
  errorText: {
    fontSize: 13,
    color: '#dc2626',
    marginBottom: 12,
    lineHeight: 18,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 8,
  },
  resendText: {
    fontSize: 14,
    fontWeight: '500',
  },
  resendSep: {
    fontSize: 14,
    color: '#d1d5db',
  },
  successContainer: {
    alignItems: 'center',
    paddingTop: 40,
    gap: 12,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  successSub: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
});
