// screens/AdminOrgSetupScreen.tsx
//
// Four-tab admin onboarding screen for org admins.
// Tabs: Org Profile | Auth Settings | Stop Configuration | Billing

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/StackNavigator';
import { ActivityIndicator, Alert, Clipboard, FlatList, Image, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, ScrollView, Share, StyleSheet, Switch, TextInput, TouchableOpacity, View } from 'react-native'
import { Text } from '../components/Text';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase/firebaseconfig';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { collection, doc, getDocs, updateDoc, setDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '../config';
import * as WebBrowser from 'expo-web-browser';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase/firebaseconfig';
import { useOrg, Stop, Route, WeekSchedule, DaySchedule, DEFAULT_WEEK_SCHEDULE, BreakSettings } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';
import { startSamlLogin } from '../src/auth/startSamlLogin';
import { extractTokenFromUrl } from '../src/auth/samlAuth';
import { useFirstLoginOnboarding } from '../src/hooks/useFirstLoginOnboarding';
import { useExternalCheckout } from '../src/hooks/useExternalCheckout';
import { showToast } from '../src/components/Toast';
import { validateUserText } from '../src/utils/profanity';
import { SHUTTLER_API_URL } from '../config';
import {
  PRIMARY_COLOR,
  DANGER_COLOR,
  WHITE,
  GRAY_50,
  GRAY_100,
  GRAY_200,
  GRAY_300,
  GRAY_400,
  GRAY_500,
  GRAY_600,
  GRAY_700,
  GRAY_900,
  BORDER_COLOR,
} from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { getPlanLimits, isTrialExpired, planFor, vehicleLimitText, routeLimitText, stopLimitText } from '../src/constants/planLimits';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import BottomSheet from '../components/BottomSheet';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useOrgSetupProgress } from '../src/hooks/useOrgSetupProgress';
import { ORG_TYPES, allowsParentRole } from '../src/constants/orgTypes';
import { getTodayScheduleText } from '../src/utils/scheduleUtils';
import { fetchLoopPath } from '../src/utils/directions';
import { routePathKey, encodePath } from '../src/utils/routePath';
import { pickDefaultRouteColor, stopsOnNoRoute } from '../src/utils/routeDisplay';
import { ONLINE_BUS_STALE_SECONDS } from '../src/constants/stops';

type Tab = 'profile' | 'auth' | 'stops' | 'users' | 'billing' | 'ops';

// ---- Helpers ----

async function getBearerToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

// ---- Profile Tab ----

const COMMON_TIMEZONES: { label: string; value: string }[] = [
  { label: 'Eastern Time',            value: 'America/New_York' },
  { label: 'Central Time',            value: 'America/Chicago' },
  { label: 'Mountain Time',           value: 'America/Denver' },
  { label: 'Pacific Time',            value: 'America/Los_Angeles' },
  { label: 'Alaska Time',             value: 'America/Anchorage' },
  { label: 'Hawaii Time',             value: 'Pacific/Honolulu' },
  { label: 'Atlantic Time (Canada)',  value: 'America/Halifax' },
  { label: 'London / GMT',            value: 'Europe/London' },
  { label: 'Central Europe',          value: 'Europe/Berlin' },
  { label: 'Eastern Europe',          value: 'Europe/Helsinki' },
  { label: 'Moscow',                  value: 'Europe/Moscow' },
  { label: 'India',                   value: 'Asia/Kolkata' },
  { label: 'China / Singapore',       value: 'Asia/Shanghai' },
  { label: 'Japan / Korea',           value: 'Asia/Tokyo' },
  { label: 'Gulf (Dubai)',            value: 'Asia/Dubai' },
  { label: 'Sydney / Melbourne',      value: 'Australia/Sydney' },
  { label: 'Perth',                   value: 'Australia/Perth' },
  { label: 'New Zealand',             value: 'Pacific/Auckland' },
  { label: 'São Paulo',               value: 'America/Sao_Paulo' },
  { label: 'Mexico City',             value: 'America/Mexico_City' },
];

// Deliberately literal, independent of the app's current theme tokens — this
// is a fixed menu of picker options, not a reflection of "the" brand color,
// so it must not silently drift if PRIMARY_COLOR/DANGER_COLOR ever change.
const COLOR_SWATCHES = [
  '#16a34a', // default green
  '#2563eb', // blue
  '#7c3aed', // purple
  '#dc2626', // red
  '#ea580c', // orange
  '#0891b2', // cyan
  '#0f172a', // slate dark
  '#be185d', // pink
];

function ProfileTab() {
  const { org, refreshOrg } = useOrg();
  const [name, setName] = useState(org?.name ?? '');
  const [orgType, setOrgType] = useState(org?.orgType ?? '');
  // Default to the device's IANA timezone if the org hasn't saved one yet.
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timezone, setTimezone] = useState(org?.timezone ?? deviceTimezone);
  const [showTzPicker, setShowTzPicker] = useState(false);
  const [logoUrl, setLogoUrl] = useState(org?.logoUrl ?? '');
  const [primaryColor, setPrimaryColor] = useState(org?.primaryColor ?? COLOR_SWATCHES[0]);
  const [customColor, setCustomColor] = useState('');
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handlePickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      showToast('Allow photo library access to upload a logo.', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    setIsUploadingLogo(true);
    try {
      const uri = result.assets[0].uri;
      const ext = (uri.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z]/g, '') || 'jpg';

      // XMLHttpRequest is required in React Native to create a real Blob from a local URI.
      // fetch(uri).blob() silently produces an empty blob on some RN versions.
      const blob: Blob = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error('Could not read image file.'));
        xhr.responseType = 'blob';
        xhr.open('GET', uri, true);
        xhr.send(null);
      });

      const storageRef = ref(storage, `orgs/${org!.orgId}/logo.${ext}`);
      await uploadBytes(storageRef, blob, { contentType: `image/${ext}` });
      const url = await getDownloadURL(storageRef);
      setLogoUrl(url);
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (msg.includes('storage/unauthorized') || msg.includes('permission')) {
        showToast('Storage permission denied. Check Firebase Storage rules for /orgs/{orgId}/.', 'error');
      } else {
        showToast(msg || 'Could not upload logo.', 'error');
      }
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleSave = useCallback(async () => {
    if (!org) return;
    const nameError = validateUserText(name, 'Organization name');
    if (nameError) {
      showToast(nameError, 'error');
      return;
    }
    const effectiveColor = customColor.match(/^#[0-9a-fA-F]{6}$/) ? customColor : primaryColor;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'orgs', org.orgId), {
        name: name.trim(),
        logoUrl: logoUrl || null,
        primaryColor: effectiveColor,
        ...(orgType && { orgType }),
        timezone,
        updatedAt: serverTimestamp(),
      });
      await refreshOrg();
      showToast('Profile updated.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [org, name, orgType, timezone, logoUrl, primaryColor, customColor, refreshOrg]);

  const activeColor = customColor.match(/^#[0-9a-fA-F]{6}$/) ? customColor : primaryColor;

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      {/* Org name */}
      <Text style={styles.sectionLabel}>Organization Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. McKendree University"
        placeholderTextColor={GRAY_400}
        autoCapitalize="words"
      />
      <Text style={styles.hint}>Shown in the org selector for all users.</Text>

      {/* Org type */}
      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Organization Type</Text>
      <View style={profileStyles.typeRow}>
        {ORG_TYPES.map((t) => {
          const selected = orgType === t.value;
          return (
            <TouchableOpacity
              key={t.value}
              onPress={() => setOrgType(t.value)}
              style={[
                profileStyles.typeChip,
                selected && { borderColor: activeColor, backgroundColor: `${activeColor}14` },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={[profileStyles.typeChipText, selected && { color: activeColor, fontWeight: '700' }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>
        {!orgType
          ? 'Not set yet. Choose one so the app shows the right options for your riders.'
          : allowsParentRole(orgType)
          ? 'K-12 schools can invite parents to track their children\'s shuttle.'
          : 'Parent accounts are only offered for K-12 schools.'}
      </Text>

      {/* Timezone */}
      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Timezone</Text>
      <TouchableOpacity style={styles.tzRow} onPress={() => setShowTzPicker(true)} activeOpacity={0.7}>
        <Icon name="schedule" size={18} color={GRAY_500} />
        <Text style={styles.tzValue}>
          {COMMON_TIMEZONES.find((t) => t.value === timezone)?.label ?? timezone}
        </Text>
        <Icon name="expand-more" size={20} color={GRAY_500} />
      </TouchableOpacity>
      <Text style={styles.hint}>Route hours are shown and checked in this timezone.</Text>
      <BottomSheet
        visible={showTzPicker}
        onClose={() => setShowTzPicker(false)}
        sheetStyle={{ paddingHorizontal: 0, paddingBottom: 32, maxHeight: '75%' }}
      >
        <View style={styles.tzModalHeader}>
          <Text style={styles.tzModalTitle}>Select Timezone</Text>
          <TouchableOpacity onPress={() => setShowTzPicker(false)}>
            <Icon name="close" size={22} color={GRAY_700} />
          </TouchableOpacity>
        </View>
        <FlatList
          data={COMMON_TIMEZONES}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tzOption, timezone === item.value && { backgroundColor: '#f0f4ff' }]}
              onPress={() => { setTimezone(item.value); setShowTzPicker(false); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.tzOptionLabel}>{item.label}</Text>
                <Text style={styles.tzOptionValue}>{item.value}</Text>
              </View>
              {timezone === item.value && <Icon name="check" size={18} color="#4f46e5" />}
            </TouchableOpacity>
          )}
        />
      </BottomSheet>

      {/* Logo */}
      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Organization Logo</Text>
      <TouchableOpacity style={profileStyles.logoBox} onPress={handlePickLogo} activeOpacity={0.8}>
        {isUploadingLogo ? (
          <ActivityIndicator color={activeColor} />
        ) : logoUrl ? (
          <Image source={{ uri: logoUrl }} style={profileStyles.logoPreview} resizeMode="contain" />
        ) : (
          <>
            <Icon name="add-photo-alternate" size={32} color={GRAY_400} />
            <Text style={profileStyles.logoHint}>Tap to upload logo</Text>
          </>
        )}
      </TouchableOpacity>
      {logoUrl ? (
        <TouchableOpacity onPress={() => setLogoUrl('')} style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: DANGER_COLOR }}>Remove logo</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.hint}>Square or landscape image. Displayed at up to 80×80 px.</Text>

      {/* Color scheme */}
      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Color Scheme</Text>
      <View style={profileStyles.swatchRow}>
        {COLOR_SWATCHES.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => { setPrimaryColor(c); setCustomColor(''); }}
            style={[
              profileStyles.swatch,
              { backgroundColor: c },
              primaryColor === c && !customColor.match(/^#[0-9a-fA-F]{6}$/) && profileStyles.swatchSelected,
            ]}
          />
        ))}
      </View>
      <Text style={styles.hint}>Or enter a custom hex color:</Text>
      <View style={profileStyles.hexRow}>
        <View style={[profileStyles.hexPreview, { backgroundColor: activeColor }]} />
        <TextInput
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
          value={customColor}
          onChangeText={setCustomColor}
          placeholder="#16a34a"
          placeholderTextColor={GRAY_400}
          autoCapitalize="none"
          maxLength={7}
        />
      </View>

      <AppButton
        label={isSaving ? 'Saving…' : 'Save Profile'}
        onPress={handleSave}
        disabled={isSaving || !name.trim()}
        style={styles.actionButton}
        color={activeColor}
      />
    </ScrollView>
  );
}

const profileStyles = StyleSheet.create({
  logoBox: {
    width: '100%',
    height: 120,
    borderWidth: 1.5,
    borderColor: GRAY_200,
    borderStyle: 'dashed',
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GRAY_50,
    marginBottom: 8,
  },
  logoPreview: { width: '100%', height: '100%', borderRadius: 10 },
  logoHint: { fontSize: 13, color: GRAY_400, marginTop: 6 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  swatch: { width: 36, height: 36, borderRadius: 18 },
  swatchSelected: { borderWidth: 3, borderColor: GRAY_900 },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  hexPreview: { width: 36, height: 36, borderRadius: borderRadius.sm, borderWidth: 1, borderColor: GRAY_200 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: GRAY_200,
    backgroundColor: WHITE,
  },
  typeChipText: { fontSize: 13, color: GRAY_700, fontWeight: '500' },
});

// ---- Auth Settings Tab ----

type AuthMethod = 'saml' | 'email' | 'phone';
type SamlTestStatus = 'idle' | 'testing' | 'passed' | 'failed';

function AuthTab() {
  const { org, refreshOrg } = useOrg();
  const { user } = useAuth();
  const { primaryColor } = useOrgTheme();
  const [authMethod, setAuthMethod] = useState<AuthMethod>(
    (org?.authMethod as AuthMethod) ?? 'email',
  );
  const [domains, setDomains] = useState((org?.allowedEmailDomains ?? []).join(', '));
  const [idpEntityId, setIdpEntityId] = useState('');
  const [idpSsoUrl, setIdpSsoUrl] = useState('');
  const [idpCert, setIdpCert] = useState('');
  // Whether the server already has a signing cert on file for this draft —
  // the GET below never returns the cert itself, only this flag, so a blank
  // idpCert here means "keep what's on file," not "no cert exists."
  const [certOnFile, setCertOnFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  // Deterministic from org.slug/orgId — an IT team can copy these before ever
  // saving a draft, no round trip to the server needed to reveal them.
  const spInfo = org
    ? {
        acsUrl: `${SHUTTLER_API_URL}/saml/${org.slug}/acs`,
        spEntityId: `${SHUTTLER_API_URL}/orgs/${org.orgId}`,
        metadataUrl: `${SHUTTLER_API_URL}/saml/${org.slug}/metadata`,
        loginUrl: `${SHUTTLER_API_URL}/saml/${org.slug}/login`,
      }
    : null;
  // Fingerprints of the IdP fields at the moment of the last successful save
  // and the last successful test, so Test/Activate can tell when the admin
  // has edited the form since — the SP endpoints test whatever's saved on the
  // server, not the live form, so a stale draft or stale test must re-gate.
  const [savedConfigKey, setSavedConfigKey] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<SamlTestStatus>('idle');
  const [testedConfigKey, setTestedConfigKey] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState<string | null>(null);
  const [testMissingAttributes, setTestMissingAttributes] = useState<string[]>([]);

  const currentConfigKey = JSON.stringify({ idpEntityId, idpSsoUrl, idpCert });
  const isDraftCurrent = authMethod === 'saml' && savedConfigKey === currentConfigKey;
  const isTestCurrent = testStatus === 'passed' && testedConfigKey === currentConfigKey;

  // Reload whatever draft is already saved server-side so reopening this tab
  // doesn't present a blank form the admin has to fill in from scratch again.
  useEffect(() => {
    if (!org?.orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getBearerToken();
        const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/auth-config`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data.samlDraft) return;
        setIdpEntityId(data.samlDraft.idpEntityId ?? '');
        setIdpSsoUrl(data.samlDraft.idpSsoUrl ?? '');
        setCertOnFile(Boolean(data.samlDraft.hasCert));
        // The loaded values are exactly what the server has saved — mark the
        // draft current so a returning admin can hit Test/Activate right away
        // instead of being told to "save again" for a draft that's unchanged.
        setSavedConfigKey(JSON.stringify({
          idpEntityId: data.samlDraft.idpEntityId ?? '',
          idpSsoUrl: data.samlDraft.idpSsoUrl ?? '',
          idpCert: '',
        }));
      } catch {
        // Best-effort hydration — worst case the admin re-enters the draft.
      }
    })();
    return () => { cancelled = true; };
  }, [org?.orgId]);

  const handleSaveDraft = useCallback(async () => {
    if (!org) return;
    setIsSaving(true);
    try {
      const token = await getBearerToken();
      const body: Record<string, any> = {
        authMethod,
        allowedEmailDomains: domains
          .split(',')
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
      };
      if (authMethod === 'saml') {
        body.samlConfig = { idpEntityId, idpSsoUrl, idpSigningCert: idpCert };
      }
      const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/auth-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save auth config');
      await refreshOrg();
      if (authMethod === 'saml') {
        setSavedConfigKey(currentConfigKey);
        setTestStatus('idle');
        setTestError(null);
        setTestEmail(null);
        // A cert now exists on the server either way: the one just typed, or
        // (since a blank field means "keep it") the one already on file.
        if (idpCert) setCertOnFile(true);
        showToast('Draft saved — SAML is not live yet. Test the connection before activating.', 'success');
      } else {
        showToast('Auth configuration updated.', 'success');
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [org, authMethod, domains, idpEntityId, idpSsoUrl, idpCert, refreshOrg, currentConfigKey]);

  const handleTestConnection = useCallback(async () => {
    if (!org) return;
    setTestStatus('testing');
    setTestError(null);
    setTestMissingAttributes([]);
    try {
      const redirectUrl = await startSamlLogin(org.slug);
      if (!redirectUrl) {
        setTestStatus('idle');
        return;
      }
      const samlToken = extractTokenFromUrl(redirectUrl);
      if (!samlToken) {
        throw new Error('SSO finished but no token came back — check the ACS URL your IdP is configured with.');
      }
      const res = await fetch(`${SHUTTLER_API_URL}/saml/${org.slug}/test-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ samlToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Test login failed');
      setTestStatus('passed');
      setTestedConfigKey(currentConfigKey);
      setTestEmail(data.email ?? null);
      setTestMissingAttributes(Array.isArray(data.missingAttributes) ? data.missingAttributes : []);
    } catch (e: any) {
      setTestStatus('failed');
      setTestError(e?.message ?? 'Unknown error during test login.');
    }
  }, [org, currentConfigKey]);

  const activateSaml = useCallback(async () => {
    if (!org) return;
    setIsActivating(true);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/auth-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          authMethod: 'saml',
          samlConfig: { idpEntityId, idpSsoUrl, idpSigningCert: idpCert },
          activate: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to activate SAML');
      await refreshOrg();
      showToast('SAML is now live — everyone, admins included, will sign in via your IdP.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to activate.', 'error');
    } finally {
      setIsActivating(false);
    }
  }, [org, idpEntityId, idpSsoUrl, idpCert, refreshOrg]);

  const handleActivate = useCallback(() => {
    if (!org) return;
    // SSO is the only way in once it's live, admins included. Admin access
    // carries over to the SSO account with the same email (see
    // /saml/exchange), so warn when the test login used a different one.
    const adminEmail = user?.email ?? null;
    const emailMismatch = !!testEmail && !!adminEmail && testEmail.toLowerCase() !== adminEmail.toLowerCase();
    Alert.alert(
      'Activate SAML sign-in?',
      `This changes how everyone in ${org.name} signs in — they'll use your IdP from now on, admins included. Email/password sign-in will no longer be available, and you'll be signed out so you can sign back in with SSO.\n\n`
        + 'Admins and drivers keep their role the first time they sign in with an SSO account that has the same email as their Shuttler account.'
        + (emailMismatch
          ? `\n\nHeads up: the test login used ${testEmail}, which doesn't match your Shuttler email (${adminEmail}), so your admin access won't carry over automatically. Contact support@shuttler.net before activating.`
          : '')
        + '\n\nMake sure your IT team has confirmed the test login above.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Activate', style: 'default', onPress: activateSaml },
      ],
    );
  }, [org, activateSaml, user?.email, testEmail]);

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Text style={styles.sectionLabel}>Authentication Method</Text>

      {(['email', 'phone', 'saml'] as AuthMethod[]).map((m) => (
        <TouchableOpacity
          key={m}
          style={[styles.radioRow, authMethod === m && styles.radioRowActive, authMethod === m && { borderColor: primaryColor }]}
          onPress={() => setAuthMethod(m)}
        >
          <View style={[styles.radio, authMethod === m && styles.radioSelected, authMethod === m && { borderColor: primaryColor, backgroundColor: primaryColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.radioLabel}>
              {m === 'email'
                ? 'Email / Password'
                : m === 'phone'
                ? 'Phone Number (SMS) — K-12 parents'
                : 'SAML SSO (IT-managed)'}
            </Text>
            <Text style={styles.radioSublabel}>
              {m === 'email'
                ? 'Users sign up with an email and password, or continue with Google or Apple. No setup needed — works right away.'
                : m === 'phone'
                ? 'Parents sign in with a texted code — no email needed. They link their child from inside the app, so students don’t need their own account.'
                : 'Everyone, admins included, signs in through your school’s identity provider (Okta, Azure AD, Shibboleth, etc). Requires the IdP details below, then a passing test, before it goes live.'}
            </Text>
          </View>
        </TouchableOpacity>
      ))}

      <Text style={[styles.sectionLabel, { marginTop: spacing.section }]}>
        Allowed Email Domains
      </Text>
      <TextInput
        style={styles.input}
        value={domains}
        onChangeText={setDomains}
        placeholder="e.g. mckendree.edu, university.edu"
        placeholderTextColor={GRAY_400}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Text style={styles.hint}>Comma-separated. Leave blank to allow any email domain.</Text>

      {authMethod === 'saml' && spInfo && (
        <View style={styles.infoBox}>
          <Text style={[styles.infoBoxTitle, { color: primaryColor }]}>Setup steps</Text>
          <Text style={styles.hint}>
            1. Send your IT team the URLs and attributes listed below. Most IdPs can import the metadata URL directly.{'\n'}
            2. Paste the Entity ID, SSO URL, and signing certificate they give you into the fields below, then tap Save Draft.{'\n'}
            3. Tap Test Connection to sign in once with your own school account. Live users aren't affected.{'\n'}
            4. When the test passes, tap Activate SAML for All Users.
          </Text>

          <Text style={[styles.infoBoxTitle, { color: primaryColor, marginTop: spacing.item }]}>Give these to your IT team</Text>
          <Text style={styles.infoBoxLabel}>ACS URL</Text>
          <Text style={styles.infoBoxValue} selectable>{spInfo.acsUrl}</Text>
          <Text style={styles.infoBoxLabel}>SP Entity ID</Text>
          <Text style={styles.infoBoxValue} selectable>{spInfo.spEntityId}</Text>
          <Text style={styles.infoBoxLabel}>SP Metadata URL</Text>
          <Text style={styles.infoBoxValue} selectable>{spInfo.metadataUrl}</Text>
          <Text style={styles.infoBoxLabel}>Attributes to send</Text>
          <Text style={styles.hint}>
            • Email (required){'\n'}
            • First name and last name, so users' names show up in Shuttler{'\n'}
            Common names like email, fname/firstName, and lname/lastName all work.
          </Text>

          <Text style={[styles.infoBoxTitle, { color: primaryColor, marginTop: spacing.item }]}>Troubleshooting</Text>
          <Text style={styles.infoBoxLabel}>Trace URL — if the test fails, open this in a desktop browser (with a SAML tracer extension or DevTools) to see what your IdP sent</Text>
          <Text style={styles.infoBoxValue} selectable>{spInfo.loginUrl}</Text>
        </View>
      )}

      {authMethod === 'saml' && (
        <>
          <Text style={styles.sectionLabel}>IdP Entity ID</Text>
          <TextInput style={styles.input} value={idpEntityId} onChangeText={setIdpEntityId}
            placeholder="https://idp.example.com/saml" placeholderTextColor={GRAY_400} autoCapitalize="none" />

          <Text style={styles.sectionLabel}>IdP SSO URL</Text>
          <TextInput style={styles.input} value={idpSsoUrl} onChangeText={setIdpSsoUrl}
            placeholder="https://idp.example.com/saml/sso" placeholderTextColor={GRAY_400} autoCapitalize="none" keyboardType="url" />

          <Text style={styles.sectionLabel}>IdP Signing Certificate (PEM or base64)</Text>
          <TextInput
            style={[styles.input, styles.certInput]}
            value={idpCert}
            onChangeText={setIdpCert}
            placeholder={certOnFile ? 'A certificate is already on file — paste one here only to replace it' : 'Paste the IdP certificate here'}
            placeholderTextColor={GRAY_400}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          {certOnFile && !idpCert && (
            <Text style={styles.hint}>Leaving this blank keeps the certificate already on file.</Text>
          )}
        </>
      )}

      <AppButton
        label={isSaving ? 'Saving…' : authMethod === 'saml' ? 'Save Draft' : 'Save Auth Settings'}
        onPress={handleSaveDraft}
        disabled={isSaving}
        style={styles.actionButton}
      />

      {authMethod === 'saml' && savedConfigKey !== null && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: spacing.section }]}>
            {isDraftCurrent ? 'Draft saved — not live yet' : 'Unsaved changes — save the draft again before testing'}
          </Text>

          <AppButton
            label={testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
            onPress={handleTestConnection}
            disabled={!isDraftCurrent || testStatus === 'testing'}
            style={styles.actionButton}
          />

          {testStatus === 'passed' && isTestCurrent && (
            <Text style={styles.testPassedText}>
              ✅ Test succeeded{testEmail ? ` — verified ${testEmail} via your IdP` : ''}
            </Text>
          )}
          {testStatus === 'passed' && isTestCurrent && testMissingAttributes.length > 0 && (
            <Text style={styles.testWarningText}>
              ⚠️ Your IdP didn't send: {testMissingAttributes.join(', ')}. Ask your IT team to add {testMissingAttributes.length > 1 ? 'these attributes' : 'this attribute'}, or users' profiles will be incomplete.
            </Text>
          )}
          {testStatus === 'failed' && (
            <Text style={styles.testFailedText}>❌ {testError ?? 'Test failed'}</Text>
          )}

          <AppButton
            label={isActivating ? 'Activating…' : 'Activate SAML for All Users'}
            onPress={handleActivate}
            disabled={!isTestCurrent || isActivating}
            style={styles.actionButton}
          />
          <Text style={styles.hint}>
            {org?.authMethod === 'saml'
              ? 'SAML is currently live for this organization.'
              : 'Nobody signs in with SAML until you activate — a successful test is required first.'}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

// ---- Schedule Editor (per-weekday hours per route) ----

const WEEK_DAYS: { key: keyof WeekSchedule; label: string }[] = [
  { key: 'monday',    label: 'Mon' },
  { key: 'tuesday',   label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday',  label: 'Thu' },
  { key: 'friday',    label: 'Fri' },
  { key: 'saturday',  label: 'Sat' },
  { key: 'sunday',    label: 'Sun' },
];

// Every 30 minutes: 00:00, 00:30, 01:00 … 23:30
const TIME_SLOTS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    TIME_SLOTS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

function fmt12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

function ScheduleEditor({
  route,
  onChange,
}: {
  route: Route;
  onChange: (schedule: WeekSchedule) => void;
}) {
  const { primaryColor } = useOrgTheme();
  const schedule: WeekSchedule = route.schedule ?? { ...DEFAULT_WEEK_SCHEDULE };
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerField, setPickerField] = useState<{ dayKey: keyof WeekSchedule; field: 'open' | 'close' } | null>(null);
  const [pickerTemp, setPickerTemp] = useState('07:00');

  const update = (key: keyof WeekSchedule, patch: Partial<DaySchedule>) => {
    onChange({ ...schedule, [key]: { ...schedule[key], ...patch } });
  };

  const openPicker = (dayKey: keyof WeekSchedule, field: 'open' | 'close') => {
    setPickerField({ dayKey, field });
    setPickerTemp(schedule[dayKey][field]);
    setPickerVisible(true);
  };

  const confirmPicker = () => {
    if (pickerField) update(pickerField.dayKey, { [pickerField.field]: pickerTemp });
    setPickerVisible(false);
  };

  return (
    <View style={{ marginTop: 12 }}>
      <View style={hoursStyles.header}>
        <Icon name="schedule" size={14} color={GRAY_500} />
        <Text style={hoursStyles.label}>Hours of Operation</Text>
      </View>

      {WEEK_DAYS.map(({ key, label }) => {
        const day = schedule[key];
        return (
          <View key={key} style={hoursStyles.dayRow}>
            <Switch
              value={day.isOpen}
              onValueChange={(v) => update(key, { isOpen: v })}
              trackColor={{ false: GRAY_200, true: primaryColor }}
              thumbColor={WHITE}
            />
            <Text style={[hoursStyles.dayLabel, !day.isOpen && { color: GRAY_400 }]}>{label}</Text>
            {day.isOpen ? (
              <View style={hoursStyles.timeRow}>
                <TouchableOpacity style={hoursStyles.timeBtn} onPress={() => openPicker(key, 'open')}>
                  <Text style={hoursStyles.timeBtnText}>{fmt12h(day.open)}</Text>
                </TouchableOpacity>
                <Text style={hoursStyles.dash}>–</Text>
                <TouchableOpacity style={hoursStyles.timeBtn} onPress={() => openPicker(key, 'close')}>
                  <Text style={hoursStyles.timeBtnText}>{fmt12h(day.close)}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={hoursStyles.closedLabel}>Closed</Text>
            )}
          </View>
        );
      })}

      <BottomSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        sheetStyle={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 24 }}
      >
        <View style={hoursStyles.pickerBar}>
          <TouchableOpacity onPress={() => setPickerVisible(false)}>
            <Text style={hoursStyles.pickerCancel}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmPicker}>
            <Text style={[hoursStyles.pickerDone, { color: primaryColor }]}>Done</Text>
          </TouchableOpacity>
        </View>
        <Picker selectedValue={pickerTemp} onValueChange={(v) => setPickerTemp(v as string)}>
          {TIME_SLOTS.map((slot) => (
            <Picker.Item key={slot} label={fmt12h(slot)} value={slot} />
          ))}
        </Picker>
      </BottomSheet>
    </View>
  );
}

const hoursStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  label: { flex: 1, fontSize: 12, fontWeight: '600', color: GRAY_500 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  dayLabel: { width: 32, fontSize: 13, fontWeight: '600', color: GRAY_700 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  dash: { fontSize: 14, color: GRAY_500 },
  timeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: GRAY_200,
    borderRadius: borderRadius.sm,
    paddingVertical: 7,
    paddingHorizontal: 6,
    backgroundColor: GRAY_50,
    alignItems: 'center',
  },
  timeBtnText: { fontSize: 13, fontWeight: '600', color: GRAY_900 },
  closedLabel: { fontSize: 13, color: GRAY_400, fontStyle: 'italic' },
  pickerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GRAY_200,
  },
  pickerCancel: { fontSize: 16, color: GRAY_500 },
  pickerDone: { fontSize: 16, fontWeight: '700', color: PRIMARY_COLOR },
});

// ---- Stop tab extra styles ----
const stopStyles = StyleSheet.create({
  manualCoordsBox: {
    backgroundColor: GRAY_50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GRAY_200,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  manualCoordsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  coordInput: {
    flex: 1,
    marginBottom: 0,
    fontSize: 13,
  },
  applyBtn: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: borderRadius.sm,
    paddingVertical: 9,
    alignItems: 'center',
  },
  applyBtnText: {
    color: WHITE,
    fontSize: 13,
    fontWeight: '600',
  },
});

const newStopStyles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GRAY_50,
    borderWidth: 1,
    borderColor: GRAY_200,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: GRAY_900,
    padding: 0,
  },
  dropdown: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: GRAY_200,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: -4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_100,
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  locationChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  manualToggleText: {
    fontSize: 12,
    color: GRAY_400,
  },

});

// ---- Stop Configuration Tab ----

function calcBoundsFromStops(stops: Stop[]) {
  if (stops.length < 2) return null;
  const lats = stops.map((s) => s.latitude);
  const lngs = stops.map((s) => s.longitude);
  const PADDING = 0.008; // ~800 m
  return {
    mapCenter: {
      latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
      longitude: (Math.max(...lngs) + Math.min(...lngs)) / 2,
    },
    mapBoundingBox: {
      ne: { latitude: Math.max(...lats) + PADDING, longitude: Math.max(...lngs) + PADDING },
      sw: { latitude: Math.min(...lats) - PADDING, longitude: Math.min(...lngs) - PADDING },
    },
  };
}

// Stops and routes are edited in two views behind a Stops | Routes switch.
// Every add, edit, or delete is written to Firestore immediately — there is
// no global Save button, so nothing is lost by leaving the tab and a
// background org refresh can't wipe unsaved work.
type StopsView = 'stops' | 'routes';
type StopPanelMode = 'list' | 'add' | 'edit';
type LatLng = { latitude: number; longitude: number };

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Gives each route a road-following path for riders' maps. Only routes whose
// stop sequence changed since their path was computed are refetched, so most
// saves make no API call. A failed fetch saves the route without a path
// (riders then see no road line) rather than blocking the save.
async function withRoadPaths(nextRoutes: Route[], nextStops: Stop[]): Promise<Route[]> {
  return Promise.all(nextRoutes.map(async (route) => {
    const routeStops = route.stopIds
      .map((id) => nextStops.find((st) => st.id === id))
      .filter((st): st is Stop => !!st);
    const { path: _oldPath, pathKey: _oldKey, ...bare } = route;
    if (routeStops.length < 2) return bare;
    const key = routePathKey(routeStops);
    if (route.path && route.pathKey === key) return route;
    const coords = await fetchLoopPath(routeStops);
    return coords ? { ...bare, path: encodePath(coords), pathKey: key } : bare;
  }));
}

function StopsTab({ onGoToBilling }: { onGoToBilling: () => void }) {
  const { org, refreshOrg } = useOrg();
  const { primaryColor } = useOrgTheme();
  const planLimits = getPlanLimits(org?.subscriptionPlan, org?.subscriptionStatus, org?.limitOverrides);
  const mapRef = useRef<MapView>(null);

  // Local copies so writes can be applied optimistically; reset from the org
  // whenever it changes (every change is persisted, so nothing is lost).
  const [stops, setStops] = useState<Stop[]>(org?.stops ?? []);
  const [routes, setRoutes] = useState<Route[]>(org?.routes ?? []);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  useEffect(() => { setStops(org?.stops ?? []); }, [org?.stops]);
  useEffect(() => { setRoutes(org?.routes ?? []); }, [org?.routes]);

  const [view, setView] = useState<StopsView>('stops');
  const [mode, setMode] = useState<StopPanelMode>('list');
  const [editingStopId, setEditingStopId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCoords, setDraftCoords] = useState<LatLng | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [routeEditorTarget, setRouteEditorTarget] = useState<{ route: Route; isNew: boolean } | null>(null);

  const [mapCollapsed, setMapCollapsed] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvent, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMapCollapsed(true);
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setMapCollapsed(false);
    });
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  const hasOrgCenter = !!org?.mapCenter && (org.mapCenter.latitude !== 0 || org.mapCenter.longitude !== 0);
  const [mapCenter, setMapCenter] = useState<LatLng>(
    hasOrgCenter ? org!.mapCenter : { latitude: 39.5, longitude: -98.35 },
  );

  // Place search (Google Places autocomplete), biased to the visible map.
  type PlaceSuggestion = { placeId: string; description: string };
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [showManualCoords, setShowManualCoords] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');

  const searchPlaces = useCallback(async (input: string) => {
    if (!input.trim() || input.length < 3) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const bias = `${mapCenter.latitude},${mapCenter.longitude}`;
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&location=${bias}&radius=50000&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.status === 'OK') {
        setSearchResults(
          (json.predictions ?? []).slice(0, 5).map((p: any) => ({ placeId: p.place_id, description: p.description })),
        );
      } else {
        if (__DEV__ && json.status !== 'ZERO_RESULTS') {
          showToast(`Places API: ${json.status} — ${json.error_message ?? 'check the Places API key and billing.'}`, 'error');
        }
        setSearchResults([]);
      }
    } catch (err) {
      if (__DEV__) console.error('[Places] fetch error:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [mapCenter]);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => searchPlaces(text), 350);
  }, [searchPlaces]);

  const fitToStops = useCallback((list: Stop[]) => {
    if (list.length === 0) return;
    mapRef.current?.fitToCoordinates(
      list.map((st) => ({ latitude: st.latitude, longitude: st.longitude })),
      { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true },
    );
  }, []);

  const focusMap = useCallback((coords: LatLng) => {
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 400);
  }, []);

  const handleSelectPlace = useCallback(async (suggestion: PlaceSuggestion) => {
    setSearchResults([]);
    setSearchQuery('');
    Keyboard.dismiss();
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${suggestion.placeId}&fields=geometry,name&key=${GOOGLE_MAPS_API_KEY}`;
      const json = await (await fetch(url)).json();
      if (json.status === 'OK') {
        const loc = json.result.geometry.location;
        const coords = { latitude: loc.lat, longitude: loc.lng };
        setDraftCoords(coords);
        if (!draftName.trim()) setDraftName(suggestion.description.split(',')[0].trim());
        focusMap(coords);
      }
    } catch {}
  }, [draftName, focusMap]);

  const handleApplyManualCoords = useCallback(() => {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      showToast('Latitude must be −90 to 90, longitude −180 to 180.', 'error');
      return;
    }
    const coords = { latitude: lat, longitude: lon };
    setDraftCoords(coords);
    focusMap(coords);
    setShowManualCoords(false);
    setManualLat('');
    setManualLon('');
  }, [manualLat, manualLon, focusMap]);

  // ---- Persistence ----

  // Writes stops + routes (and the map bounds derived from the stops). On
  // failure the local state is rolled back to what was there before.
  const persist = useCallback(
    async (nextStops: Stop[], nextRoutes: Route[], successMessage: string): Promise<boolean> => {
      if (!org) return false;
      const prevStops = stops;
      const prevRoutes = routes;
      setStops(nextStops);
      setRoutes(nextRoutes);
      setIsSaving(true);
      try {
        const bounds = calcBoundsFromStops(nextStops);
        const routesWithPaths = await withRoadPaths(nextRoutes, nextStops);
        const payload: Record<string, unknown> = { stops: nextStops, routes: routesWithPaths, updatedAt: serverTimestamp() };
        // Route hours are evaluated in the org's timezone; fill it in from the
        // device the first time if the admin hasn't set one in Profile.
        if (!org.timezone) payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (bounds) {
          payload.mapCenter = bounds.mapCenter;
          payload.mapBoundingBox = bounds.mapBoundingBox;
        } else if (nextStops.length === 1) {
          payload.mapCenter = { latitude: nextStops[0].latitude, longitude: nextStops[0].longitude };
        }
        await updateDoc(doc(db, 'orgs', org.orgId), payload);
        await refreshOrg();
        showToast(successMessage, 'success');
        return true;
      } catch (e: any) {
        setStops(prevStops);
        setRoutes(prevRoutes);
        showToast(e?.message ?? 'Could not save. Check your connection and try again.', 'error');
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [org, stops, routes, refreshOrg],
  );

  // ---- Stops ----

  const showLimitAlert = useCallback((kind: 'maxStops' | 'maxRoutes', nextCount: number) => {
    const next = planFor(kind, nextCount);
    const isStops = kind === 'maxStops';
    const limitText = isStops ? stopLimitText : routeLimitText;
    Alert.alert(
      isStops ? 'Stop limit reached' : 'Route limit reached',
      `Your ${planLimits.label} plan includes ${limitText(planLimits)}. ` +
        (next
          ? `You need the ${next.label} plan (${next.price}) or higher for ${limitText(next).toLowerCase()}.`
          : 'Contact us about an Enterprise plan sized for your service.'),
      [
        { text: 'View Plans', onPress: onGoToBilling },
        { text: 'OK', style: 'cancel' },
      ],
    );
  }, [planLimits, onGoToBilling]);

  const resetDraft = useCallback(() => {
    setMode('list');
    setEditingStopId(null);
    setDraftName('');
    setDraftCoords(null);
    setSearchQuery('');
    setSearchResults([]);
    setShowManualCoords(false);
    Keyboard.dismiss();
    fitToStops(stopsRef.current);
  }, [fitToStops]);

  const startAdd = useCallback((coords: LatLng | null = null) => {
    if (stops.length >= planLimits.maxStops) {
      showLimitAlert('maxStops', stops.length + 1);
      return;
    }
    setMode('add');
    setEditingStopId(null);
    setDraftName('');
    setDraftCoords(coords);
  }, [stops.length, planLimits.maxStops, showLimitAlert]);

  const startEdit = useCallback((stop: Stop) => {
    setMode('edit');
    setEditingStopId(stop.id);
    setDraftName(stop.name);
    setDraftCoords({ latitude: stop.latitude, longitude: stop.longitude });
    setSearchQuery('');
    setSearchResults([]);
    focusMap({ latitude: stop.latitude, longitude: stop.longitude });
  }, [focusMap]);

  const handleMapPress = useCallback((e: any) => {
    // A press on a marker also fires the map's onPress on iOS — ignore it.
    if (e?.nativeEvent?.action === 'marker-press') return;
    const coords = e.nativeEvent.coordinate as LatLng;
    if (mode === 'list') startAdd(coords);
    else setDraftCoords(coords);
    setSearchResults([]);
  }, [mode, startAdd]);

  const handleSaveStop = useCallback(async () => {
    const name = draftName.trim();
    if (!name) { showToast('Give the stop a name.', 'error'); return; }
    const nameError = validateUserText(name, 'Stop name');
    if (nameError) { showToast(nameError, 'error'); return; }
    if (!draftCoords) { showToast('Search for a place or tap the map to place the stop.', 'error'); return; }
    if (stops.some((s) => s.id !== editingStopId && s.name.trim().toLowerCase() === name.toLowerCase())) {
      showToast('A stop with this name already exists.', 'error');
      return;
    }
    if (mode === 'add') {
      const isFirst = stops.length === 0;
      const ok = await persist(
        [...stops, { id: newId('stop'), name, ...draftCoords }],
        routes,
        isFirst ? 'First stop added. Add the rest, then build a route.' : `"${name}" added.`,
      );
      if (ok) resetDraft();
    } else if (editingStopId) {
      const ok = await persist(
        stops.map((s) => (s.id === editingStopId ? { ...s, name, ...draftCoords } : s)),
        routes,
        `"${name}" updated.`,
      );
      if (ok) resetDraft();
    }
  }, [draftName, draftCoords, stops, routes, editingStopId, mode, persist, resetDraft]);

  const handleDeleteStop = useCallback((id: string) => {
    const stop = stops.find((s) => s.id === id);
    const affected = routes.filter((r) => r.stopIds.includes(id));
    Alert.alert(
      'Delete stop',
      affected.length > 0
        ? `Delete "${stop?.name ?? 'this stop'}"? It will also be removed from ${affected.map((r) => r.name).join(', ')}.`
        : `Delete "${stop?.name ?? 'this stop'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await persist(
              stops.filter((s) => s.id !== id),
              routes.map((r) => ({ ...r, stopIds: r.stopIds.filter((sid) => sid !== id) })),
              `"${stop?.name ?? 'Stop'}" deleted.`,
            );
            if (ok) resetDraft();
          },
        },
      ],
    );
  }, [stops, routes, persist, resetDraft]);

  // ---- Routes ----

  const startNewRoute = useCallback(() => {
    if (routes.length >= planLimits.maxRoutes) {
      showLimitAlert('maxRoutes', routes.length + 1);
      return;
    }
    // Each new route starts with a color no other route uses, so routes are
    // easy to tell apart on the rider map. Admins can still change it.
    const color = pickDefaultRouteColor(routes, COLOR_SWATCHES, primaryColor);
    setRouteEditorTarget({ route: { id: newId('route'), name: '', stopIds: [], color }, isNew: true });
  }, [routes, planLimits.maxRoutes, showLimitAlert, primaryColor]);

  const handleSaveRoute = useCallback(async (route: Route, isNew: boolean): Promise<boolean> => {
    const nextRoutes = isNew ? [...routes, route] : routes.map((r) => (r.id === route.id ? route : r));
    return persist(stops, nextRoutes, isNew ? `"${route.name}" created.` : `"${route.name}" saved.`);
  }, [routes, stops, persist]);

  const handleDeleteRoute = useCallback(async (route: Route): Promise<boolean> => {
    return persist(stops, routes.filter((r) => r.id !== route.id), `"${route.name}" deleted.`);
  }, [routes, stops, persist]);

  // Extra lines for the "Delete route" confirmation: stops the deletion
  // would leave on no route (riders can't request those once the org has
  // routes, since no driver sees them) and buses driving the route now.
  const getRouteDeleteWarnings = useCallback(async (route: Route): Promise<string[]> => {
    const warnings: string[] = [];
    const remaining = routes.filter((r) => r.id !== route.id);
    if (remaining.length > 0) {
      const stranded = stopsOnNoRoute(stops.filter((s) => route.stopIds.includes(s.id)), remaining);
      if (stranded.length > 0) {
        const names = stranded.map((s) => s.name);
        const list = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
        warnings.push(`${list} won't be on any route, so riders won't be able to request ${stranded.length === 1 ? 'it' : 'them'}. Add ${stranded.length === 1 ? 'it' : 'them'} to another route to keep ${stranded.length === 1 ? 'it' : 'them'} in service.`);
      }
    }
    if (org) {
      try {
        const snap = await getDocs(query(collection(db, 'orgs', org.orgId, 'buses'), where('routeId', '==', route.id)));
        const now = Date.now();
        const online = snap.docs.filter((d) => {
          const data = d.data();
          const updatedMs = data.updatedAt?.toMillis?.() ?? 0;
          return data.online === true && now - updatedMs < ONLINE_BUS_STALE_SECONDS * 1000;
        }).length;
        if (online > 0) {
          warnings.push(`${online} driver${online === 1 ? ' is' : 's are'} on this route right now and will be asked to pick another${org.driversChooseRoute === false ? ' — with routes assigned by you, they go offline until you assign one' : ''}.`);
        }
      } catch {
        // Best effort: the warning is advisory, the delete still works.
      }
    }
    return warnings;
  }, [org, routes, stops]);

  const routesUsing = (stopId: string) => routes.filter((r) => r.stopIds.includes(stopId));

  const initialRegion: Region = {
    latitude: mapCenter.latitude,
    longitude: mapCenter.longitude,
    latitudeDelta: hasOrgCenter ? 0.03 : 30,
    longitudeDelta: hasOrgCenter ? 0.03 : 55,
  };

  const stopLimitLabel = planLimits.maxStops === Infinity ? '' : ` / ${planLimits.maxStops}`;
  const routeLimitLabel = planLimits.maxRoutes === Infinity ? '' : ` / ${planLimits.maxRoutes}`;

  return (
    <View style={styles.stopsContainer}>
      {/* Stops | Routes switch */}
      <View style={stopsUi.segmentWrap}>
        {([
          { key: 'stops', label: `Stops (${stops.length}${stopLimitLabel})`, icon: 'place' },
          { key: 'routes', label: `Routes (${routes.length}${routeLimitLabel})`, icon: 'alt-route' },
        ] as const).map((seg) => {
          const active = view === seg.key;
          return (
            <TouchableOpacity
              key={seg.key}
              style={[stopsUi.segment, active && stopsUi.segmentActive]}
              onPress={() => { resetDraft(); setView(seg.key); }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Icon name={seg.icon} size={16} color={active ? primaryColor : GRAY_500} />
              <Text style={[stopsUi.segmentText, active && { color: primaryColor }]}>{seg.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {view === 'stops' ? (
        <>
          <MapView
            ref={mapRef}
            style={[stopsUi.map, mapCollapsed && styles.mapCollapsed]}
            initialRegion={initialRegion}
            onMapReady={() => fitToStops(stops)}
            onPress={handleMapPress}
            onRegionChangeComplete={(r) => setMapCenter({ latitude: r.latitude, longitude: r.longitude })}
          >
            {stops.map((stop) => {
              // Hidden (not unmounted) while it's being edited — removing and
              // re-adding a marker on iOS can leave it missing after Cancel.
              const isEditing = mode === 'edit' && stop.id === editingStopId;
              return (
                <Marker
                  key={stop.id}
                  coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
                  title={stop.name}
                  opacity={isEditing ? 0 : 1}
                  pinColor={mode === 'list' ? primaryColor : GRAY_400}
                  onPress={() => { if (mode === 'list') startEdit(stop); }}
                />
              );
            })}
            {mode !== 'list' && draftCoords && (
              <Marker
                coordinate={draftCoords}
                pinColor="orange"
                draggable
                onDragEnd={(e) => setDraftCoords(e.nativeEvent.coordinate)}
                title={draftName.trim() || 'New stop'}
              />
            )}
          </MapView>

          <ScrollView
            style={styles.stopsPanel}
            contentContainerStyle={styles.stopsPanelContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {mode === 'list' ? (
              <>
                <View style={stopsUi.panelHeader}>
                  <Text style={stopsUi.panelTitle}>Stops</Text>
                  <TouchableOpacity
                    style={[stopsUi.addBtn, { backgroundColor: primaryColor }]}
                    onPress={() => startAdd()}
                    accessibilityRole="button"
                  >
                    <Icon name="add" size={18} color={WHITE} />
                    <Text style={stopsUi.addBtnText}>Add stop</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.hint}>
                  {stops.length === 0
                    ? 'Tap "Add stop", or tap the map where riders get picked up.'
                    : 'Tap a stop to rename it, move it, or delete it.'}
                </Text>

                {stops.map((stop) => {
                  const used = routesUsing(stop.id);
                  return (
                    <TouchableOpacity
                      key={stop.id}
                      style={stopsUi.row}
                      onPress={() => startEdit(stop)}
                      accessibilityRole="button"
                      accessibilityHint="Edit this stop"
                    >
                      <Icon name="place" size={20} color={primaryColor} />
                      <View style={{ flex: 1 }}>
                        <Text style={stopsUi.rowTitle} numberOfLines={1}>{stop.name}</Text>
                        <Text style={stopsUi.rowSub} numberOfLines={1}>
                          {used.length === 0
                            ? routes.length > 0 ? 'Not on a route — riders can\'t request it' : 'Not on a route yet'
                            : `On ${used.map((r) => r.name).join(', ')}`}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={20} color={GRAY_400} />
                    </TouchableOpacity>
                  );
                })}

                {stops.length > 0 && routes.length === 0 && (
                  <TouchableOpacity style={stopsUi.nextStep} onPress={() => setView('routes')}>
                    <Icon name="alt-route" size={18} color={primaryColor} />
                    <Text style={[stopsUi.nextStepText, { color: primaryColor }]}>
                      Next: put your stops in order on a route
                    </Text>
                    <Icon name="chevron-right" size={18} color={primaryColor} />
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <>
                {/* Cancel / Save live in the header so they stay visible above the keyboard and map. */}
                <View style={stopsUi.panelHeader}>
                  <TouchableOpacity onPress={resetDraft} disabled={isSaving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={stopsUi.headerCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={stopsUi.formTitle}>{mode === 'add' ? 'New stop' : 'Edit stop'}</Text>
                  <TouchableOpacity
                    style={[stopsUi.headerSaveBtn, { backgroundColor: primaryColor }, (!draftName.trim() || !draftCoords || isSaving) && { opacity: 0.4 }]}
                    onPress={handleSaveStop}
                    disabled={!draftName.trim() || !draftCoords || isSaving}
                  >
                    {isSaving
                      ? <ActivityIndicator size="small" color={WHITE} />
                      : <Text style={stopsUi.headerSaveText}>{mode === 'add' ? 'Add' : 'Save'}</Text>}
                  </TouchableOpacity>
                </View>

                {/* 1. Where */}
                <Text style={stopsUi.fieldLabel}>Location</Text>
                {draftCoords ? (
                  <View style={[newStopStyles.locationChip, { borderColor: `${primaryColor}40`, backgroundColor: `${primaryColor}0d` }]}>
                    <Icon name="place" size={15} color={primaryColor} />
                    <Text style={[newStopStyles.locationChipText, { color: primaryColor }]} numberOfLines={1}>
                      Pin placed · drag it on the map to adjust
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.hint}>Search for a place, or tap the map to drop a pin.</Text>
                )}

                <View style={[newStopStyles.searchRow, { marginTop: 8 }]}>
                  <Icon name="search" size={18} color={GRAY_400} style={{ marginRight: 6 }} />
                  <TextInput
                    style={newStopStyles.searchInput}
                    placeholder={draftCoords ? 'Search to move the pin…' : 'Search address or place…'}
                    value={searchQuery}
                    onChangeText={handleSearchChange}
                    placeholderTextColor={GRAY_400}
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                  {isSearching && <ActivityIndicator size="small" color={primaryColor} style={{ marginLeft: 6 }} />}
                </View>
                {searchResults.length > 0 && (
                  <View style={[newStopStyles.dropdown, { marginTop: 4 }]}>
                    {searchResults.map((s) => (
                      <TouchableOpacity key={s.placeId} style={newStopStyles.dropdownItem} onPress={() => handleSelectPlace(s)}>
                        <Icon name="place" size={14} color={GRAY_400} style={{ marginRight: 8, marginTop: 1 }} />
                        <Text style={styles.searchDropdownText} numberOfLines={2}>{s.description}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <TouchableOpacity style={[newStopStyles.manualToggle, { marginTop: 6 }]} onPress={() => setShowManualCoords((v) => !v)}>
                  <Icon name="my-location" size={13} color={GRAY_400} />
                  <Text style={newStopStyles.manualToggleText}>Enter coordinates instead</Text>
                  <Icon name={showManualCoords ? 'expand-less' : 'expand-more'} size={16} color={GRAY_400} />
                </TouchableOpacity>
                {showManualCoords && (
                  <View style={stopStyles.manualCoordsBox}>
                    <View style={stopStyles.manualCoordsRow}>
                      <TextInput
                        style={[styles.input, stopStyles.coordInput]}
                        placeholder="Latitude"
                        value={manualLat}
                        onChangeText={setManualLat}
                        keyboardType="numbers-and-punctuation"
                        placeholderTextColor={GRAY_400}
                      />
                      <TextInput
                        style={[styles.input, stopStyles.coordInput]}
                        placeholder="Longitude"
                        value={manualLon}
                        onChangeText={setManualLon}
                        keyboardType="numbers-and-punctuation"
                        placeholderTextColor={GRAY_400}
                        onSubmitEditing={handleApplyManualCoords}
                      />
                    </View>
                    <TouchableOpacity
                      style={[stopStyles.applyBtn, { backgroundColor: primaryColor }, (!manualLat || !manualLon) && { opacity: 0.4 }]}
                      onPress={handleApplyManualCoords}
                      disabled={!manualLat || !manualLon}
                    >
                      <Text style={stopStyles.applyBtnText}>Use these coordinates</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* 2. Name */}
                <Text style={[stopsUi.fieldLabel, { marginTop: 14 }]}>Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Library, Main Entrance"
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholderTextColor={GRAY_400}
                  returnKeyType="done"
                />

                {mode === 'edit' && editingStopId && routesUsing(editingStopId).length > 0 && (
                  <Text style={[styles.hint, { marginTop: 8 }]}>
                    Used on {routesUsing(editingStopId).map((r) => r.name).join(', ')}.
                  </Text>
                )}

                {mode === 'edit' && editingStopId && (
                  <TouchableOpacity style={stopsUi.deleteLink} onPress={() => handleDeleteStop(editingStopId)} disabled={isSaving}>
                    <Icon name="delete-outline" size={18} color={DANGER_COLOR} />
                    <Text style={stopsUi.deleteLinkText}>Delete stop</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        </>
      ) : (
        <ScrollView style={styles.stopsPanel} contentContainerStyle={styles.stopsPanelContent}>
          <View style={stopsUi.panelHeader}>
            <Text style={stopsUi.panelTitle}>Routes</Text>
            <TouchableOpacity
              style={[stopsUi.addBtn, { backgroundColor: routes.length >= planLimits.maxRoutes ? GRAY_300 : primaryColor }]}
              onPress={startNewRoute}
              accessibilityRole="button"
            >
              <Icon name="add" size={18} color={WHITE} />
              <Text style={stopsUi.addBtnText}>New route</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            A route is the loop a bus drives: its stops in order, plus the hours it runs. Tap a route to edit it.
          </Text>

          {stops.length === 0 && (
            <TouchableOpacity style={stopsUi.nextStep} onPress={() => setView('stops')}>
              <Icon name="place" size={18} color={primaryColor} />
              <Text style={[stopsUi.nextStepText, { color: primaryColor }]}>Add your stops first</Text>
              <Icon name="chevron-right" size={18} color={primaryColor} />
            </TouchableOpacity>
          )}

          {routes.map((route) => {
            const hours = getTodayScheduleText(route, new Date(), org?.timezone);
            return (
              <TouchableOpacity
                key={route.id}
                style={stopsUi.row}
                onPress={() => setRouteEditorTarget({ route, isNew: false })}
                accessibilityRole="button"
                accessibilityHint="Edit this route"
              >
                <Icon name="directions-bus" size={20} color={route.color ?? primaryColor} />
                <View style={{ flex: 1 }}>
                  <Text style={stopsUi.rowTitle} numberOfLines={1}>{route.name}</Text>
                  <Text style={[stopsUi.rowSub, route.stopIds.length === 0 && { color: '#b45309' }]} numberOfLines={1}>
                    {route.stopIds.length === 0
                      ? 'No stops yet'
                      : `${route.stopIds.length} stop${route.stopIds.length === 1 ? '' : 's'}`}
                    {hours ? ` · ${hours}` : ''}
                  </Text>
                </View>
                <Icon name="chevron-right" size={20} color={GRAY_400} />
              </TouchableOpacity>
            );
          })}

          {routes.length === 0 && stops.length > 0 && (
            <Text style={[styles.hint, { marginTop: 12 }]}>No routes yet. Tap "New route" to create one.</Text>
          )}
        </ScrollView>
      )}

      {routeEditorTarget && (
        <RouteEditorModal
          route={routeEditorTarget.route}
          isNew={routeEditorTarget.isNew}
          stops={stops}
          otherRouteNames={routes.filter((r) => r.id !== routeEditorTarget.route.id).map((r) => r.name)}
          onClose={() => setRouteEditorTarget(null)}
          onSave={async (route) => {
            const ok = await handleSaveRoute(route, routeEditorTarget.isNew);
            if (ok) setRouteEditorTarget(null);
          }}
          onDelete={async (route) => {
            const ok = await handleDeleteRoute(route);
            if (ok) setRouteEditorTarget(null);
          }}
          getDeleteWarnings={getRouteDeleteWarnings}
          isSaving={isSaving}
        />
      )}
    </View>
  );
}

// ---- Route editor (full-screen sheet) ----
// Edits a draft copy of one route; nothing is written until Save.

function RouteEditorModal({
  route,
  isNew,
  stops,
  otherRouteNames,
  onClose,
  onSave,
  onDelete,
  getDeleteWarnings,
  isSaving,
}: {
  route: Route;
  isNew: boolean;
  stops: Stop[];
  otherRouteNames: string[];
  onClose: () => void;
  onSave: (route: Route) => void;
  onDelete: (route: Route) => void;
  getDeleteWarnings: (route: Route) => Promise<string[]>;
  isSaving: boolean;
}) {
  const { primaryColor } = useOrgTheme();
  const [draft, setDraft] = useState<Route>(route);
  const mapRef = useRef<MapView>(null);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(route);

  const routeStops = draft.stopIds
    .map((id) => stops.find((s) => s.id === id))
    .filter((s): s is Stop => !!s);
  const otherStops = stops.filter((s) => !draft.stopIds.includes(s.id));

  // Fit the map to all stops once it's laid out.
  const fitMap = useCallback(() => {
    if (stops.length === 0) return;
    mapRef.current?.fitToCoordinates(
      stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false },
    );
  }, [stops]);

  const toggleStop = (stopId: string) => {
    setDraft((d) => ({
      ...d,
      stopIds: d.stopIds.includes(stopId) ? d.stopIds.filter((id) => id !== stopId) : [...d.stopIds, stopId],
    }));
  };

  const moveStop = (index: number, direction: -1 | 1) => {
    setDraft((d) => {
      const ids = [...d.stopIds];
      const target = index + direction;
      if (target < 0 || target >= ids.length) return d;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      return { ...d, stopIds: ids };
    });
  };

  const handleClose = () => {
    if (!isDirty) { onClose(); return; }
    Alert.alert('Discard changes?', 'Your changes to this route haven\'t been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const handleSave = () => {
    const name = draft.name.trim();
    if (!name) { showToast('Give the route a name.', 'error'); return; }
    const nameError = validateUserText(name, 'Route name');
    if (nameError) { showToast(nameError, 'error'); return; }
    if (otherRouteNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) {
      showToast('A route with this name already exists.', 'error');
      return;
    }
    const finalRoute = { ...draft, name };
    if (finalRoute.stopIds.length === 0) {
      Alert.alert(
        'No stops on this route',
        'Drivers on this route won\'t see any stops to service until you add some.',
        [
          { text: 'Add stops', style: 'cancel' },
          { text: 'Save anyway', onPress: () => onSave(finalRoute) },
        ],
      );
      return;
    }
    onSave(finalRoute);
  };

  const handleDelete = async () => {
    const warnings = await getDeleteWarnings(route);
    Alert.alert(
      'Delete route',
      [`Delete "${route.name}"? Drivers who default to it will need a new route.`, ...warnings].join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(route) },
      ],
    );
  };

  const loopCoords = routeStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: WHITE }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={routeUi.header}>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={routeUi.headerCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={routeUi.headerTitle} numberOfLines={1}>{isNew ? 'New route' : 'Edit route'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={isSaving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            {isSaving
              ? <ActivityIndicator size="small" color={primaryColor} />
              : <Text style={[routeUi.headerSave, { color: primaryColor }]}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={routeUi.body} keyboardShouldPersistTaps="handled">
          <Text style={stopsUi.fieldLabel}>Route name</Text>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder="e.g. Weekday Loop"
            placeholderTextColor={GRAY_400}
            autoFocus={isNew}
          />

          <Text style={[stopsUi.fieldLabel, { marginTop: 14 }]}>Color on the map</Text>
          <View style={routeUi.colorRow}>
            {[null, ...COLOR_SWATCHES].map((c) => {
              const swatch = c ?? primaryColor;
              const active = (draft.color ?? null) === c;
              return (
                <TouchableOpacity
                  key={c ?? 'org'}
                  onPress={() => setDraft((d) => {
                    const { color: _old, ...rest } = d;
                    return c ? { ...rest, color: c } : rest;
                  })}
                  style={[routeUi.colorSwatch, { backgroundColor: swatch }, active && routeUi.colorSwatchActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={c ? `Route color ${c}` : 'Use organization color'}
                >
                  {!c && <Text style={routeUi.colorSwatchText}>Org</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          {stops.length > 0 && (
            <MapView
              ref={mapRef}
              style={routeUi.map}
              onMapReady={fitMap}
              scrollEnabled
              pitchEnabled={false}
              rotateEnabled={false}
            >
              {loopCoords.length >= 2 && (
                <Polyline coordinates={[...loopCoords, loopCoords[0]]} strokeColor={draft.color ?? primaryColor} strokeColors={[draft.color ?? primaryColor]} strokeWidth={4} />
              )}
              {routeStops.map((s, i) => (
                <Marker
                  key={`${s.id}-${i}`}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  title={`${i + 1}. ${s.name}`}
                  onPress={() => toggleStop(s.id)}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={[routeUi.numberPin, { backgroundColor: draft.color ?? primaryColor }]}>
                    <Text style={routeUi.numberPinText}>{i + 1}</Text>
                  </View>
                </Marker>
              ))}
              {otherStops.map((s) => (
                <Marker
                  key={s.id}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  title={`${s.name} (tap to add)`}
                  onPress={() => toggleStop(s.id)}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={routeUi.otherPin} />
                </Marker>
              ))}
            </MapView>
          )}

          <Text style={[stopsUi.fieldLabel, { marginTop: 16 }]}>
            Stops in order{routeStops.length > 0 ? ` (${routeStops.length})` : ''}
          </Text>
          <Text style={styles.hint}>
            The bus visits these in order, then loops back to the first. Tap a stop on the map or below to add or remove it.
          </Text>
          {routeStops.length === 0 && (
            <Text style={[styles.hint, { marginTop: 8, color: '#b45309' }]}>No stops on this route yet.</Text>
          )}
          {routeStops.map((s, i) => (
            <View key={s.id} style={routeUi.orderRow}>
              <View style={[routeUi.orderNum, { backgroundColor: `${primaryColor}18` }]}>
                <Text style={[routeUi.orderNumText, { color: primaryColor }]}>{i + 1}</Text>
              </View>
              <Text style={routeUi.orderName} numberOfLines={1}>{s.name}</Text>
              <TouchableOpacity onPress={() => moveStop(i, -1)} disabled={i === 0} style={routeUi.iconBtn} accessibilityLabel={`Move ${s.name} up`}>
                <Icon name="arrow-upward" size={18} color={i === 0 ? GRAY_300 : GRAY_700} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => moveStop(i, 1)} disabled={i === routeStops.length - 1} style={routeUi.iconBtn} accessibilityLabel={`Move ${s.name} down`}>
                <Icon name="arrow-downward" size={18} color={i === routeStops.length - 1 ? GRAY_300 : GRAY_700} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => toggleStop(s.id)} style={routeUi.iconBtn} accessibilityLabel={`Remove ${s.name}`}>
                <Icon name="remove-circle-outline" size={20} color={DANGER_COLOR} />
              </TouchableOpacity>
            </View>
          ))}

          {otherStops.length > 0 && (
            <>
              <Text style={[stopsUi.fieldLabel, { marginTop: 16 }]}>Add stops</Text>
              {otherStops.map((s) => (
                <TouchableOpacity key={s.id} style={routeUi.addRow} onPress={() => toggleStop(s.id)}>
                  <Icon name="add-circle-outline" size={20} color={primaryColor} />
                  <Text style={routeUi.orderName} numberOfLines={1}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          <View style={{ marginTop: 8 }}>
            <ScheduleEditor route={draft} onChange={(schedule) => setDraft((d) => ({ ...d, schedule }))} />
          </View>

          {!isNew && (
            <TouchableOpacity style={[stopsUi.deleteLink, { marginTop: 24 }]} onPress={handleDelete} disabled={isSaving}>
              <Icon name="delete-outline" size={18} color={DANGER_COLOR} />
              <Text style={stopsUi.deleteLinkText}>Delete route</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const stopsUi = StyleSheet.create({
  segmentWrap: {
    flexDirection: 'row',
    margin: 12,
    marginBottom: 8,
    padding: 3,
    backgroundColor: GRAY_100,
    borderRadius: borderRadius.md,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: borderRadius.sm,
  },
  segmentActive: { backgroundColor: WHITE, ...cardShadow },
  segmentText: { fontSize: 14, fontWeight: '600', color: GRAY_500 },
  map: { height: 240 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  panelTitle: { fontSize: 18, fontWeight: '700', color: GRAY_900 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.xl,
  },
  addBtnText: { color: WHITE, fontWeight: '700', fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 8,
    backgroundColor: WHITE,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: GRAY_100,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: GRAY_900 },
  rowSub: { fontSize: 12, color: GRAY_500, marginTop: 2 },
  nextStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    padding: 12,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: GRAY_300,
  },
  nextStepText: { flex: 1, fontSize: 14, fontWeight: '600' },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: GRAY_700, marginTop: 8, marginBottom: 6 },
  headerCancel: { fontSize: 15, color: GRAY_500, fontWeight: '600' },
  formTitle: { fontSize: 16, fontWeight: '700', color: GRAY_900 },
  headerSaveBtn: { minWidth: 64, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: borderRadius.xl },
  headerSaveText: { color: WHITE, fontWeight: '700', fontSize: 14 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18, paddingVertical: 8 },
  deleteLinkText: { color: DANGER_COLOR, fontWeight: '600', fontSize: 14 },
});

const routeUi = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GRAY_200,
  },
  headerCancel: { fontSize: 16, color: GRAY_500 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: GRAY_900, flex: 1, textAlign: 'center' },
  headerSave: { fontSize: 16, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 48 },
  map: { height: 220, borderRadius: borderRadius.md, marginTop: 14 },
  numberPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: WHITE,
  },
  numberPinText: { color: WHITE, fontSize: 12, fontWeight: '800' },
  otherPin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: GRAY_400,
    borderWidth: 2,
    borderColor: WHITE,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_100,
  },
  orderNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  orderNumText: { fontSize: 12, fontWeight: '800' },
  orderName: { flex: 1, fontSize: 15, color: GRAY_900 },
  iconBtn: { padding: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  colorSwatchActive: { borderWidth: 3, borderColor: GRAY_900 },
  colorSwatchText: { color: WHITE, fontSize: 10, fontWeight: '800' },
});

// ---- Users Tab ----

// Firestore Timestamp serialized by the backend's JSON response.
type SerializedTimestamp = { _seconds?: number; seconds?: number } | null;

type OrgMember = {
  uid: string;
  // Phone sign-ins (K-12 parents) have no email.
  email: string | null;
  displayName?: string | null;
  phone?: string | null;
  role: 'student' | 'driver' | 'admin' | 'parent';
  defaultRouteId?: string | null;
  createdAt?: SerializedTimestamp;
  // K-12 / phone orgs: new members wait for approval (no field = approved).
  approvalStatus?: 'pending' | 'approved' | 'declined';
  approvalRequestedAt?: SerializedTimestamp;
  approvedAt?: SerializedTimestamp;
  relationship?: string;
  approvalRequest?: { children?: { name: string; grade: string | null }[] };
};

const tsSeconds = (t: SerializedTimestamp | undefined) => t?._seconds ?? t?.seconds ?? 0;

/** What to call a member in lists: name, else email, else phone. */
const memberLabel = (m: OrgMember) => m.displayName || m.email || m.phone || 'Unnamed member';

const RELATIONSHIP_LABELS: Record<string, string> = {
  parent: 'Parent', guardian: 'Guardian', grandparent: 'Grandparent', other: 'Other',
};

const ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  driver: 'Driver',
  admin: 'Admin',
  parent: 'Parent',
};

const ROLE_COLORS: Record<string, string> = {
  student: '#3b82f6',
  driver: '#f59e0b',
  admin: PRIMARY_COLOR,
  parent: '#10b981',
};

function UsersTab() {
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const { user: currentUser } = useAuth();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // uid → defaultRouteId currently saved in Firestore for drivers
  const [driverDefaults, setDriverDefaults] = useState<Record<string, string | null>>({});
  const [savingRoute, setSavingRoute] = useState<string | null>(null);
  const [personTarget, setPersonTarget] = useState<OrgMember | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [memberFilter, setMemberFilter] = useState<'staff' | 'riders' | 'parents'>('staff');
  const [search, setSearch] = useState('');
  // Invite controls — must stay above all early returns
  const [inviteRole, setInviteRole] = useState<'student' | 'driver' | 'parent'>('student');
  // Parent accounts only make sense for K-12 orgs (see src/constants/orgTypes).
  const parentsAllowed = allowsParentRole(org?.orgType);
  // Mirrors requiresMemberApproval in backend/authPolicy.ts.
  const membersNeedApproval = org?.authMethod !== 'saml'
    && (org?.orgType === 'k12' || org?.authMethod === 'phone');
  useEffect(() => {
    if (!parentsAllowed && inviteRole === 'parent') setInviteRole('student');
  }, [parentsAllowed, inviteRole]);
  const [copiedId, setCopiedId] = useState(false);
  // Approval requests (K-12 / phone orgs)
  const [decidingUid, setDecidingUid] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<OrgMember | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  // Children of the parent open in the person sheet
  // null = loading, 'error' = couldn't load (e.g. rules not yet allowing it).
  const [targetChildren, setTargetChildren] = useState<{ id: string; name: string; grade?: string | null; createdSec: number }[] | 'error' | null>(null);

  const orgRoutes = org?.routes ?? [];
  // "Allow drivers to choose their route" off: the default route becomes a fixed assignment.
  const routesLocked = org?.driversChooseRoute === false;

  const loadMembers = useCallback(async () => {
    if (!org) return;
    setIsLoading(true);
    setError(null);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: OrgMember[] = await res.json();
      setMembers(data);

      // The endpoint returns each member's full doc, defaultRouteId included.
      const defaults: Record<string, string | null> = {};
      data
        .filter((m) => m.role === 'driver' || m.role === 'admin')
        .forEach((m) => { defaults[m.uid] = m.defaultRouteId ?? null; });
      setDriverDefaults(defaults);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load members.');
    } finally {
      setIsLoading(false);
    }
  }, [org]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const saveDefaultRoute = useCallback(
    async (uid: string, routeId: string | null) => {
      if (!org) return;
      setSavingRoute(uid);
      try {
        await setDoc(
          doc(db, 'orgs', org.orgId, 'users', uid),
          { defaultRouteId: routeId ?? null },
          { merge: true },
        );
        setDriverDefaults((prev) => ({ ...prev, [uid]: routeId }));
      } catch (e: any) {
        showToast(e?.message ?? 'Could not save route assignment.', 'error');
      } finally {
        setSavingRoute(null);
      }
    },
    [org],
  );

  const applyRole = useCallback(
    async (uid: string, role: string) => {
      if (!org) return;
      try {
        const token = await getBearerToken();
        const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/users/${uid}/role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ role }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
        setMembers((prev) =>
          prev.map((m) => (m.uid === uid ? { ...m, role: role as OrgMember['role'] } : m)),
        );
      } catch (e: any) {
        showToast(e?.message ?? 'Could not update role.', 'error');
      }
    },
    [org],
  );

  const decideApproval = useCallback(
    async (member: OrgMember, decision: 'approve' | 'decline', reason?: string) => {
      if (!org) return;
      setDecidingUid(member.uid);
      try {
        const token = await getBearerToken();
        const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/users/${member.uid}/approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? 'Failed');
        setMembers((prev) => prev.map((m) => (
          m.uid === member.uid
            ? { ...m, approvalStatus: body.approvalStatus, approvedAt: decision === 'approve' ? { seconds: Date.now() / 1000 } : m.approvedAt }
            : m
        )));
        showToast(decision === 'approve' ? `${memberLabel(member)} approved.` : 'Request declined.', 'success');
      } catch (e: any) {
        showToast(e?.message ?? 'Could not update the request.', 'error');
      } finally {
        setDecidingUid(null);
      }
    },
    [org],
  );

  // A parent's children, so an admin can see who they pick up — including any
  // added after approval.
  const personTargetUid = personTarget?.uid;
  const personTargetIsParent = personTarget?.role === 'parent';
  useEffect(() => {
    setTargetChildren(null);
    if (!org || !personTargetUid || !personTargetIsParent) return;
    let cancelled = false;
    getDocs(collection(db, 'orgs', org.orgId, 'users', personTargetUid, 'children'))
      .then((snap) => {
        if (cancelled) return;
        setTargetChildren(snap.docs.map((d) => {
          const data = d.data() as any;
          return { id: d.id, name: data.name ?? '', grade: data.grade ?? null, createdSec: data.createdAt?.seconds ?? 0 };
        }));
      })
      .catch(() => { if (!cancelled) setTargetChildren('error'); });
    return () => { cancelled = true; };
  }, [org, personTargetUid, personTargetIsParent]);

  const handleRemoveUser = useCallback(
    (member: OrgMember) => {
      if (!org) return;
      if (member.uid === currentUser?.uid) {
        showToast('Ask another admin to remove your account.', 'error');
        return;
      }
      if (org.ownerUid && member.uid === org.ownerUid) {
        showToast('The org owner cannot be removed.', 'error');
        return;
      }
      Alert.alert(
        'Remove member',
        `Remove ${memberLabel(member)} from ${org.name}? They will lose access immediately.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                const token = await getBearerToken();
                const res = await fetch(
                  `${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/users/${member.uid}`,
                  { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
                );
                if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
                setMembers((prev) => prev.filter((m) => m.uid !== member.uid));
              } catch (e: any) {
                showToast(e?.message ?? 'Could not remove user.', 'error');
              }
            },
          },
        ],
      );
    },
    [org, currentUser?.uid],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <AppButton label="Retry" onPress={loadMembers} style={{ marginTop: 12, minWidth: 120 }} />
      </View>
    );
  }

  const orgSlug = org?.slug ?? org?.orgId ?? '';

  const searchQuery = search.trim().toLowerCase();
  const matchesSearch = (m: OrgMember) =>
    !searchQuery ||
    (m.displayName ?? '').toLowerCase().includes(searchQuery) ||
    (m.email ?? '').toLowerCase().includes(searchQuery) ||
    (m.phone ?? '').includes(searchQuery);

  // Waiting for approval (oldest first) — shown above everything else. Declined
  // requests aren't members; they can ask again from their app.
  const pendingMembers = members
    .filter((m) => m.approvalStatus === 'pending')
    .sort((a, b) => tsSeconds(a.approvalRequestedAt ?? a.createdAt) - tsSeconds(b.approvalRequestedAt ?? b.createdAt));
  const approvedMembers = members.filter((m) => !m.approvalStatus || m.approvalStatus === 'approved');

  const staff = approvedMembers.filter((m) => m.role === 'driver' || m.role === 'admin');
  const riders = approvedMembers.filter((m) => m.role === 'student');
  const parents = approvedMembers.filter((m) => m.role === 'parent');
  const showParentsFilter = parentsAllowed || parents.length > 0;
  const inFilter =
    memberFilter === 'staff' ? staff : memberFilter === 'parents' ? parents : riders;
  const visibleMembers = inFilter.filter(matchesSearch);

  // People who joined in the last 7 days — shown first under Riders so an
  // admin can find a newly signed-up driver and switch their role.
  const weekAgoSec = Date.now() / 1000 - 7 * 86_400;
  const joinedSec = (m: OrgMember) => tsSeconds(m.createdAt);
  const newRiders = memberFilter === 'riders' && !searchQuery
    ? visibleMembers.filter((m) => joinedSec(m) >= weekAgoSec)
    : [];
  const otherMembers = visibleMembers.filter((m) => !newRiders.includes(m));

  const INVITE_MESSAGES: Record<typeof inviteRole, string> = {
    student: `You're invited to use ${org?.name ?? 'our shuttle'} on Shuttler!\n\n1. Download the Shuttler app\n2. Search for "${org?.name ?? orgSlug}" (Org ID: ${orgSlug})\n3. Sign up and you're all set — track the bus and request pickups in real time.`,
    driver:  `You've been invited to drive for ${org?.name ?? 'our shuttle'} on Shuttler!\n\n1. Download the Shuttler app\n2. Search for "${org?.name ?? orgSlug}" (Org ID: ${orgSlug})\n3. Sign up — your admin will assign you the Driver role\n4. Open the app, start sharing location, and you're live.`,
    parent:  `Track your child's shuttle with ${org?.name ?? 'our shuttle'} on Shuttler!\n\n1. Download the Shuttler app\n2. Search for "${org?.name ?? orgSlug}" (Org ID: ${orgSlug})\n3. Sign up and add your child's profile\n4. See the bus live and get notified when it arrives at their stop.`,
  };

  const handleShareInvite = () => {
    Share.share({ message: INVITE_MESSAGES[inviteRole] }).catch(() => {});
  };

  const handleCopyId = () => {
    Clipboard.setString(orgSlug);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const INVITE_ROLE_LABELS: { key: typeof inviteRole; label: string; icon: string }[] = [
    { key: 'student', label: 'Student', icon: 'school' },
    { key: 'driver',  label: 'Driver',  icon: 'directions-bus' },
    ...(parentsAllowed ? [{ key: 'parent' as const, label: 'Parent', icon: 'family-restroom' }] : []),
  ];

  const roleColor = (role: string) => (role === 'admin' ? primaryColor : ROLE_COLORS[role]);

  const renderMember = (member: OrgMember) => {
    const isStaffMember = member.role === 'driver' || member.role === 'admin';
    const assignedRouteId = driverDefaults[member.uid] ?? null;
    const assignedRoute = assignedRouteId ? orgRoutes.find((r) => r.id === assignedRouteId) : null;
    const isSelf = member.uid === currentUser?.uid;
    const isOwner = !!(org?.ownerUid && member.uid === org.ownerUid);
    const detail = [
      ROLE_LABELS[member.role],
      isStaffMember && orgRoutes.length > 0 ? (assignedRoute ? assignedRoute.name : routesLocked ? 'No route assigned' : 'No default route') : null,
    ].filter(Boolean).join(' · ');
    return (
      <TouchableOpacity
        key={member.uid}
        style={usersStyles.personRow}
        onPress={() => setPersonTarget(member)}
        accessibilityRole="button"
        accessibilityHint="Change role, route, or remove"
      >
        <View style={[styles.memberAvatar, { backgroundColor: `${roleColor(member.role)}20` }]}>
          <Text style={[styles.memberAvatarText, { color: roleColor(member.role) }]}>
            {memberLabel(member).charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.memberInfo}>
          <View style={usersStyles.nameRow}>
            <Text style={styles.memberName} numberOfLines={1}>{memberLabel(member)}</Text>
            {isOwner && (
              <View style={usersStyles.ownerBadge}><Text style={usersStyles.ownerBadgeText}>Owner</Text></View>
            )}
            {isSelf && !isOwner && (
              <View style={usersStyles.youBadge}><Text style={usersStyles.youBadgeText}>You</Text></View>
            )}
          </View>
          <Text style={styles.memberEmail} numberOfLines={1}>{detail}</Text>
        </View>
        <Icon name="chevron-right" size={20} color={GRAY_400} />
      </TouchableOpacity>
    );
  };

  const renderPending = (member: OrgMember) => {
    const requestedSec = tsSeconds(member.approvalRequestedAt ?? member.createdAt);
    const children = member.approvalRequest?.children ?? [];
    const busy = decidingUid === member.uid;
    return (
      <View key={member.uid} style={usersStyles.pendingCard}>
        <Text style={usersStyles.pendingName}>{member.displayName || 'No name given'}</Text>
        {!!member.phone && (
          <View style={usersStyles.pendingRow}>
            <Icon name="phone" size={16} color={GRAY_700} />
            <Text style={usersStyles.pendingPhone}>{member.phone}</Text>
            <Text style={usersStyles.pendingVerified}>verified by SMS</Text>
          </View>
        )}
        {!!member.email && (
          <View style={usersStyles.pendingRow}>
            <Icon name="email" size={16} color={GRAY_700} />
            <Text style={usersStyles.pendingDetail}>{member.email}</Text>
          </View>
        )}
        {!!member.relationship && (
          <Text style={usersStyles.pendingDetail}>
            {RELATIONSHIP_LABELS[member.relationship] ?? member.relationship} of:
          </Text>
        )}
        {children.map((c, i) => (
          <Text key={i} style={usersStyles.pendingDetail}>
            • {c.name}{c.grade ? ` — grade ${c.grade}` : ''}
          </Text>
        ))}
        {requestedSec > 0 && (
          <Text style={usersStyles.pendingMeta}>
            Requested {new Date(requestedSec * 1000).toLocaleString()}
          </Text>
        )}
        <View style={usersStyles.pendingBtns}>
          <TouchableOpacity
            style={[usersStyles.inviteBtn, usersStyles.inviteBtnSecondary]}
            onPress={() => { setDeclineReason(''); setDeclineTarget(member); }}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={usersStyles.inviteBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[usersStyles.inviteBtn, { backgroundColor: primaryColor }]}
            onPress={() => decideApproval(member, 'approve')}
            disabled={busy}
            accessibilityRole="button"
          >
            {busy
              ? <ActivityIndicator size="small" color={WHITE} />
              : <Text style={[usersStyles.inviteBtnText, { color: WHITE }]}>Approve</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ---- Person sheet ----
  const target = personTarget ? members.find((m) => m.uid === personTarget.uid) ?? personTarget : null;
  const targetIsSelf = !!target && target.uid === currentUser?.uid;
  const targetIsOwner = !!target && !!org?.ownerUid && target.uid === org.ownerUid;
  const targetIsStaff = !!target && (target.role === 'driver' || target.role === 'admin');
  const targetRouteId = target ? driverDefaults[target.uid] ?? null : null;
  const roleOptions = (['student', 'driver', 'admin', 'parent'] as const).filter(
    (role) => role !== 'parent' || parentsAllowed || target?.role === 'parent',
  );

  const approvedSec = target ? tsSeconds(target.approvedAt) : 0;

  const filterTabs = [
    { key: 'staff' as const, label: 'Staff', count: staff.length },
    { key: 'riders' as const, label: 'Students', count: riders.length },
    ...(showParentsFilter ? [{ key: 'parents' as const, label: 'Parents', count: parents.length }] : []),
  ];

  return (
    <>
    <ScrollView contentContainerStyle={styles.tabContent} keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={usersStyles.header}>
        <View style={{ flex: 1 }}>
          <Text style={usersStyles.headerTitle}>People</Text>
          <Text style={usersStyles.headerSub}>{approvedMembers.length} member{approvedMembers.length === 1 ? '' : 's'}</Text>
        </View>
        <TouchableOpacity
          style={[usersStyles.inviteHeaderBtn, { backgroundColor: primaryColor }]}
          onPress={() => setShowInvite(true)}
          accessibilityRole="button"
        >
          <Icon name="person-add" size={18} color={WHITE} />
          <Text style={usersStyles.inviteHeaderBtnText}>Invite</Text>
        </TouchableOpacity>
      </View>

      {pendingMembers.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={usersStyles.groupLabel}>Waiting for approval ({pendingMembers.length})</Text>
          <Text style={[styles.hint, { marginBottom: 8 }]}>
            Check each phone number against the child's emergency contacts in your school records before approving.
            Approved members can see your buses live.
          </Text>
          {pendingMembers.map(renderPending)}
        </View>
      )}

      {/* Filter */}
      <View style={usersStyles.filterWrap}>
        {filterTabs.map((t) => {
          const active = memberFilter === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[usersStyles.filterTab, active && usersStyles.filterTabActive]}
              onPress={() => setMemberFilter(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[usersStyles.filterText, active && { color: primaryColor }]}>
                {t.label} <Text style={usersStyles.filterCount}>{t.count}</Text>
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {inFilter.length > 6 && (
        <View style={[newStopStyles.searchRow, { marginBottom: 8 }]}>
          <Icon name="search" size={18} color={GRAY_400} style={{ marginRight: 8 }} />
          <TextInput
            style={newStopStyles.searchInput}
            placeholder="Search by name or email…"
            placeholderTextColor={GRAY_400}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
      )}

      {memberFilter === 'staff' && (
        <Text style={[styles.hint, { marginBottom: 8 }]}>
          Drivers and admins. To add a driver, invite them, then find them under Students once they sign up and change their role.
        </Text>
      )}

      {newRiders.length > 0 && (
        <>
          <Text style={usersStyles.groupLabel}>New this week</Text>
          {newRiders.map(renderMember)}
          {otherMembers.length > 0 && <Text style={usersStyles.groupLabel}>Everyone else</Text>}
        </>
      )}

      {otherMembers.map(renderMember)}

      {visibleMembers.length === 0 && (
        <View style={usersStyles.empty}>
          <Icon name={searchQuery ? 'search-off' : 'people-outline'} size={32} color={GRAY_300} />
          <Text style={usersStyles.emptyText}>
            {searchQuery
              ? `No one matches "${search.trim()}".`
              : memberFilter === 'staff'
              ? 'No drivers yet. Tap Invite to bring your first driver on board.'
              : memberFilter === 'parents'
              ? 'No parents have joined yet.'
              : 'No students yet. Tap Invite to share your org.'}
          </Text>
        </View>
      )}
    </ScrollView>

    {/* Invite sheet */}
    <BottomSheet visible={showInvite} onClose={() => setShowInvite(false)}>
      <View style={pickerSheetStyles.handle} />
      <Text style={pickerSheetStyles.title}>Invite people</Text>
      <Text style={pickerSheetStyles.subtitle}>Pick who you're inviting, then share the message.</Text>

      <View style={usersStyles.roleChips}>
        {INVITE_ROLE_LABELS.map(({ key, label, icon }) => {
          const active = inviteRole === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setInviteRole(key)}
              style={[
                usersStyles.roleChip,
                active ? { backgroundColor: primaryColor, borderColor: primaryColor } : { borderColor: GRAY_200 },
              ]}
            >
              <Icon name={icon} size={14} color={active ? WHITE : GRAY_500} />
              <Text style={[usersStyles.roleChipText, { color: active ? WHITE : GRAY_500 }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.hint, { marginVertical: 12 }]}>
        {inviteRole === 'driver'
          ? 'Drivers sign up like everyone else. Once they have, find them under Students (they\'ll be at the top under "New this week") and change their role to Driver.'
          : inviteRole === 'parent'
          ? 'Parents sign up with their phone number and tell you which children they pick up. You approve each one under People before they can see your buses.'
          : membersNeedApproval
          ? 'Students search for your org in the app and sign up. You approve each new account under People before they can see your buses.'
          : 'Students search for your org in the app and sign up — no approval needed.'}
      </Text>

      <View style={usersStyles.orgIdRow}>
        <Text style={usersStyles.orgIdLabel}>Org ID</Text>
        <Text style={[usersStyles.inviteSlug, { color: primaryColor }]} numberOfLines={1}>{orgSlug}</Text>
      </View>
      <View style={[usersStyles.inviteBtns, { marginTop: 12 }]}>
        <TouchableOpacity style={[usersStyles.inviteBtn, usersStyles.inviteBtnSecondary]} onPress={handleCopyId}>
          <Icon name={copiedId ? 'check' : 'content-copy'} size={15} color={copiedId ? PRIMARY_COLOR : GRAY_500} />
          <Text style={[usersStyles.inviteBtnText, copiedId && { color: PRIMARY_COLOR }]}>
            {copiedId ? 'Copied!' : 'Copy ID'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[usersStyles.inviteBtn, { backgroundColor: primaryColor }]} onPress={handleShareInvite}>
          <Icon name="share" size={15} color={WHITE} />
          <Text style={[usersStyles.inviteBtnText, { color: WHITE }]}>Share invite</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>

    {/* Person sheet: role, default route, remove */}
    <BottomSheet visible={target !== null} onClose={() => setPersonTarget(null)}>
      {target && (
        <>
          <View style={pickerSheetStyles.handle} />
          <Text style={pickerSheetStyles.title} numberOfLines={1}>{memberLabel(target)}</Text>
          <Text style={pickerSheetStyles.subtitle} numberOfLines={1}>{target.email ?? target.phone ?? ''}</Text>

          {target.role === 'parent' && (
            <>
              <Text style={usersStyles.sheetLabel}>Children</Text>
              {targetChildren === null ? (
                <ActivityIndicator size="small" color={primaryColor} style={{ alignSelf: 'flex-start' }} />
              ) : targetChildren === 'error' ? (
                <Text style={styles.hint}>Couldn't load their children. Try again later.</Text>
              ) : targetChildren.length === 0 ? (
                <Text style={styles.hint}>No children added.</Text>
              ) : (
                targetChildren.map((c) => (
                  <View key={c.id} style={usersStyles.pendingRow}>
                    <Text style={usersStyles.pendingDetail}>
                      {c.name}{c.grade ? ` — grade ${c.grade}` : ''}
                    </Text>
                    {approvedSec > 0 && c.createdSec > approvedSec && (
                      <View style={usersStyles.addedLaterBadge}>
                        <Text style={usersStyles.addedLaterText}>Added after approval</Text>
                      </View>
                    )}
                  </View>
                ))
              )}
            </>
          )}

          <Text style={usersStyles.sheetLabel}>Role</Text>
          {targetIsOwner || targetIsSelf ? (
            <Text style={styles.hint}>
              {targetIsOwner
                ? 'The org owner is always an admin.'
                : 'Ask another admin to change your role.'}
            </Text>
          ) : (
            <View style={usersStyles.roleChips}>
              {roleOptions.map((role) => {
                const active = target.role === role;
                const color = roleColor(role);
                return (
                  <TouchableOpacity
                    key={role}
                    onPress={() => { if (!active) applyRole(target.uid, role); }}
                    style={[
                      usersStyles.roleChip,
                      active ? { backgroundColor: color, borderColor: color } : { borderColor: GRAY_200 },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[usersStyles.roleChipText, { color: active ? WHITE : GRAY_700 }]}>
                      {ROLE_LABELS[role]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {targetIsStaff && orgRoutes.length > 0 && (
            <>
              <Text style={usersStyles.sheetLabel}>{routesLocked ? 'Assigned route' : 'Default route'}</Text>
              <Text style={[styles.hint, { marginBottom: 6 }]}>
                {routesLocked
                  ? 'Drivers always drive this route ("Allow drivers to choose their route" is off in Operations). Without one, they can\'t go online.'
                  : 'Pre-selected when they go online. They can still switch.'}
              </Text>
              {[{ id: null as string | null, name: routesLocked ? 'No route' : 'No default' }, ...orgRoutes.map((r) => ({ id: r.id as string | null, name: r.name }))].map((r) => {
                const active = targetRouteId === r.id;
                return (
                  <TouchableOpacity
                    key={r.id ?? 'none'}
                    style={pickerSheetStyles.option}
                    onPress={() => { if (!active) saveDefaultRoute(target.uid, r.id); }}
                    disabled={savingRoute === target.uid}
                  >
                    <Icon name={r.id ? 'directions-bus' : 'block'} size={18} color={active ? primaryColor : GRAY_400} />
                    <Text style={[pickerSheetStyles.optionLabel, active && pickerSheetStyles.optionLabelActive]}>{r.name}</Text>
                    {savingRoute === target.uid && active
                      ? <ActivityIndicator size="small" color={primaryColor} />
                      : active && <Icon name="check" size={18} color={primaryColor} />}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {!targetIsOwner && !targetIsSelf && (
            <TouchableOpacity
              style={stopsUi.deleteLink}
              onPress={() => { const m = target; setPersonTarget(null); handleRemoveUser(m); }}
            >
              <Icon name="person-remove" size={18} color={DANGER_COLOR} />
              <Text style={stopsUi.deleteLinkText}>Remove from {org?.name ?? 'org'}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={pickerSheetStyles.cancelBtn} onPress={() => setPersonTarget(null)}>
            <Text style={pickerSheetStyles.cancelText}>Done</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>

    {/* Decline an approval request, with an optional reason they'll see */}
    <BottomSheet visible={declineTarget !== null} onClose={() => setDeclineTarget(null)}>
      {declineTarget && (
        <>
          <View style={pickerSheetStyles.handle} />
          <Text style={pickerSheetStyles.title} numberOfLines={1}>Decline {memberLabel(declineTarget)}?</Text>
          <Text style={pickerSheetStyles.subtitle}>
            They won't get access. They'll be asked to contact the school office and can send a new request.
          </Text>
          <TextInput
            style={[newStopStyles.searchInput, usersStyles.reasonInput]}
            placeholder="Reason (optional, shown to them)"
            placeholderTextColor={GRAY_400}
            value={declineReason}
            onChangeText={setDeclineReason}
            maxLength={200}
            multiline
          />
          <AppButton
            label="Decline request"
            onPress={() => { const m = declineTarget; setDeclineTarget(null); decideApproval(m, 'decline', declineReason.trim()); }}
            color={DANGER_COLOR}
            style={{ marginTop: 12 }}
          />
          <TouchableOpacity style={pickerSheetStyles.cancelBtn} onPress={() => setDeclineTarget(null)}>
            <Text style={pickerSheetStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </>
      )}
    </BottomSheet>
    </>
  );
}

const usersStyles = StyleSheet.create({
  pendingCard: {
    backgroundColor: WHITE,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: GRAY_200,
    padding: 14,
    marginBottom: 10,
  },
  pendingName: { fontSize: 16, fontWeight: '700', color: GRAY_900, marginBottom: 6 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  pendingPhone: { fontSize: 16, fontWeight: '700', color: GRAY_900 },
  pendingVerified: { fontSize: 11, color: GRAY_500 },
  pendingDetail: { fontSize: 14, color: GRAY_700, marginBottom: 2 },
  pendingMeta: { fontSize: 12, color: GRAY_400, marginTop: 6 },
  pendingBtns: { flexDirection: 'row', gap: 8, marginTop: 12 },
  addedLaterBadge: { backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  addedLaterText: { fontSize: 11, fontWeight: '700', color: '#92400e' },
  reasonInput: {
    borderWidth: 1,
    borderColor: GRAY_200,
    borderRadius: borderRadius.md,
    padding: 12,
    minHeight: 72,
    marginTop: 12,
    textAlignVertical: 'top',
  },
  roleChips: {
    flexDirection: 'row',
    gap: 8,
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: GRAY_200,
    backgroundColor: GRAY_50,
  },
  roleChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: GRAY_500,
  },
  orgIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orgIdLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY_400,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inviteSlug: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY_COLOR,
  },
  inviteBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  inviteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  inviteBtnSecondary: {
    borderWidth: 1,
    borderColor: GRAY_200,
    backgroundColor: GRAY_50,
  },
  inviteBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: GRAY_500,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ownerBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ownerBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  youBadge: {
    backgroundColor: '#e0f2fe',
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0369a1',
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: GRAY_900 },
  headerSub: { fontSize: 13, color: GRAY_500, marginTop: 2 },
  inviteHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: borderRadius.xl,
  },
  inviteHeaderBtnText: { color: WHITE, fontWeight: '700', fontSize: 14 },
  filterWrap: {
    flexDirection: 'row',
    padding: 3,
    backgroundColor: GRAY_100,
    borderRadius: borderRadius.md,
    marginBottom: 12,
  },
  filterTab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: borderRadius.sm },
  filterTabActive: { backgroundColor: WHITE, ...cardShadow },
  filterText: { fontSize: 14, fontWeight: '600', color: GRAY_500 },
  filterCount: { fontSize: 13, fontWeight: '500', color: GRAY_400 },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY_400,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_100,
  },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, color: GRAY_500, textAlign: 'center', paddingHorizontal: 24 },
  sheetLabel: { fontSize: 13, fontWeight: '700', color: GRAY_700, marginTop: 16, marginBottom: 8 },
});

const pickerSheetStyles = StyleSheet.create({
  handle: {
    width: 40,
    height: 4,
    backgroundColor: GRAY_200,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: GRAY_900,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: GRAY_500,
    textAlign: 'center',
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_100,
  },
  optionLabel: {
    flex: 1,
    fontSize: 15,
    color: GRAY_700,
  },
  optionLabelActive: {
    fontWeight: '700',
    color: GRAY_900,
  },
  roleCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCircleText: {
    fontSize: 14,
    fontWeight: '700',
  },
  cancelBtn: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: GRAY_100,
    borderRadius: borderRadius.md,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: GRAY_700,
  },
});

// ---- Plan Detail Sheet ----

const PLAN_DETAILS: Record<string, {
  label: string;
  price: string;
  tagline: string;
  highlight?: string;
  features: { icon: string; text: string }[];
  compareNote?: string;
}> = {
  starter: {
    label: 'Starter',
    price: '$149 / mo',
    tagline: 'Everything you need to launch your shuttle operation.',
    features: [
      { icon: 'directions-bus', text: 'Up to 3 vehicles online at once' },
      { icon: 'place', text: 'Up to 10 stops · 1 route' },
      { icon: 'gps-fixed', text: 'Real-time GPS tracking for all riders' },
      { icon: 'touch-app', text: 'Stop request system for students & parents' },
      { icon: 'phone-android', text: 'Driver app included' },
      { icon: 'dashboard', text: 'Live admin dashboard' },
      { icon: 'auto-awesome', text: 'AI assistant + weekly & monthly insights' },
      { icon: 'email', text: 'Email support' },
    ],
  },
  campus: {
    label: 'Campus',
    price: '$299 / mo',
    tagline: 'Built for universities, airports, and growing operations.',
    highlight: 'Most popular',
    compareNote: 'Everything in Starter, plus:',
    features: [
      { icon: 'directions-bus', text: 'Up to 8 vehicles online at once' },
      { icon: 'all-inclusive', text: 'Unlimited routes and stops' },
      { icon: 'schedule', text: 'Per-weekday route scheduling' },
      { icon: 'security', text: 'SAML SSO for institutional login' },
      { icon: 'support-agent', text: 'Priority support' },
    ],
  },
  enterprise: {
    label: 'Enterprise',
    price: 'From $499/mo',
    tagline: 'For large-scale deployments with custom requirements.',
    compareNote: 'Everything in Campus, plus:',
    features: [
      { icon: 'directions-bus', text: '15 vehicles included, +$30/vehicle/mo beyond' },
      { icon: 'palette', text: 'Custom branding' },
      { icon: 'verified', text: 'SLA guarantee' },
      { icon: 'support-agent', text: 'Dedicated support manager' },
      { icon: 'code', text: 'Custom integrations & data API' },
    ],
  },
  data_addon: {
    label: 'Data Analytics',
    price: '$49 / mo',
    tagline: 'Your complete boarding data — visualized, filterable, exportable.',
    highlight: 'Add-on to any plan',
    features: [
      { icon: 'history', text: 'Full boarding history, all time' },
      { icon: 'trending-up', text: 'Trend analysis vs previous periods (7D / 30D / 90D)' },
      { icon: 'place', text: 'Stop-by-stop ridership bar charts' },
      { icon: 'people', text: 'Per-driver performance breakdown' },
      { icon: 'calendar-today', text: 'Weekday ridership patterns' },
      { icon: 'share', text: 'CSV export for reports and records' },
    ],
  },
};

function PlanDetailSheet({
  planKey,
  visible,
  onClose,
  onAction,
  actionLabel,
  actionDisabled,
  primaryColor,
}: {
  planKey: string | null;
  visible: boolean;
  onClose: () => void;
  onAction: () => void;
  actionLabel: string;
  actionDisabled?: boolean;
  primaryColor: string;
}) {
  const plan = planKey ? PLAN_DETAILS[planKey] : null;
  if (!plan) return null;

  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={detailStyles.sheet}>
      <View style={detailStyles.handle} />
        {plan.highlight && (
          <View style={[detailStyles.highlightBadge, { backgroundColor: `${primaryColor}18` }]}>
            <Icon name="star" size={12} color={primaryColor} />
            <Text style={[detailStyles.highlightText, { color: primaryColor }]}>{plan.highlight}</Text>
          </View>
        )}
        <Text style={detailStyles.planName}>{plan.label}</Text>
        <Text style={[detailStyles.planPrice, { color: primaryColor }]}>{plan.price}</Text>
        <Text style={detailStyles.tagline}>{plan.tagline}</Text>

        <View style={detailStyles.divider} />

        {plan.compareNote && (
          <Text style={detailStyles.compareNote}>{plan.compareNote}</Text>
        )}

        <View style={detailStyles.featureList}>
          {plan.features.map(({ icon, text }) => (
            <View key={text} style={detailStyles.featureRow}>
              <View style={[detailStyles.featureIconWrap, { backgroundColor: `${primaryColor}12` }]}>
                <Icon name={icon} size={16} color={primaryColor} />
              </View>
              <Text style={detailStyles.featureText}>{text}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[
            detailStyles.ctaBtn,
            { backgroundColor: actionDisabled ? GRAY_200 : primaryColor },
          ]}
          onPress={() => { if (!actionDisabled) { onAction(); onClose(); } }}
          disabled={actionDisabled}
        >
          <Text style={[detailStyles.ctaBtnText, { color: actionDisabled ? GRAY_400 : WHITE }]}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
    </BottomSheet>
  );
}

const detailStyles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 48,
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: GRAY_200,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  highlightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: borderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  highlightText: {
    fontSize: 12,
    fontWeight: '700',
  },
  planName: {
    fontSize: 22,
    fontWeight: '800',
    color: GRAY_900,
    marginBottom: 4,
  },
  planPrice: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    color: GRAY_500,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: GRAY_100,
    marginVertical: 16,
  },
  compareNote: {
    fontSize: 12,
    fontWeight: '700',
    color: GRAY_400,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  featureList: {
    gap: 12,
    marginBottom: 24,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    color: GRAY_700,
    lineHeight: 20,
  },
  ctaBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

// ---- Billing Tab ----

function BillingTab() {
  const { org, refreshOrg, clearOrg } = useOrg();
  const { user } = useAuth();
  const { primaryColor } = useOrgTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isDeletingOrg, setIsDeletingOrg] = useState(false);
  const [confirmation, setConfirmation] = useState<'plan' | 'addon' | null>(null);

  // iOS can't present a Modal while the Stripe browser sheet is up — the
  // half-presented Modal blocks the sheet's dismissal and then eats every
  // touch on the tab. Queue confirmations that arrive mid-checkout (the
  // webhook usually beats Stripe's success redirect) and show them only
  // after the browser is gone.
  const browserOpenRef = useRef(false);
  const pendingConfirmationRef = useRef<'plan' | 'addon' | null>(null);

  const showOrQueueConfirmation = useCallback((kind: 'plan' | 'addon') => {
    if (browserOpenRef.current) pendingConfirmationRef.current = kind;
    else setConfirmation(kind);
  }, []);

  const openExternalCheckout = useExternalCheckout('shuttler://billing');

  // Returns true if a queued confirmation is about to be shown.
  const finishBrowserSession = useCallback(() => {
    browserOpenRef.current = false;
    const pending = pendingConfirmationRef.current;
    if (!pending) return false;
    pendingConfirmationRef.current = null;
    // Let the browser sheet finish its dismissal animation first —
    // presenting a Modal mid-dismissal hits the same iOS bug.
    setTimeout(() => setConfirmation(pending), 500);
    return true;
  }, []);

  const openCheckout = useCallback(
    async (plan: string) => {
      if (!org) return;
      setIsLoading(true);
      try {
        const token = await getBearerToken();
        const res = await fetch(`${SHUTTLER_API_URL}/billing/create-checkout-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orgId: org.orgId, plan, returnUrl: 'shuttler://billing' }),
        });
        // mode 'plan_change': the org already has a subscription, so the
        // backend opens Stripe's confirm-plan-change page instead of a new
        // checkout (which would bill a second subscription).
        const { url, error, mode } = await res.json();
        if (error) throw new Error(error);
        const isPlanChange = mode === 'plan_change';

        browserOpenRef.current = true;
        const result = await openExternalCheckout(
          url,
          isPlanChange
            ? "You'll confirm your plan change with Stripe in Safari — it uses the card on file and shows the prorated amount — then return to Shuttler automatically."
            : "You'll complete your plan upgrade on shuttler.net in Safari, then return to Shuttler automatically.",
        );
        const confirmed = finishBrowserSession();

        // Browser closed (no redirect) — user dismissed without touching Stripe.
        if (result.type !== 'success') return;

        // Stripe cancel/back redirects to shuttler://billing with no params.
        // Success redirects to shuttler://billing?session_id=... (checkout)
        // or shuttler://billing?plan_changed=1 (plan change).
        const redirectedUrl = (result as any).url as string | undefined;
        if (!redirectedUrl?.includes('session_id=') && !redirectedUrl?.includes('plan_changed=')) {
          if (!confirmed) {
            showToast(
              isPlanChange ? 'Plan change canceled — your plan is unchanged.' : "Checkout canceled — you haven't been charged.",
              'info',
            );
          }
          return;
        }

        // Payment confirmed — unlock the UI immediately.
        // The Firestore live listener fires the confirmation sheet as soon as
        // the webhook updates the org doc. Background polls are a safety net.
        if (!confirmed) showToast(isPlanChange ? 'Plan change confirmed — updating your plan…' : 'Payment received — activating your plan…', 'success');
        void refreshOrg();
        setTimeout(() => void refreshOrg(), 3000);
        setTimeout(() => void refreshOrg(), 7000);
      } catch (e: any) {
        showToast(e?.message ?? 'Failed to open billing.', 'error');
      } finally {
        browserOpenRef.current = false;
        setIsLoading(false);  // unblocks immediately — no more 10s freeze
      }
    },
    [org, refreshOrg, finishBrowserSession, openExternalCheckout],
  );

  const openAddonCheckout = useCallback(async () => {
    if (!org) return;
    setIsLoading(true);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/billing/create-addon-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: org.orgId, returnUrl: 'shuttler://billing' }),
      });
      const { url, error } = await res.json();
      if (error) throw new Error(error);

      browserOpenRef.current = true;
      const result = await openExternalCheckout(
        url,
        "You'll complete your add-on purchase on shuttler.net in Safari, then return to Shuttler automatically.",
      );
      const confirmed = finishBrowserSession();

      if (result.type !== 'success') return;
      const redirectedUrl = (result as any).url as string | undefined;
      if (!redirectedUrl?.includes('session_id=')) {
        if (!confirmed) showToast("Checkout canceled — you haven't been charged.", 'info');
        return;
      }

      if (!confirmed) showToast('Payment received — activating your add-on…', 'success');
      void refreshOrg();
      setTimeout(() => void refreshOrg(), 3000);
      setTimeout(() => void refreshOrg(), 7000);
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to open billing.', 'error');
    } finally {
      browserOpenRef.current = false;
      setIsLoading(false);
    }
  }, [org, refreshOrg, finishBrowserSession, openExternalCheckout]);

  const openPortal = useCallback(async () => {
    if (!org) return;
    setIsLoading(true);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/billing/create-portal-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: org.orgId, returnUrl: 'shuttler://billing' }),
      });
      const { url, error } = await res.json();
      if (error) throw new Error(error);

      browserOpenRef.current = true;
      const result = await openExternalCheckout(
        url,
        "You'll manage your subscription on shuttler.net in Safari, then return to Shuttler automatically.",
      );
      finishBrowserSession();

      // Browser closed without redirect — user opened portal and dismissed immediately.
      if (result.type !== 'success') return;

      // Portal returned — user may have made changes. Poll briefly for webhook.
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await refreshOrg();
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to open billing portal.', 'error');
    } finally {
      browserOpenRef.current = false;
      setIsLoading(false);
    }
  }, [org, refreshOrg, finishBrowserSession, openExternalCheckout]);

  const confirmDeleteOrg = useCallback(async () => {
    if (!org) return;
    setIsDeletingOrg(true);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to delete organization.');
      showToast('Organization deleted.', 'success');
      // Back to org selection — the account itself still exists and can now be
      // deleted from the Profile screen.
      await clearOrg();
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to delete organization.', 'error');
      setIsDeletingOrg(false);
    }
  }, [org, clearOrg]);

  const handleDeleteOrg = useCallback(() => {
    Alert.alert(
      'Delete Organization?',
      'This permanently deletes your organization for every member — routes, stops, ridership history, and all accounts data. Any remaining subscription (including the Data Analytics add-on) is canceled immediately. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Are you absolutely sure?',
              `"${org?.name ?? 'This organization'}" and all of its data will be gone forever.`,
              [
                { text: 'Keep my organization', style: 'cancel' },
                { text: 'Delete forever', style: 'destructive', onPress: confirmDeleteOrg },
              ],
            ),
        },
      ],
    );
  }, [org?.name, confirmDeleteOrg]);

  const [detailPlan, setDetailPlan] = useState<string | null>(null);
  const navigation = useNavigation<any>();

  // Capture baseline so we only celebrate changes that happen this session
  const baselineStatus = useRef(org?.subscriptionStatus);
  const baselinePlan   = useRef(org?.subscriptionPlan);
  const baselineAddon  = useRef(org?.dataAddonActive);

  // React to Firestore live updates — fires as soon as the webhook updates the doc.
  // Covers three purchase paths:
  //   1. Trial → first subscription  (status:  trialing → active)
  //   2. Plan upgrade                 (plan:    starter  → campus)
  //   3. Data addon activation        (dataAddonActive: false → true)
  useEffect(() => {
    if (!org) return;

    const wentActive  = org.subscriptionStatus === 'active' && baselineStatus.current !== 'active';
    const planChanged = !!org.subscriptionPlan && org.subscriptionPlan !== baselinePlan.current;

    if (wentActive || planChanged) {
      showOrQueueConfirmation('plan');
      baselineStatus.current = org.subscriptionStatus;
      baselinePlan.current   = org.subscriptionPlan;
    }

    if (org.dataAddonActive && !baselineAddon.current) {
      showOrQueueConfirmation('addon');
      baselineAddon.current = true;
    }
  }, [org?.subscriptionStatus, org?.subscriptionPlan, org?.dataAddonActive]);

  const currentLimits = getPlanLimits(org?.subscriptionPlan, org?.subscriptionStatus, org?.limitOverrides);
  const isActive = org?.subscriptionStatus === 'active';
  // Has a real Stripe subscription, so a plan button switches plans on it
  // (the backend's isLiveSubscription) rather than starting a checkout.
  // 'trialing' is excluded on purpose: here it's the app-level free trial,
  // which has no subscription yet and must still be able to Subscribe.
  const hasSubscription = isActive || org?.subscriptionStatus === 'past_due';
  const isTrialing = org?.subscriptionStatus === 'trialing' || !org?.subscriptionPlan;
  const trialExpired = isTrialExpired(org?.subscriptionStatus, org?.trialEndsAtMs);
  const dataUnlocked = org?.entitlements?.dataApi ?? org?.dataAddonActive ?? false;
  const statusColor = isActive || (isTrialing && !trialExpired) ? '#2e7d32' : DANGER_COLOR;
  const isApproved = org?.approved === true;

  const PLANS = [
    {
      key: 'starter' as const,
      label: 'Starter',
      price: '$149/mo',
      desc: 'Up to 3 vehicles · 1 route',
    },
    {
      key: 'campus' as const,
      label: 'Campus',
      price: '$299/mo',
      desc: 'Up to 8 vehicles · Unlimited routes',
      popular: true,
    },
  ];

  return (
    <>
    <ScrollView contentContainerStyle={styles.tabContent}>
      {/* Current plan card */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View>
            <Text style={styles.statusLabel}>Current Plan</Text>
            <Text style={styles.statusPlanName}>{currentLimits.label}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {trialExpired ? 'Trial ended' : isTrialing ? 'Trial' : org?.subscriptionStatus ?? '—'}
            </Text>
          </View>
        </View>
        <View style={styles.statusLimitsRow}>
          <Text style={styles.statusLimitItem}>
            🚌 {vehicleLimitText(currentLimits)}
          </Text>
          <Text style={styles.statusLimitItem}>
            🗺 {routeLimitText(currentLimits)}
          </Text>
        </View>
        {isTrialing && (
          <Text style={styles.trialNote}>
            You're on a free trial — same limits as Starter. Subscribe to keep your service running.
          </Text>
        )}
      </View>

      {!isApproved && (
        <View style={styles.pendingReviewBox}>
          <Icon name="hourglass-empty" size={22} color="#f59e0b" />
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingReviewTitle}>Account pending review</Text>
            <Text style={styles.pendingReviewBody}>
              Our team will review your application within 1 business day. Paid plans will unlock
              once approved — your trial is fully functional in the meantime.
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionLabel}>Available Plans</Text>

      {PLANS.map((plan) => {
        const isCurrent = org?.subscriptionPlan === plan.key && hasSubscription;
        return (
          <View key={plan.key} style={[styles.planCard, isCurrent && styles.planCardActive, isCurrent && { borderColor: primaryColor }]}>
            <View style={styles.planInfo}>
              <View style={styles.planNameRow}>
                <Text style={styles.planName}>{plan.label}</Text>
                {plan.popular && <View style={[styles.popularBadge, { backgroundColor: `${primaryColor}20` }]}><Text style={[styles.popularBadgeText, { color: primaryColor }]}>Most Popular</Text></View>}
                {isCurrent && <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>Current</Text></View>}
              </View>
              <Text style={[styles.planPrice, { color: primaryColor }]}>{plan.price}</Text>
              <Text style={styles.planDesc}>{plan.desc}</Text>
              <TouchableOpacity onPress={() => setDetailPlan(plan.key)} style={styles.learnMoreBtn}>
                <Text style={[styles.learnMoreText, { color: primaryColor }]}>See what's included →</Text>
              </TouchableOpacity>
            </View>
            <AppButton
              label={isCurrent ? (isActive ? 'Active' : 'Current') : (!isApproved ? 'Pending' : (isLoading ? '…' : (hasSubscription ? 'Switch' : 'Subscribe')))}
              onPress={() => !isCurrent && isApproved && openCheckout(plan.key)}
              disabled={isLoading || isCurrent || !isApproved}
              style={styles.planButton}
            />
          </View>
        );
      })}

      <View style={styles.planCard}>
        <View style={styles.planInfo}>
          <Text style={styles.planName}>Enterprise</Text>
          <Text style={[styles.planPrice, { color: primaryColor }]}>From $499/mo</Text>
          <Text style={styles.planDesc}>15+ vehicles · SSO · SLA · Custom branding</Text>
          <TouchableOpacity onPress={() => setDetailPlan('enterprise')} style={styles.learnMoreBtn}>
            <Text style={[styles.learnMoreText, { color: primaryColor }]}>See what's included →</Text>
          </TouchableOpacity>
        </View>
        <AppButton
          label="Contact us"
          onPress={() => WebBrowser.openBrowserAsync('https://shuttler.net')}
          style={styles.planButton}
        />
      </View>

      {/* Data Add-on */}
      <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Add-ons</Text>
      {(() => {
        return (
          <View style={[styles.planCard, dataUnlocked && styles.planCardActive, dataUnlocked && { borderColor: primaryColor }]}>
            <View style={styles.planInfo}>
              <View style={styles.planNameRow}>
                <Text style={styles.planName}>Data Analytics</Text>
                {dataUnlocked && <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>Active</Text></View>}
              </View>
              <Text style={[styles.planPrice, { color: primaryColor }]}>$49/mo</Text>
              <Text style={styles.planDesc}>Trends, charts, driver stats, and CSV export.</Text>
              {dataUnlocked ? (
                <Text style={[styles.planDesc, { color: '#2e7d32', marginTop: 4 }]}>
                  ✓ Unlimited export history · Extended data retention
                </Text>
              ) : (
                <TouchableOpacity onPress={() => setDetailPlan('data_addon')} style={styles.learnMoreBtn}>
                  <Text style={[styles.learnMoreText, { color: primaryColor }]}>See what's included →</Text>
                </TouchableOpacity>
              )}
            </View>
            <AppButton
              label={dataUnlocked ? 'Active' : (isLoading ? '…' : 'Add')}
              onPress={() => !dataUnlocked && isApproved && openAddonCheckout()}
              disabled={isLoading || dataUnlocked || !isApproved}
              style={styles.planButton}
            />
          </View>
        );
      })()}

      {/* Plan detail sheet */}
      <PlanDetailSheet
        planKey={detailPlan}
        visible={detailPlan !== null}
        onClose={() => setDetailPlan(null)}
        primaryColor={primaryColor}
        onAction={() => {
          if (detailPlan === 'data_addon') {
            openAddonCheckout();
          } else if (detailPlan === 'enterprise') {
            WebBrowser.openBrowserAsync('https://shuttler.net');
          } else if (detailPlan) {
            openCheckout(detailPlan);
          }
        }}
        actionLabel={
          detailPlan === 'data_addon' ? 'Add Data Analytics — $49/mo'
          : detailPlan === 'enterprise' ? 'Contact Us'
          : detailPlan === 'campus' ? `${hasSubscription ? 'Switch to Campus' : 'Subscribe'} — $299/mo`
          : `${hasSubscription ? 'Switch to Starter' : 'Subscribe'} — $149/mo`
        }
        actionDisabled={
          isLoading || !isApproved ||
          (detailPlan !== 'data_addon' && detailPlan !== 'enterprise' &&
            org?.subscriptionPlan === detailPlan && hasSubscription) ||
          (detailPlan === 'data_addon' && dataUnlocked)
        }
      />

      {/* Shown once the org has anything to manage in Stripe. A plain trial org
          has no Stripe customer yet, so opening the portal would 500 — but any
          checkout (plan OR the data add-on) creates one. The add-on is a separate
          subscription that doesn't move subscriptionStatus off 'trialing', so it
          must keep the portal reachable on its own for cancellation. */}
      {(!isTrialing || dataUnlocked) && !!org?.subscriptionStatus && (
        <AppButton
          label={isLoading ? '…' : 'Manage or Cancel Subscription'}
          onPress={openPortal}
          disabled={isLoading}
          variant="secondary"
          style={styles.actionButton}
        />
      )}

      {/* Danger zone — only the org owner can wind down the organization.
          This is the "delete the organization" step ProfileScreen points
          owners to before they can delete their own account. */}
      {!!org?.ownerUid && org.ownerUid === user?.uid && (
        <View style={dangerStyles.card}>
          <Text style={dangerStyles.label}>Danger Zone</Text>
          <Text style={dangerStyles.hint}>
            Permanently delete this organization for all members and cancel any remaining
            subscription. This cannot be undone.
          </Text>
          <TouchableOpacity
            style={[dangerStyles.deleteBtn, isDeletingOrg && { opacity: 0.5 }]}
            onPress={handleDeleteOrg}
            disabled={isDeletingOrg}
          >
            {isDeletingOrg ? (
              <ActivityIndicator size="small" color={DANGER_COLOR} />
            ) : (
              <>
                <Icon name="delete-forever" size={18} color={DANGER_COLOR} />
                <Text style={dangerStyles.deleteBtnText}>Delete Organization</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>

    {/* Purchase confirmation sheet */}
    <BottomSheet visible={confirmation !== null} onClose={() => setConfirmation(null)} sheetStyle={confirmStyles.sheet}>
      <View style={[confirmStyles.iconCircle, { backgroundColor: `${primaryColor}15` }]}>
        <Icon name="check-circle" size={48} color={primaryColor} />
      </View>
      <Text style={confirmStyles.title}>
        {confirmation === 'addon' ? 'Analytics Unlocked!' : `You're on the ${currentLimits.label} plan!`}
      </Text>
      <Text style={confirmStyles.body}>
        {confirmation === 'addon'
          ? 'Your full boarding history, trend charts, driver stats, and CSV export are now available. Find them anytime under Menu > Analytics.'
          : `Your subscription is active. You now have access to ${vehicleLimitText(currentLimits).toLowerCase()} and ${routeLimitText(currentLimits).toLowerCase()}.`}
      </Text>
      {confirmation === 'addon' && (
        <TouchableOpacity
          style={[confirmStyles.primaryBtn, { backgroundColor: primaryColor }]}
          onPress={() => { setConfirmation(null); navigation.navigate('AdminAnalytics'); }}
        >
          <Icon name="bar-chart" size={18} color={WHITE} />
          <Text style={confirmStyles.primaryBtnText}>Go to Analytics</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={confirmStyles.secondaryBtn} onPress={() => setConfirmation(null)}>
        <Text style={confirmStyles.secondaryBtnText}>Done</Text>
      </TouchableOpacity>
    </BottomSheet>
    </>
  );
}

// Mirrors the ProfileScreen danger-zone card so the two flows read as one.
const dangerStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fef2f2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 16,
    marginTop: 24,
    gap: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: DANGER_COLOR,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: 13,
    color: GRAY_500,
    lineHeight: 18,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: DANGER_COLOR,
    borderRadius: 10,
    paddingVertical: 12,
    backgroundColor: WHITE,
  },
  deleteBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: DANGER_COLOR,
  },
});

const confirmStyles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
    alignItems: 'center',
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: GRAY_900,
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    color: GRAY_500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 32,
    marginBottom: 12,
    width: '100%',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: WHITE,
  },
  secondaryBtn: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    color: GRAY_500,
    fontWeight: '500',
  },
});

// ---- Operations Tab ----

const BREAK_DURATION_OPTIONS = [5, 10, 15, 20, 25, 30];
const BREAKS_PER_SHIFT_OPTIONS = [1, 2, 3, 4, 5];

function OperationsTab() {
  const { org, refreshOrg } = useOrg();
  const { primaryColor } = useOrgTheme();

  const existing = org?.breakSettings;
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [maxMinutes, setMaxMinutes] = useState(existing?.maxMinutes ?? 15);
  const [breaksPerShift, setBreaksPerShift] = useState(existing?.breaksPerShift ?? 1);
  const [driversChooseRoute, setDriversChooseRoute] = useState(org?.driversChooseRoute !== false);
  const hasRoutes = (org?.routes ?? []).length > 0;
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!org) return;
    setIsSaving(true);
    try {
      const token = await getBearerToken();
      const breakSettings: BreakSettings = { enabled, maxMinutes, breaksPerShift };
      const res = await fetch(`${SHUTTLER_API_URL}/orgs/${org.orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ breakSettings, driversChooseRoute }),
      });
      if (!res.ok) throw new Error('Save failed');
      await refreshOrg();
      showToast('Operations settings saved.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save settings.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [org, enabled, maxMinutes, breaksPerShift, driversChooseRoute, refreshOrg]);

  return (
    <ScrollView
      contentContainerStyle={styles.tabContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionLabel}>Driver Breaks</Text>
      <Text style={styles.hint}>
        Allow drivers to take scheduled breaks during their shift. Pending stop requests are cancelled when a break starts.
      </Text>

      <View style={opsStyles.settingRow}>
        <View style={{ flex: 1 }}>
          <Text style={opsStyles.settingLabel}>Enable breaks</Text>
          <Text style={opsStyles.settingHint}>Drivers will see a "Take a Break" button while online</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ true: primaryColor }}
          thumbColor={WHITE}
        />
      </View>

      {enabled && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Max break duration</Text>
          <Text style={styles.hint}>The longest break a driver can take at once.</Text>
          <View style={opsStyles.chipRow}>
            {BREAK_DURATION_OPTIONS.map((mins) => (
              <TouchableOpacity
                key={mins}
                style={[opsStyles.chip, maxMinutes === mins && { backgroundColor: primaryColor, borderColor: primaryColor }]}
                onPress={() => setMaxMinutes(mins)}
              >
                <Text style={[opsStyles.chipText, maxMinutes === mins && opsStyles.chipTextActive]}>
                  {mins} min
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Breaks per shift</Text>
          <Text style={styles.hint}>Maximum number of breaks a driver can take per shift.</Text>
          <View style={opsStyles.chipRow}>
            {BREAKS_PER_SHIFT_OPTIONS.map((n) => (
              <TouchableOpacity
                key={n}
                style={[opsStyles.chip, breaksPerShift === n && { backgroundColor: primaryColor, borderColor: primaryColor }]}
                onPress={() => setBreaksPerShift(n)}
              >
                <Text style={[opsStyles.chipText, breaksPerShift === n && opsStyles.chipTextActive]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Driver Routes</Text>
      <Text style={styles.hint}>
        Decide whether drivers pick their own route or always drive the route you assign them.
      </Text>

      <View style={opsStyles.settingRow}>
        <View style={{ flex: 1 }}>
          <Text style={opsStyles.settingLabel}>Allow drivers to choose their route</Text>
          <Text style={opsStyles.settingHint}>
            {driversChooseRoute
              ? 'Drivers pick a route each time they go online.'
              : 'Drivers always drive the route you assign them.'}
          </Text>
        </View>
        <Switch
          value={driversChooseRoute}
          onValueChange={setDriversChooseRoute}
          trackColor={{ true: primaryColor }}
          thumbColor={WHITE}
          accessibilityLabel="Allow drivers to choose their route"
        />
      </View>

      <View style={opsStyles.infoBox}>
        <View style={opsStyles.infoHeader}>
          <Icon name="info-outline" size={16} color={GRAY_700} />
          <Text style={opsStyles.infoTitle}>How it works</Text>
        </View>
        <Text style={opsStyles.infoLine}>
          <Text style={opsStyles.infoStrong}>On: </Text>
          Drivers choose the route they're driving before going online. The route you assign in Users → Default route is pre-selected, and they can switch routes during a shift.
        </Text>
        <Text style={opsStyles.infoLine}>
          <Text style={opsStyles.infoStrong}>Off: </Text>
          Drivers always drive the route you assign in Users. They can't pick another one, and a driver with no assigned route can't go online. To move a driver, change their route in Users — their bus moves to it right away, even mid-shift.
        </Text>
        <Text style={opsStyles.infoLine}>
          <Text style={opsStyles.infoStrong}>Either way: </Text>
          If you have one route, drivers use it automatically. Admins can always choose any route.
        </Text>
        {!hasRoutes && (
          <Text style={[opsStyles.infoLine, { color: '#b45309' }]}>
            You don't have any routes yet, so this has no effect until you create one in the Stops tab.
          </Text>
        )}
      </View>

      <AppButton
        label={isSaving ? 'Saving…' : 'Save Operations'}
        onPress={handleSave}
        disabled={isSaving}
        style={styles.actionButton}
        color={primaryColor}
      />
    </ScrollView>
  );
}

const opsStyles = StyleSheet.create({
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: GRAY_200,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: GRAY_900,
    marginBottom: 2,
  },
  settingHint: {
    fontSize: 12,
    color: GRAY_500,
    lineHeight: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: GRAY_300,
    backgroundColor: GRAY_50,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: GRAY_700,
  },
  chipTextActive: {
    color: WHITE,
  },
  infoBox: {
    backgroundColor: GRAY_50,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: GRAY_200,
    padding: 14,
    gap: 8,
    marginBottom: 8,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: GRAY_700,
  },
  infoLine: {
    fontSize: 13,
    color: GRAY_700,
    lineHeight: 18,
  },
  infoStrong: {
    fontWeight: '700',
    color: GRAY_900,
  },
});

// ---- Main Screen ----

export default function AdminOrgSetupScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'AdminOrgSetup'>>();
  const { org: setupOrg } = useOrg();
  const { primaryColor } = useOrgTheme();
  useFirstLoginOnboarding();
  const [activeTab, setActiveTab] = useState<Tab>(
    route.params?.initialTab ?? ((setupOrg?.stops?.length ?? 0) === 0 ? 'stops' : 'profile'),
  );
  const { doneCount, total, pct, tabStatus } = useOrgSetupProgress();

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'profile', icon: 'business', label: 'Profile' },
    { key: 'auth', icon: 'lock', label: 'Auth' },
    { key: 'stops', icon: 'place', label: 'Stops' },
    { key: 'users', icon: 'people', label: 'Users' },
    { key: 'ops', icon: 'tune', label: 'Ops' },
    { key: 'billing', icon: 'credit-card', label: 'Billing' },
  ];

  return (
    <ScreenContainer>
      <View style={styles.headerRow}>
        {(navigation as any).canGoBack() ? (
          <TouchableOpacity onPress={() => (navigation as any).goBack()} style={styles.backButton}>
            <Icon name="arrow-back" size={24} color={primaryColor} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Sign out?', 'You can sign back in at any time.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => signOut(auth).catch(() => {}) },
              ])
            }
            style={styles.backButton}
          >
            <Icon name="logout" size={24} color={primaryColor} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Org Setup</Text>
          {setupOrg?.name ? (
            <Text style={styles.headerSubtitle}>{setupOrg.name}</Text>
          ) : null}
        </View>
        {doneCount < total && (
          <Text style={styles.headerProgressText}>{doneCount}/{total} set up</Text>
        )}
      </View>

      {doneCount < total && (
        <View style={styles.headerProgressBarBg}>
          <View style={[styles.headerProgressBarFill, { backgroundColor: primaryColor, width: `${pct}%` as any }]} />
        </View>
      )}

      {/* Tab Bar — wrapped in a fixed-height View so the ScrollView can't flex-expand */}
      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarContent}
          bounces={false}
        >
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBarItem, activeTab === t.key && styles.tabBarItemActive, activeTab === t.key && { borderBottomColor: primaryColor }]}
              onPress={() => setActiveTab(t.key)}
            >
              <View style={styles.tabBarIconWrap}>
                <Icon name={t.icon} size={20} color={activeTab === t.key ? primaryColor : GRAY_400} />
                {tabStatus[t.key] === 'done' && (
                  <View style={[styles.tabBarBadge, { backgroundColor: primaryColor }]}>
                    <Icon name="check" size={8} color={WHITE} />
                  </View>
                )}
                {tabStatus[t.key] === 'attention' && (
                  <View style={[styles.tabBarBadge, styles.tabBarBadgeAttention]} />
                )}
              </View>
              <Text style={[styles.tabBarLabel, activeTab === t.key && styles.tabBarLabelActive, activeTab === t.key && { color: primaryColor }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Tab Content */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="height"
      >
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'auth' && <AuthTab />}
        {activeTab === 'stops' && <StopsTab onGoToBilling={() => setActiveTab('billing')} />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'ops' && <OperationsTab />}
        {activeTab === 'billing' && <BillingTab />}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.section,
    paddingVertical: spacing.item,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_COLOR,
  },
  backButton: {
    padding: 4,
    marginRight: spacing.section,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: GRAY_900,
  },
  headerSubtitle: {
    fontSize: 12,
    color: GRAY_500,
    marginTop: 1,
  },
  headerProgressText: {
    fontSize: 12,
    fontWeight: '600',
    color: GRAY_500,
  },
  headerProgressBarBg: {
    height: 3,
    backgroundColor: GRAY_100,
  },
  headerProgressBarFill: {
    height: '100%',
  },
  tabBar: {
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_100,
    backgroundColor: WHITE,
  },
  tabBarContent: {
    flexDirection: 'row',
    // Fill the bar on wide screens (iPad) instead of bunching tabs on the left;
    // on phones the content is wider than the bar, so it still scrolls.
    flexGrow: 1,
  },
  tabBarItem: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 3,
    minWidth: 68,
  },
  tabBarItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: PRIMARY_COLOR,
  },
  tabBarIconWrap: {
    width: 20,
    height: 20,
  },
  tabBarBadge: {
    position: 'absolute',
    top: -3,
    right: -6,
    width: 11,
    height: 11,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: WHITE,
  },
  tabBarBadgeAttention: {
    backgroundColor: '#d97706',
  },
  tabBarLabel: {
    fontSize: 11,
    color: GRAY_400,
  },
  tabBarLabelActive: {
    color: PRIMARY_COLOR,
    fontWeight: '600',
  },
  pendingReviewBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#fffbeb',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: '#fcd34d',
    padding: 14,
    marginBottom: spacing.section,
  },
  pendingReviewTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 3,
  },
  pendingReviewBody: {
    fontSize: 13,
    color: '#78350f',
    lineHeight: 18,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.section,
  },
  errorText: {
    color: DANGER_COLOR,
    textAlign: 'center',
    fontSize: 14,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: PRIMARY_COLOR,
  },
  memberInfo: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: GRAY_900,
    flexShrink: 1,
  },
  memberEmail: {
    fontSize: 12,
    color: GRAY_500,
    marginTop: 1,
  },
  tabContent: {
    padding: spacing.section,
    paddingBottom: spacing.section * 3,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: GRAY_700,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: GRAY_200,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.item,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
    color: GRAY_900,
    marginBottom: 0,
    backgroundColor: WHITE,
  },
  certInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 12,
    color: GRAY_500,
    marginBottom: spacing.item,
  },
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GRAY_50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GRAY_200,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 20,
  },
  tzValue: {
    flex: 1,
    fontSize: 14,
    color: GRAY_900,
    fontWeight: '500',
  },
  tzModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    borderColor: GRAY_100,
  },
  tzModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: GRAY_900,
  },
  tzOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderColor: GRAY_100,
  },
  tzOptionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: GRAY_900,
  },
  tzOptionValue: {
    fontSize: 12,
    color: GRAY_400,
    marginTop: 1,
  },
  actionButton: {
    marginTop: spacing.item,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.item,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: GRAY_200,
    marginBottom: 8,
    backgroundColor: WHITE,
  },
  radioRowActive: {
    borderColor: PRIMARY_COLOR,
    backgroundColor: '#f0f4ff',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: GRAY_300,
    marginRight: 10,
  },
  radioSelected: {
    borderColor: PRIMARY_COLOR,
    backgroundColor: PRIMARY_COLOR,
  },
  radioLabel: {
    fontSize: 14,
    color: GRAY_900,
  },
  radioSublabel: {
    fontSize: 12,
    color: GRAY_500,
    marginTop: 2,
  },
  infoBox: {
    backgroundColor: '#f0f4ff',
    borderRadius: borderRadius.md,
    padding: spacing.item,
    marginTop: spacing.item,
  },
  infoBoxTitle: {
    fontWeight: '700',
    color: PRIMARY_COLOR,
    marginBottom: 8,
  },
  infoBoxLabel: {
    fontSize: 11,
    color: GRAY_600,
    marginTop: 6,
  },
  infoBoxValue: {
    fontSize: 13,
    color: GRAY_900,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  testPassedText: {
    fontSize: 13,
    color: PRIMARY_COLOR,
    fontWeight: '600',
    marginTop: 8,
  },
  testFailedText: {
    fontSize: 13,
    color: DANGER_COLOR,
    fontWeight: '600',
    marginTop: 8,
  },
  testWarningText: {
    fontSize: 13,
    color: GRAY_700,
    fontWeight: '600',
    marginTop: 8,
  },
  // Stops tab
  stopsContainer: {
    flex: 1,
  },
  mapCollapsed: {
    height: 120,
  },
  stopsPanel: {
    flex: 1,
    padding: 16,
  },
  stopsPanelContent: {
    paddingBottom: 80,
  },
  searchDropdownText: {
    flex: 1,
    fontSize: 13,
    color: GRAY_700,
    lineHeight: 19,
  },
  statusCard: {
    backgroundColor: WHITE,
    borderRadius: borderRadius.xl,
    padding: spacing.section + 4,
    ...cardShadow,
    marginBottom: spacing.section,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.item,
  },
  statusLabel: {
    fontSize: 12,
    color: GRAY_500,
    marginBottom: 2,
  },
  statusPlanName: {
    fontSize: 22,
    fontWeight: '700',
    color: GRAY_900,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.xl,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  statusLimitsRow: {
    flexDirection: 'row',
    gap: spacing.section,
    marginBottom: 4,
  },
  statusLimitItem: {
    fontSize: 13,
    color: GRAY_700,
  },
  trialNote: {
    fontSize: 12,
    color: GRAY_500,
    marginTop: spacing.item,
    lineHeight: 17,
  },
  planCard: {
    backgroundColor: WHITE,
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    ...cardShadow,
    marginBottom: spacing.item,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.item,
  },
  planCardActive: {
    borderWidth: 2,
    borderColor: PRIMARY_COLOR,
  },
  planInfo: {
    flex: 1,
  },
  planNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  planName: {
    fontSize: 16,
    fontWeight: '700',
    color: GRAY_900,
  },
  popularBadge: {
    backgroundColor: PRIMARY_COLOR + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  popularBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: PRIMARY_COLOR,
  },
  currentBadge: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#065f46',
  },
  planPrice: {
    fontSize: 14,
    color: PRIMARY_COLOR,
    fontWeight: '600',
    marginTop: 2,
  },
  planDesc: {
    fontSize: 12,
    color: GRAY_500,
    marginTop: 2,
  },
  learnMoreBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  learnMoreText: {
    fontSize: 13,
    fontWeight: '600',
  },
  planButton: {
    minWidth: 90,
  },
});
