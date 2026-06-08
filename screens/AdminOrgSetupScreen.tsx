// screens/AdminOrgSetupScreen.tsx
//
// Four-tab admin onboarding screen for org admins.
// Tabs: Org Profile | Auth Settings | Stop Configuration | Billing

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/StackNavigator';
import { ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, ScrollView, Share, StyleSheet, Switch, TextInput, TouchableOpacity, View } from 'react-native'
import { Text } from '../components/Text';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase/firebaseconfig';
import MapView, { Marker, Region } from 'react-native-maps';
import { doc, updateDoc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '../config';
import * as WebBrowser from 'expo-web-browser';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase/firebaseconfig';
import { useOrg, Stop, Route, WeekSchedule, DaySchedule, DEFAULT_WEEK_SCHEDULE, BreakSettings } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';
import { useFirstLoginOnboarding } from '../src/hooks/useFirstLoginOnboarding';
import { showToast } from '../src/components/Toast';
import { SHUTTLER_API_URL } from '../config';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { getPlanLimits, vehicleLimitText, routeLimitText, stopLimitText } from '../src/constants/planLimits';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import BottomSheet from '../components/BottomSheet';
import Icon from 'react-native-vector-icons/MaterialIcons';

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
    const effectiveColor = customColor.match(/^#[0-9a-fA-F]{6}$/) ? customColor : primaryColor;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'orgs', org.orgId), {
        name: name.trim(),
        logoUrl: logoUrl || null,
        primaryColor: effectiveColor,
        updatedAt: serverTimestamp(),
      });
      await refreshOrg();
      showToast('Profile updated.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [org, name, logoUrl, primaryColor, customColor, refreshOrg]);

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
        placeholderTextColor="#aaa"
        autoCapitalize="words"
      />
      <Text style={styles.hint}>Shown in the org selector for all users.</Text>

      {/* Logo */}
      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Organization Logo</Text>
      <TouchableOpacity style={profileStyles.logoBox} onPress={handlePickLogo} activeOpacity={0.8}>
        {isUploadingLogo ? (
          <ActivityIndicator color={activeColor} />
        ) : logoUrl ? (
          <Image source={{ uri: logoUrl }} style={profileStyles.logoPreview} resizeMode="contain" />
        ) : (
          <>
            <Icon name="add-photo-alternate" size={32} color="#9ca3af" />
            <Text style={profileStyles.logoHint}>Tap to upload logo</Text>
          </>
        )}
      </TouchableOpacity>
      {logoUrl ? (
        <TouchableOpacity onPress={() => setLogoUrl('')} style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: '#e53935' }}>Remove logo</Text>
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
          placeholderTextColor="#aaa"
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
    borderColor: '#e5e7eb',
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafafa',
    marginBottom: 8,
  },
  logoPreview: { width: '100%', height: '100%', borderRadius: 10 },
  logoHint: { fontSize: 13, color: '#9ca3af', marginTop: 6 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  swatch: { width: 36, height: 36, borderRadius: 18 },
  swatchSelected: { borderWidth: 3, borderColor: '#111' },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  hexPreview: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' },
});

// ---- Auth Settings Tab ----

type AuthMethod = 'saml' | 'email' | 'phone';

function AuthTab() {
  const { org, refreshOrg } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [authMethod, setAuthMethod] = useState<AuthMethod>(
    (org?.authMethod as AuthMethod) ?? 'email',
  );
  const [domains, setDomains] = useState((org?.allowedEmailDomains ?? []).join(', '));
  const [idpEntityId, setIdpEntityId] = useState('');
  const [idpSsoUrl, setIdpSsoUrl] = useState('');
  const [idpCert, setIdpCert] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedSpInfo, setSavedSpInfo] = useState<{ spEntityId?: string; acsUrl?: string } | null>(
    null,
  );

  const handleSave = useCallback(async () => {
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
      setSavedSpInfo({ spEntityId: data.spEntityId, acsUrl: data.acsUrl });
      showToast('Auth configuration updated.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [org, authMethod, domains, idpEntityId, idpSsoUrl, idpCert, refreshOrg]);

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
          <Text style={styles.radioLabel}>
            {m === 'email'
              ? 'Email / Password'
              : m === 'phone'
              ? 'Phone Number (SMS) — K-12 parents'
              : 'SAML SSO (IT-managed)'}
          </Text>
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
        placeholderTextColor="#aaa"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Text style={styles.hint}>Comma-separated. Leave blank to allow any email domain.</Text>

      {authMethod === 'saml' && (
        <>
          <Text style={styles.sectionLabel}>IdP Entity ID</Text>
          <TextInput style={styles.input} value={idpEntityId} onChangeText={setIdpEntityId}
            placeholder="https://idp.example.com/saml" placeholderTextColor="#aaa" autoCapitalize="none" />

          <Text style={styles.sectionLabel}>IdP SSO URL</Text>
          <TextInput style={styles.input} value={idpSsoUrl} onChangeText={setIdpSsoUrl}
            placeholder="https://idp.example.com/saml/sso" placeholderTextColor="#aaa" autoCapitalize="none" keyboardType="url" />

          <Text style={styles.sectionLabel}>IdP Signing Certificate (PEM or base64)</Text>
          <TextInput
            style={[styles.input, styles.certInput]}
            value={idpCert}
            onChangeText={setIdpCert}
            placeholder="Paste the IdP certificate here"
            placeholderTextColor="#aaa"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}

      <AppButton
        label={isSaving ? 'Saving…' : 'Save Auth Settings'}
        onPress={handleSave}
        disabled={isSaving}
        style={styles.actionButton}
      />

      {savedSpInfo?.acsUrl && (
        <View style={styles.infoBox}>
          <Text style={[styles.infoBoxTitle, { color: primaryColor }]}>Give these to your IT team:</Text>
          <Text style={styles.infoBoxLabel}>ACS URL</Text>
          <Text style={styles.infoBoxValue} selectable>{savedSpInfo.acsUrl}</Text>
          <Text style={styles.infoBoxLabel}>SP Entity ID</Text>
          <Text style={styles.infoBoxValue} selectable>{savedSpInfo.spEntityId}</Text>
        </View>
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
        <Icon name="schedule" size={14} color="#6b7280" />
        <Text style={hoursStyles.label}>Hours of Operation</Text>
      </View>

      {WEEK_DAYS.map(({ key, label }) => {
        const day = schedule[key];
        return (
          <View key={key} style={hoursStyles.dayRow}>
            <Switch
              value={day.isOpen}
              onValueChange={(v) => update(key, { isOpen: v })}
              trackColor={{ false: '#e5e7eb', true: primaryColor }}
              thumbColor="#fff"
            />
            <Text style={[hoursStyles.dayLabel, !day.isOpen && { color: '#bbb' }]}>{label}</Text>
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
  label: { flex: 1, fontSize: 12, fontWeight: '600', color: '#6b7280' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  dayLabel: { width: 32, fontSize: 13, fontWeight: '600', color: '#374151' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  dash: { fontSize: 14, color: '#6b7280' },
  timeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 6,
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  timeBtnText: { fontSize: 13, fontWeight: '600', color: '#111' },
  closedLabel: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic' },
  pickerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  pickerCancel: { fontSize: 16, color: '#6b7280' },
  pickerDone: { fontSize: 16, fontWeight: '700', color: PRIMARY_COLOR },
});

// ---- Stop tab extra styles ----
const stopStyles = StyleSheet.create({
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    marginBottom: 6,
  },
  manualToggleText: {
    flex: 1,
    fontSize: 12,
    color: '#6b7280',
  },
  manualCoordsBox: {
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  applyBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});

const newStopStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    gap: 10,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  stepHeaderDisabled: {
    opacity: 0.4,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepBadgeInactive: {
    backgroundColor: '#e5e7eb',
  },
  stepNum: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
  },
  stepHint: {
    fontSize: 11,
    color: '#9ca3af',
    marginLeft: 2,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111',
    padding: 0,
  },
  dropdown: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
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
    borderBottomColor: '#f3f4f6',
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  locationChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  tapHint: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    marginVertical: 2,
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
    color: '#9ca3af',
  },
  divider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginVertical: 4,
  },
  inputDisabled: {
    backgroundColor: '#f9fafb',
    color: '#9ca3af',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 4,
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
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

function StopsTab({ onGoToBilling }: { onGoToBilling: () => void }) {
  const { org, refreshOrg } = useOrg();
  const { primaryColor } = useOrgTheme();
  const navigation = useNavigation<any>();
  const planLimits = getPlanLimits(org?.subscriptionPlan, org?.subscriptionStatus);
  const mapRef = useRef<MapView>(null);
  const [stops, setStops] = useState<Stop[]>(org?.stops ?? []);
  const [routes, _setRoutes] = useState<Route[]>(org?.routes ?? []);
  // Track whether the admin has unsaved route changes so a background Firestore
  // snapshot (e.g. Stripe webhook updating subscriptionStatus) doesn't wipe them.
  const routesDirtyRef = useRef(false);
  const setRoutes = useCallback(
    (updater: Route[] | ((prev: Route[]) => Route[])) => {
      routesDirtyRef.current = true;
      _setRoutes(updater as any);
    },
    [],
  );
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

  // Default to the device's IANA timezone if the org hasn't saved one yet.
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [timezone, setTimezone] = useState(org?.timezone ?? deviceTimezone);
  const [showTzPicker, setShowTzPicker] = useState(false);
  useEffect(() => { setTimezone(org?.timezone ?? deviceTimezone); }, [org?.timezone]);

  // Keep local state in sync when org updates via real-time Firestore listener.
  // Routes are only synced when the admin has no unsaved changes — a background
  // snapshot (e.g. Stripe webhook) must not overwrite in-progress edits.
  useEffect(() => { setStops(org?.stops ?? []); }, [org?.stops]);
  useEffect(() => {
    if (!routesDirtyRef.current) _setRoutes(org?.routes ?? []);
  }, [org?.routes]);

  const hasOrgCenter = org?.mapCenter && (org.mapCenter.latitude !== 0 || org.mapCenter.longitude !== 0);
  const [mapCenter, setMapCenter] = useState(
    hasOrgCenter ? org!.mapCenter : { latitude: 39.5, longitude: -98.35 },
  );
  const [pendingName, setPendingName] = useState('');
  const [pendingCoords, setPendingCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Location search state
  type PlaceSuggestion = { placeId: string; description: string };
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Manual coordinate entry
  const [showManualCoords, setShowManualCoords] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');

  const searchPlaces = useCallback(async (input: string) => {
    if (!input.trim() || input.length < 3) { setSearchResults([]); return; }
    setIsSearching(true);
    try {
      const bias = `${mapCenter.latitude},${mapCenter.longitude}`;
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&location=${bias}&radius=50000&key=${GOOGLE_MAPS_API_KEY}`;
      if (__DEV__) console.log('[Places] autocomplete url:', url);
      const res = await fetch(url);
      const json = await res.json();
      if (__DEV__) console.log('[Places] status:', json.status, json.error_message ?? '');
      if (json.status === 'OK') {
        setSearchResults(
          (json.predictions ?? []).slice(0, 5).map((p: any) => ({
            placeId: p.place_id,
            description: p.description,
          })),
        );
      } else {
        // Non-OK status — surface a hint in dev so the admin can diagnose
        if (__DEV__ && json.status !== 'ZERO_RESULTS') {
          Alert.alert(
            `Places API: ${json.status}`,
            json.error_message ?? 'Check that the Places API is enabled for this key and that billing is active.',
          );
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

  const handleSelectPlace = useCallback(async (suggestion: PlaceSuggestion) => {
    setSearchResults([]);
    setSearchQuery('');
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${suggestion.placeId}&fields=geometry,name&key=${GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.status === 'OK') {
        const loc = json.result.geometry.location;
        const coords = { latitude: loc.lat, longitude: loc.lng };
        setPendingCoords(coords);
        // Pre-fill name from the first part of the description (before the first comma)
        const autoName = suggestion.description.split(',')[0].trim();
        if (!pendingName) setPendingName(autoName);
        // Pan map to the pin
        mapRef.current?.animateToRegion(
          { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 },
          500,
        );
      }
    } catch {}
  }, [pendingName]);

  const handleApplyManualCoords = useCallback(() => {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      showToast('Latitude must be −90 to 90, longitude −180 to 180.', 'error');
      return;
    }
    const coords = { latitude: lat, longitude: lon };
    setPendingCoords(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
    setShowManualCoords(false);
    setManualLat('');
    setManualLon('');
  }, [manualLat, manualLon]);

  // Route editing state
  const [newRouteName, setNewRouteName] = useState('');
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);

  const handleMapPress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPendingCoords({ latitude, longitude });
    setSearchResults([]);
  }, []);

  const handleAddStop = useCallback(() => {
    if (!pendingName.trim()) {
      showToast('Enter a stop name.', 'error');
      return;
    }
    if (!pendingCoords) {
      showToast('Tap the map or enter latitude and longitude.', 'error');
      return;
    }
    if (stops.length >= planLimits.maxStops) {
      Alert.alert(
        'Stop limit reached',
        `Your ${planLimits.label} plan includes ${stopLimitText(planLimits)}. Upgrade your plan to add more stops.`,
        [
          { text: 'Manage Billing', onPress: onGoToBilling },
          { text: 'OK', style: 'cancel' },
        ],
      );
      return;
    }
    const newStop: Stop = {
      id: `stop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: pendingName.trim(),
      latitude: pendingCoords.latitude,
      longitude: pendingCoords.longitude,
    };
    setStops((prev) => [...prev, newStop]);
    setPendingName('');
    setPendingCoords(null);
    setSearchQuery('');
  }, [pendingCoords, pendingName, stops.length, planLimits]);

  const handleDeleteStop = useCallback((id: string) => {
    Alert.alert('Remove stop', 'Remove this stop?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setStops((prev) => prev.filter((s) => s.id !== id));
          // Remove from any routes that reference it
          setRoutes((prev) =>
            prev.map((r) => ({ ...r, stopIds: r.stopIds.filter((sid) => sid !== id) })),
          );
        },
      },
    ]);
  }, []);

  const handleSaveAll = useCallback(async () => {
    if (!org) return;
    const isFirstSave = !(org.stops?.length);
    setIsSaving(true);
    try {
      const bounds = calcBoundsFromStops(stops);
      await updateDoc(doc(db, 'orgs', org.orgId), {
        stops,
        routes,
        timezone,
        mapCenter: bounds?.mapCenter ?? mapCenter,
        ...(bounds ? { mapBoundingBox: bounds.mapBoundingBox } : {}),
        updatedAt: serverTimestamp(),
      });
      routesDirtyRef.current = false;
      await refreshOrg();
      if (isFirstSave && stops.length > 0) {
        navigation.navigate('DriverHome');
      } else {
        showToast('Stops, routes, and map bounds updated.', 'success');
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [org, stops, routes, timezone, mapCenter, refreshOrg, navigation]);

  // Route helpers
  const handleAddRoute = useCallback(() => {
    if (!newRouteName.trim()) return;
    if (routes.length >= planLimits.maxRoutes) {
      Alert.alert(
        'Route limit reached',
        `Your ${planLimits.label} plan includes ${routeLimitText(planLimits)}. Upgrade your plan to add more routes.`,
        [
          { text: 'Manage Billing', onPress: onGoToBilling },
          { text: 'OK', style: 'cancel' },
        ],
      );
      return;
    }
    setRoutes((prev) => [
      ...prev,
      { id: `route_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name: newRouteName.trim(), stopIds: [] },
    ]);
    setNewRouteName('');
    setShowRouteForm(false);
  }, [newRouteName, routes.length, planLimits]);

  const handleDeleteRoute = useCallback((routeId: string) => {
    Alert.alert('Delete route', 'Remove this route?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => setRoutes((prev) => prev.filter((r) => r.id !== routeId)),
      },
    ]);
  }, []);

  const handleToggleStopInRoute = useCallback((routeId: string, stopId: string) => {
    setRoutes((prev) =>
      prev.map((r) => {
        if (r.id !== routeId) return r;
        if (r.stopIds.includes(stopId)) {
          return { ...r, stopIds: r.stopIds.filter((id) => id !== stopId) };
        }
        return { ...r, stopIds: [...r.stopIds, stopId] };
      }),
    );
  }, []);

  const handleMoveStop = useCallback(
    (routeId: string, stopId: string, direction: 'up' | 'down') => {
      setRoutes((prev) =>
        prev.map((r) => {
          if (r.id !== routeId) return r;
          const idx = r.stopIds.indexOf(stopId);
          if (idx < 0) return r;
          const newIds = [...r.stopIds];
          if (direction === 'up' && idx > 0) {
            [newIds[idx - 1], newIds[idx]] = [newIds[idx], newIds[idx - 1]];
          } else if (direction === 'down' && idx < newIds.length - 1) {
            [newIds[idx + 1], newIds[idx]] = [newIds[idx], newIds[idx + 1]];
          }
          return { ...r, stopIds: newIds };
        }),
      );
    },
    [],
  );

  const handleUpdateSchedule = useCallback(
    (routeId: string, schedule: WeekSchedule) => {
      setRoutes((prev) =>
        prev.map((r) => (r.id !== routeId ? r : { ...r, schedule })),
      );
    },
    [],
  );

  const initialRegion: Region = {
    latitude: mapCenter.latitude,
    longitude: mapCenter.longitude,
    latitudeDelta: hasOrgCenter ? 0.04 : 30,
    longitudeDelta: hasOrgCenter ? 0.04 : 55,
  };

  return (
    <View style={styles.stopsContainer}>
      <MapView
        ref={mapRef}
        style={[styles.map, mapCollapsed && styles.mapCollapsed]}
        initialRegion={initialRegion}
        onPress={handleMapPress}
        onRegionChangeComplete={(r) =>
          setMapCenter({ latitude: r.latitude, longitude: r.longitude })
        }
      >
        {stops.map((stop) => (
          <Marker
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            title={stop.name}
            pinColor={primaryColor}
            onCalloutPress={() => handleDeleteStop(stop.id)}
          />
        ))}
        {pendingCoords && (
          <Marker coordinate={pendingCoords} pinColor="orange" title="New stop" />
        )}
      </MapView>

      <ScrollView
        style={styles.stopsPanel}
        contentContainerStyle={styles.stopsPanelContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* --- Stops section --- */}
        <View style={styles.routesHeader}>
          <Text style={styles.sectionLabel}>Stops</Text>
          <Text style={styles.planLimitBadge}>
            {stops.length}/{planLimits.maxStops === Infinity ? '∞' : planLimits.maxStops}
          </Text>
        </View>

        {/* Unified add-stop card */}
        <View style={newStopStyles.card}>

          {/* ── Step 1: Find a location ── */}
          <View style={newStopStyles.stepHeader}>
            <View style={[newStopStyles.stepBadge, pendingCoords ? { backgroundColor: primaryColor } : newStopStyles.stepBadgeInactive]}>
              {pendingCoords
                ? <Icon name="check" size={12} color="#fff" />
                : <Text style={newStopStyles.stepNum}>1</Text>}
            </View>
            <Text style={newStopStyles.stepLabel}>Find a location</Text>
            <Text style={newStopStyles.stepHint}>search or tap the map</Text>
          </View>

          {/* Search bar */}
          <View style={newStopStyles.searchRow}>
            <Icon name="search" size={18} color="#9ca3af" style={{ marginRight: 6 }} />
            <TextInput
              style={newStopStyles.searchInput}
              placeholder="Search address or place…"
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholderTextColor="#aaa"
              returnKeyType="search"
              autoCorrect={false}
            />
            {isSearching && <ActivityIndicator size="small" color={primaryColor} style={{ marginLeft: 6 }} />}
            {searchQuery.length > 0 && !isSearching && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Icon name="close" size={16} color="#9ca3af" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            )}
          </View>

          {/* Autocomplete dropdown */}
          {searchResults.length > 0 && (
            <View style={newStopStyles.dropdown}>
              {searchResults.map((s) => (
                <TouchableOpacity
                  key={s.placeId}
                  style={newStopStyles.dropdownItem}
                  onPress={() => handleSelectPlace(s)}
                >
                  <Icon name="place" size={14} color="#9ca3af" style={{ marginRight: 8, marginTop: 1 }} />
                  <Text style={styles.searchDropdownText} numberOfLines={2}>{s.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Selected location chip OR tap hint */}
          {pendingCoords ? (
            <View style={[newStopStyles.locationChip, { borderColor: `${primaryColor}40`, backgroundColor: `${primaryColor}0d` }]}>
              <Icon name="place" size={15} color={primaryColor} />
              <Text style={[newStopStyles.locationChipText, { color: primaryColor }]} numberOfLines={1}>
                {pendingCoords.latitude.toFixed(5)}, {pendingCoords.longitude.toFixed(5)}
              </Text>
              <TouchableOpacity onPress={() => setPendingCoords(null)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Icon name="close" size={14} color={primaryColor} />
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={newStopStyles.tapHint}>— or tap directly on the map above —</Text>
          )}

          {/* Manual coordinate entry — collapsible */}
          <TouchableOpacity
            style={newStopStyles.manualToggle}
            onPress={() => setShowManualCoords((v) => !v)}
          >
            <Icon name="my-location" size={13} color="#9ca3af" />
            <Text style={newStopStyles.manualToggleText}>Enter coordinates manually</Text>
            <Icon name={showManualCoords ? 'expand-less' : 'expand-more'} size={16} color="#9ca3af" />
          </TouchableOpacity>

          {showManualCoords && (
            <View style={stopStyles.manualCoordsBox}>
              <View style={stopStyles.manualCoordsRow}>
                <TextInput
                  style={[styles.input, stopStyles.coordInput]}
                  placeholder="Latitude (e.g. 38.9071)"
                  value={manualLat}
                  onChangeText={setManualLat}
                  keyboardType="numbers-and-punctuation"
                  placeholderTextColor="#aaa"
                  returnKeyType="next"
                />
                <TextInput
                  style={[styles.input, stopStyles.coordInput]}
                  placeholder="Longitude (e.g. −77.0369)"
                  value={manualLon}
                  onChangeText={setManualLon}
                  keyboardType="numbers-and-punctuation"
                  placeholderTextColor="#aaa"
                  returnKeyType="done"
                  onSubmitEditing={handleApplyManualCoords}
                />
              </View>
              <TouchableOpacity
                style={[stopStyles.applyBtn, { backgroundColor: primaryColor }, (!manualLat || !manualLon) && { opacity: 0.4 }]}
                onPress={handleApplyManualCoords}
                disabled={!manualLat || !manualLon}
              >
                <Text style={stopStyles.applyBtnText}>Use These Coordinates</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Divider ── */}
          <View style={newStopStyles.divider} />

          {/* ── Step 2: Name this stop ── */}
          <View style={[newStopStyles.stepHeader, !pendingCoords && newStopStyles.stepHeaderDisabled]}>
            <View style={[newStopStyles.stepBadge, pendingName.trim() && pendingCoords ? { backgroundColor: primaryColor } : newStopStyles.stepBadgeInactive]}>
              {pendingName.trim() && pendingCoords
                ? <Icon name="check" size={12} color="#fff" />
                : <Text style={newStopStyles.stepNum}>2</Text>}
            </View>
            <Text style={newStopStyles.stepLabel}>Name this stop</Text>
          </View>

          <TextInput
            style={[styles.input, !pendingCoords && newStopStyles.inputDisabled]}
            placeholder={pendingCoords ? 'e.g. Main Entrance, Library Loop' : 'Pick a location first'}
            value={pendingName}
            onChangeText={setPendingName}
            placeholderTextColor={pendingCoords ? '#aaa' : '#d1d5db'}
            editable={!!pendingCoords}
          />

          <TouchableOpacity
            style={[newStopStyles.addBtn, { backgroundColor: primaryColor }, (!pendingName.trim() || !pendingCoords) && newStopStyles.addBtnDisabled]}
            onPress={handleAddStop}
            disabled={!pendingName.trim() || !pendingCoords}
          >
            <Icon name="add-location-alt" size={20} color="#fff" />
            <Text style={newStopStyles.addBtnText}>Add Stop</Text>
          </TouchableOpacity>
        </View>

        {stops.map((stop) => (
          <View key={stop.id} style={styles.stopRow}>
            <Icon name="place" size={18} color={primaryColor} />
            <Text style={styles.stopName} numberOfLines={1}>{stop.name}</Text>
            <TouchableOpacity onPress={() => handleDeleteStop(stop.id)}>
              <Icon name="close" size={18} color="#e53935" />
            </TouchableOpacity>
          </View>
        ))}
        {stops.length === 0 && <Text style={styles.hint}>No stops yet. Fill the form above and tap Add Stop.</Text>}

        {/* --- Timezone --- */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Timezone</Text>
        <Text style={styles.hint}>Route schedules are evaluated in this timezone.</Text>
        <TouchableOpacity
          style={styles.tzRow}
          onPress={() => setShowTzPicker(true)}
          activeOpacity={0.7}
        >
          <Icon name="schedule" size={18} color="#6b7280" />
          <Text style={styles.tzValue}>{timezone}</Text>
          <Icon name="expand-more" size={20} color="#6b7280" />
        </TouchableOpacity>

        <BottomSheet
          visible={showTzPicker}
          onClose={() => setShowTzPicker(false)}
          sheetStyle={{ paddingHorizontal: 0, paddingBottom: 32, maxHeight: '75%' }}
        >
          <View style={styles.tzModalHeader}>
            <Text style={styles.tzModalTitle}>Select Timezone</Text>
            <TouchableOpacity onPress={() => setShowTzPicker(false)}>
              <Icon name="close" size={22} color="#374151" />
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

        {/* --- Routes section --- */}
        <View style={styles.routesHeader}>
          <Text style={styles.sectionLabel}>Routes</Text>
          <Text style={styles.planLimitBadge}>
            {routes.length}/{planLimits.maxRoutes === Infinity ? '∞' : planLimits.maxRoutes}
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (routes.length >= planLimits.maxRoutes) {
                Alert.alert(
                  'Route limit reached',
                  `Your ${planLimits.label} plan includes ${routeLimitText(planLimits)}. Upgrade your plan to add more routes.`,
                  [
                    { text: 'Manage Billing', onPress: onGoToBilling },
                    { text: 'OK', style: 'cancel' },
                  ],
                );
                return;
              }
              setShowRouteForm(true);
            }}
          >
            <Icon
              name="add-circle"
              size={24}
              color={routes.length >= planLimits.maxRoutes ? '#ccc' : primaryColor}
            />
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          A route is an ordered sequence of stops a bus follows. Assign stops to each route below.
        </Text>

        {showRouteForm && (
          <View style={styles.addStopRow}>
            <TextInput
              style={[styles.input, styles.stopNameInput]}
              placeholder="Route name (e.g. Morning Loop)"
              value={newRouteName}
              onChangeText={setNewRouteName}
              placeholderTextColor="#aaa"
            />
            <TouchableOpacity style={[styles.addStopBtn, { backgroundColor: primaryColor }]} onPress={handleAddRoute}>
              <Icon name="check" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {routes.map((route) => {
          const isExpanded = editingRouteId === route.id;
          return (
            <View key={route.id} style={styles.routeCard}>
              <TouchableOpacity
                style={styles.routeCardHeader}
                onPress={() => setEditingRouteId(isExpanded ? null : route.id)}
              >
                <Icon name="directions-bus" size={18} color={primaryColor} />
                <Text style={styles.routeName}>{route.name}</Text>
                <Text style={styles.routeStopCount}>{route.stopIds.length} stop{route.stopIds.length !== 1 ? 's' : ''}</Text>
                <Icon name={isExpanded ? 'expand-less' : 'expand-more'} size={20} color="#888" />
                <TouchableOpacity onPress={() => handleDeleteRoute(route.id)} style={styles.routeDeleteBtn}>
                  <Icon name="delete-outline" size={18} color="#e53935" />
                </TouchableOpacity>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.routeEditor}>
                  <Text style={styles.routeEditorLabel}>Stop order (tap to add/remove, arrows to reorder):</Text>

                  {/* Stops in this route, in order */}
                  {route.stopIds.map((stopId, idx) => {
                    const stop = stops.find((s) => s.id === stopId);
                    if (!stop) return null;
                    return (
                      <View key={stopId} style={styles.routeStopRow}>
                        <Text style={styles.routeStopIndex}>{idx + 1}.</Text>
                        <Text style={styles.routeStopName}>{stop.name}</Text>
                        <TouchableOpacity onPress={() => handleMoveStop(route.id, stopId, 'up')} disabled={idx === 0}>
                          <Icon name="arrow-upward" size={16} color={idx === 0 ? '#ccc' : '#555'} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleMoveStop(route.id, stopId, 'down')} disabled={idx === route.stopIds.length - 1}>
                          <Icon name="arrow-downward" size={16} color={idx === route.stopIds.length - 1 ? '#ccc' : '#555'} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleToggleStopInRoute(route.id, stopId)}>
                          <Icon name="remove-circle-outline" size={18} color="#e53935" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                  {/* Stops not yet in this route */}
                  {stops.filter((s) => !route.stopIds.includes(s.id)).map((stop) => (
                    <TouchableOpacity
                      key={stop.id}
                      style={styles.routeStopAvailable}
                      onPress={() => handleToggleStopInRoute(route.id, stop.id)}
                    >
                      <Icon name="add-circle-outline" size={18} color={primaryColor} />
                      <Text style={styles.routeStopName}>{stop.name}</Text>
                    </TouchableOpacity>
                  ))}

                  {stops.length === 0 && (
                    <Text style={styles.hint}>Add stops above first.</Text>
                  )}

                  {/* Hours of operation */}
                  <ScheduleEditor
                    route={route}
                    onChange={(schedule) => handleUpdateSchedule(route.id, schedule)}
                  />
                </View>
              )}
            </View>
          );
        })}

        {routes.length === 0 && !showRouteForm && (
          <Text style={styles.hint}>No routes yet. Tap + to create one.</Text>
        )}

        <AppButton
          label={isSaving ? 'Saving…' : 'Save Stops & Routes'}
          onPress={handleSaveAll}
          disabled={isSaving}
          style={styles.actionButton}
        />
      </ScrollView>
    </View>
  );
}

// ---- Users Tab ----

type OrgMember = {
  uid: string;
  email: string;
  displayName?: string;
  role: 'student' | 'driver' | 'admin' | 'parent';
  defaultRouteId?: string | null;
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
  admin: '#16a34a',
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
  const [rolePickerTarget, setRolePickerTarget] = useState<OrgMember | null>(null);
  const [routePickerTarget, setRoutePickerTarget] = useState<OrgMember | null>(null);
  const [search, setSearch] = useState('');

  const orgRoutes = org?.routes ?? [];

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

      // Load defaultRouteId for each driver/admin from Firestore
      const drivers = data.filter((m) => m.role === 'driver' || m.role === 'admin');
      const defaults: Record<string, string | null> = {};
      await Promise.all(
        drivers.map(async (m) => {
          try {
            const snap = await getDoc(doc(db, 'orgs', org.orgId, 'users', m.uid));
            defaults[m.uid] = snap.exists() ? (snap.data()?.defaultRouteId ?? null) : null;
          } catch {
            defaults[m.uid] = null;
          }
        }),
      );
      setDriverDefaults(defaults);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load members.');
    } finally {
      setIsLoading(false);
    }
  }, [org]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const handleAssignRoute = useCallback(
    (member: OrgMember) => {
      if (!org || orgRoutes.length === 0) return;
      setRoutePickerTarget(member);
    },
    [org, orgRoutes],
  );

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

  const handleChangeRole = useCallback(
    (member: OrgMember) => {
      if (!org) return;
      if (member.uid === currentUser?.uid) {
        showToast('Ask another admin to change your role.', 'error');
        return;
      }
      if (org.ownerUid && member.uid === org.ownerUid) {
        showToast('The org owner\'s role cannot be changed.', 'error');
        return;
      }
      setRolePickerTarget(member);
    },
    [org, currentUser?.uid],
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
        `Remove ${member.displayName ?? member.email} from ${org.name}? They will lose access immediately.`,
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
  const filteredMembers = searchQuery
    ? members.filter(
        (m) =>
          (m.displayName ?? '').toLowerCase().includes(searchQuery) ||
          m.email.toLowerCase().includes(searchQuery),
      )
    : members;

  const handleShareInvite = () => {
    Share.share({
      message: `Join ${org?.name ?? 'our shuttle'} on Shuttler!\n\nOpen the Shuttler app, search for "${org?.name ?? orgSlug}", and sign up. Organization ID: ${orgSlug}`,
    }).catch(() => {});
  };

  return (
    <>
    <ScrollView contentContainerStyle={styles.tabContent}>
      {/* Invite card */}
      <TouchableOpacity style={[usersStyles.inviteCard, { backgroundColor: `${primaryColor}0d`, borderColor: `${primaryColor}30` }]} onPress={handleShareInvite} activeOpacity={0.8}>
        <View style={[usersStyles.inviteIconWrap, { backgroundColor: `${primaryColor}18` }]}>
          <Icon name="share" size={20} color={primaryColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={usersStyles.inviteTitle}>Invite people to join</Text>
          <Text style={usersStyles.inviteBody} numberOfLines={1}>
            Org ID: <Text style={[usersStyles.inviteSlug, { color: primaryColor }]}>{orgSlug}</Text>
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color="#d1d5db" />
      </TouchableOpacity>

      <Text style={styles.hint}>
        Tap a member's role badge to change it. Tap the route badge on drivers to assign a default route.
      </Text>

      {members.length === 0 && (
        <Text style={styles.hint}>No members yet — share your org ID above so people can find you.</Text>
      )}

      {members.length > 0 && (
        <View style={[newStopStyles.searchRow, { marginBottom: 4 }]}>
          <Icon name="search" size={18} color="#9ca3af" style={{ marginRight: 8 }} />
          <TextInput
            style={newStopStyles.searchInput}
            placeholder="Search by name or email…"
            placeholderTextColor="#9ca3af"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
      )}

      {filteredMembers.length === 0 && search.trim() !== '' && (
        <Text style={styles.hint}>No members match "{search.trim()}".</Text>
      )}

      {filteredMembers.map((member) => {
        const isDriver = member.role === 'driver' || member.role === 'admin';
        const assignedRouteId = driverDefaults[member.uid] ?? null;
        const assignedRoute = assignedRouteId ? orgRoutes.find((r) => r.id === assignedRouteId) : null;
        const isSelf = member.uid === currentUser?.uid;
        const isOwner = !!(org?.ownerUid && member.uid === org.ownerUid);
        return (
          <View key={member.uid} style={styles.memberRow}>
            <View style={[styles.memberAvatar, isSelf && usersStyles.selfAvatar, isSelf && { backgroundColor: `${primaryColor}25` }]}>
              <Text style={[styles.memberAvatarText, { color: primaryColor }]}>
                {(member.displayName ?? member.email).charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.memberInfo}>
              <View style={usersStyles.nameRow}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {member.displayName ?? '—'}
                </Text>
                {isOwner && (
                  <View style={usersStyles.ownerBadge}>
                    <Text style={usersStyles.ownerBadgeText}>Owner</Text>
                  </View>
                )}
                {isSelf && !isOwner && (
                  <View style={usersStyles.youBadge}>
                    <Text style={usersStyles.youBadgeText}>You</Text>
                  </View>
                )}
              </View>
              <Text style={styles.memberEmail} numberOfLines={1}>{member.email}</Text>
            </View>
            {isDriver && orgRoutes.length > 0 && (
              <TouchableOpacity
                style={styles.routeBadge}
                onPress={() => handleAssignRoute(member)}
                disabled={savingRoute === member.uid}
              >
                {savingRoute === member.uid ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : (
                  <Text style={styles.routeBadgeText} numberOfLines={1}>
                    {assignedRoute ? assignedRoute.name : 'Route…'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.roleBadge, { backgroundColor: `${member.role === 'admin' ? primaryColor : ROLE_COLORS[member.role]}20` }, (isSelf || isOwner) && usersStyles.roleBadgeSelf]}
              onPress={() => handleChangeRole(member)}
              disabled={isOwner}
            >
              <Text style={[styles.roleBadgeText, { color: member.role === 'admin' ? primaryColor : ROLE_COLORS[member.role] }]}>
                {ROLE_LABELS[member.role]}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleRemoveUser(member)}
              style={[styles.removeUserBtn, (isSelf || isOwner) && usersStyles.removeDisabled]}
              disabled={isOwner}
            >
              <Icon name="person-remove" size={18} color={(isSelf || isOwner) ? '#d1d5db' : '#e53935'} />
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>

    {/* Role Picker Sheet */}
    <BottomSheet visible={rolePickerTarget !== null} onClose={() => setRolePickerTarget(null)}>
      <View style={pickerSheetStyles.handle} />
      <Text style={pickerSheetStyles.title} numberOfLines={1}>
        {rolePickerTarget?.displayName ?? rolePickerTarget?.email}
      </Text>
      <Text style={pickerSheetStyles.subtitle}>Select a role</Text>
      {(['student', 'driver', 'parent', 'admin'] as const).map((role) => {
        const color = role === 'admin' ? primaryColor : ROLE_COLORS[role];
        const isCurrent = rolePickerTarget?.role === role;
        return (
          <TouchableOpacity
            key={role}
            style={pickerSheetStyles.option}
            onPress={() => {
              applyRole(rolePickerTarget!.uid, role);
              setRolePickerTarget(null);
            }}
          >
            <View style={[pickerSheetStyles.roleCircle, { backgroundColor: `${color}18` }]}>
              <Text style={[pickerSheetStyles.roleCircleText, { color }]}>
                {ROLE_LABELS[role].charAt(0)}
              </Text>
            </View>
            <Text style={[pickerSheetStyles.optionLabel, isCurrent && pickerSheetStyles.optionLabelActive]}>
              {ROLE_LABELS[role]}
            </Text>
            {isCurrent && <Icon name="check" size={18} color={primaryColor} />}
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity style={pickerSheetStyles.cancelBtn} onPress={() => setRolePickerTarget(null)}>
        <Text style={pickerSheetStyles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </BottomSheet>

    {/* Route Picker Sheet */}
    <BottomSheet visible={routePickerTarget !== null} onClose={() => setRoutePickerTarget(null)}>
      <View style={pickerSheetStyles.handle} />
      <Text style={pickerSheetStyles.title} numberOfLines={1}>
        {routePickerTarget?.displayName ?? routePickerTarget?.email}
      </Text>
      <Text style={pickerSheetStyles.subtitle}>Assign a default route</Text>
      <TouchableOpacity
        style={pickerSheetStyles.option}
        onPress={() => {
          saveDefaultRoute(routePickerTarget!.uid, null);
          setRoutePickerTarget(null);
        }}
      >
        <View style={[pickerSheetStyles.roleCircle, { backgroundColor: '#f3f4f6' }]}>
          <Icon name="remove" size={14} color="#9ca3af" />
        </View>
        <Text style={[pickerSheetStyles.optionLabel, !driverDefaults[routePickerTarget?.uid ?? ''] && pickerSheetStyles.optionLabelActive]}>
          No default route
        </Text>
        {!driverDefaults[routePickerTarget?.uid ?? ''] && <Icon name="check" size={18} color={primaryColor} />}
      </TouchableOpacity>
      {orgRoutes.map((route) => {
        const isAssigned = driverDefaults[routePickerTarget?.uid ?? ''] === route.id;
        return (
          <TouchableOpacity
            key={route.id}
            style={pickerSheetStyles.option}
            onPress={() => {
              saveDefaultRoute(routePickerTarget!.uid, route.id);
              setRoutePickerTarget(null);
            }}
          >
            <View style={[pickerSheetStyles.roleCircle, { backgroundColor: `${primaryColor}15` }]}>
              <Icon name="directions-bus" size={14} color={primaryColor} />
            </View>
            <Text style={[pickerSheetStyles.optionLabel, isAssigned && pickerSheetStyles.optionLabelActive]} numberOfLines={1}>
              {route.name}
            </Text>
            {isAssigned && <Icon name="check" size={18} color={primaryColor} />}
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity style={pickerSheetStyles.cancelBtn} onPress={() => setRoutePickerTarget(null)}>
        <Text style={pickerSheetStyles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </BottomSheet>
    </>
  );
}

const usersStyles = StyleSheet.create({
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: `${PRIMARY_COLOR}0d`,
    borderWidth: 1,
    borderColor: `${PRIMARY_COLOR}30`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  inviteIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: `${PRIMARY_COLOR}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
    marginBottom: 2,
  },
  inviteBody: {
    fontSize: 12,
    color: '#6b7280',
  },
  inviteSlug: {
    fontWeight: '700',
    color: PRIMARY_COLOR,
  },
  selfAvatar: {
    backgroundColor: `${PRIMARY_COLOR}25`,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ownerBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
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
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  youBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0369a1',
  },
  roleBadgeSelf: {
    opacity: 0.5,
  },
  removeDisabled: {
    opacity: 0.3,
  },
});

const pickerSheetStyles = StyleSheet.create({
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  optionLabel: {
    flex: 1,
    fontSize: 15,
    color: '#374151',
  },
  optionLabelActive: {
    fontWeight: '700',
    color: '#111',
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
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
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
    price: 'Custom pricing',
    tagline: 'For large-scale deployments with custom requirements.',
    compareNote: 'Everything in Campus, plus:',
    features: [
      { icon: 'directions-bus', text: 'Unlimited vehicles' },
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
            { backgroundColor: actionDisabled ? '#e5e7eb' : primaryColor },
          ]}
          onPress={() => { if (!actionDisabled) { onAction(); onClose(); } }}
          disabled={actionDisabled}
        >
          <Text style={[detailStyles.ctaBtnText, { color: actionDisabled ? '#9ca3af' : '#fff' }]}>
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
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  highlightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 8,
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
    color: '#111',
    marginBottom: 4,
  },
  planPrice: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginVertical: 16,
  },
  compareNote: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
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
    color: '#374151',
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
  const { org, refreshOrg } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [isLoading, setIsLoading] = useState(false);

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
        const { url, error } = await res.json();
        if (error) throw new Error(error);

        const result = await WebBrowser.openAuthSessionAsync(url, 'shuttler://billing');

        // Browser closed (no redirect) — user dismissed without touching Stripe.
        if (result.type !== 'success') return;

        // Stripe cancel button redirects to cancel_url (shuttler://billing, no session_id).
        // Stripe success redirects to success_url (shuttler://billing?session_id=...).
        const redirectedUrl = (result as any).url as string | undefined;
        if (!redirectedUrl?.includes('session_id=')) return;

        // Payment confirmed — unlock the UI immediately.
        // The Firestore live listener fires the confirmation sheet as soon as
        // the webhook updates the org doc. Background polls are a safety net.
        void refreshOrg();
        setTimeout(() => void refreshOrg(), 3000);
        setTimeout(() => void refreshOrg(), 7000);
      } catch (e: any) {
        showToast(e?.message ?? 'Failed to open billing.', 'error');
      } finally {
        setIsLoading(false);  // unblocks immediately — no more 10s freeze
      }
    },
    [org, refreshOrg],
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

      const result = await WebBrowser.openAuthSessionAsync(url, 'shuttler://billing');

      if (result.type !== 'success') return;
      const redirectedUrl = (result as any).url as string | undefined;
      if (!redirectedUrl?.includes('session_id=')) return;

      void refreshOrg();
      setTimeout(() => void refreshOrg(), 3000);
      setTimeout(() => void refreshOrg(), 7000);
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to open billing.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [org, refreshOrg]);

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

      const result = await WebBrowser.openAuthSessionAsync(url, 'shuttler://billing');

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
      setIsLoading(false);
    }
  }, [org, refreshOrg]);

  const [detailPlan, setDetailPlan] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'plan' | 'addon' | null>(null);
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
      setConfirmation('plan');
      baselineStatus.current = org.subscriptionStatus;
      baselinePlan.current   = org.subscriptionPlan;
    }

    if (org.dataAddonActive && !baselineAddon.current) {
      setConfirmation('addon');
      baselineAddon.current = true;
    }
  }, [org?.subscriptionStatus, org?.subscriptionPlan, org?.dataAddonActive]);

  const currentLimits = getPlanLimits(org?.subscriptionPlan, org?.subscriptionStatus);
  const isActive = org?.subscriptionStatus === 'active';
  const isTrialing = org?.subscriptionStatus === 'trialing' || !org?.subscriptionPlan;
  const statusColor = isActive || isTrialing ? '#2e7d32' : '#e53935';
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
              {isTrialing ? 'Trial' : org?.subscriptionStatus ?? '—'}
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
        const isCurrent = org?.subscriptionPlan === plan.key && isActive;
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
              label={isCurrent ? 'Active' : (!isApproved ? 'Pending' : (isLoading ? '…' : 'Subscribe'))}
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
          <Text style={[styles.planPrice, { color: primaryColor }]}>Custom pricing</Text>
          <Text style={styles.planDesc}>Unlimited vehicles · SSO · SLA · Custom branding</Text>
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
        const dataUnlocked = org?.entitlements?.dataApi ?? org?.dataAddonActive ?? false;
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
          : detailPlan === 'campus' ? 'Subscribe — $299/mo'
          : 'Subscribe — $149/mo'
        }
        actionDisabled={
          isLoading || !isApproved ||
          (detailPlan !== 'data_addon' && detailPlan !== 'enterprise' &&
            org?.subscriptionPlan === detailPlan && isActive) ||
          (detailPlan === 'data_addon' && (org?.entitlements?.dataApi ?? org?.dataAddonActive ?? false))
        }
      />

      {isActive && (
        <AppButton
          label={isLoading ? '…' : 'Manage Billing'}
          onPress={openPortal}
          disabled={isLoading}
          style={[styles.actionButton, styles.secondaryButton]}
        />
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
          ? 'Your full boarding history, trend charts, driver stats, and CSV export are now available.'
          : `Your subscription is active. You now have access to ${vehicleLimitText(currentLimits).toLowerCase()} and ${routeLimitText(currentLimits).toLowerCase()}.`}
      </Text>
      {confirmation === 'addon' && (
        <TouchableOpacity
          style={[confirmStyles.primaryBtn, { backgroundColor: primaryColor }]}
          onPress={() => { setConfirmation(null); navigation.navigate('AdminAnalytics'); }}
        >
          <Icon name="bar-chart" size={18} color="#fff" />
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
    color: '#111',
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    color: '#6b7280',
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
    color: '#fff',
  },
  secondaryBtn: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    color: '#6b7280',
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
        body: JSON.stringify({ breakSettings }),
      });
      if (!res.ok) throw new Error('Save failed');
      await refreshOrg();
      showToast('Break settings saved.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to save settings.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [org, enabled, maxMinutes, breaksPerShift, refreshOrg]);

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
          thumbColor="#fff"
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
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
    marginBottom: 2,
  },
  settingHint: {
    fontSize: 12,
    color: '#6b7280',
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
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  chipTextActive: {
    color: '#fff',
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
      </View>

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
              <Icon name={t.icon} size={20} color={activeTab === t.key ? primaryColor : '#aaa'} />
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
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    padding: 4,
    marginRight: spacing.section,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
  tabBar: {
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  tabBarContent: {
    flexDirection: 'row',
  },
  tabBarItem: {
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
  tabBarLabel: {
    fontSize: 11,
    color: '#aaa',
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
    color: '#e53935',
    textAlign: 'center',
    fontSize: 14,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 10,
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
  removeUserBtn: {
    padding: 4,
    marginLeft: 4,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  memberEmail: {
    fontSize: 12,
    color: '#888',
    marginTop: 1,
  },
  roleBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  routeBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#e0f2fe',
    marginRight: 4,
    maxWidth: 90,
    minWidth: 36,
    alignItems: 'center',
  },
  routeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0369a1',
  },
  tabContent: {
    padding: spacing.section,
    paddingBottom: spacing.section * 3,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.item,
    paddingVertical: Platform.OS === 'ios' ? 13 : 10,
    fontSize: 15,
    color: '#111',
    marginBottom: 0,
    backgroundColor: '#fff',
  },
  certInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    marginBottom: spacing.item,
  },
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 20,
  },
  tzValue: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  tzModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    borderColor: '#f3f4f6',
  },
  tzModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  tzOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderColor: '#f3f4f6',
  },
  tzOptionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  tzOptionValue: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 1,
  },
  actionButton: {
    marginTop: spacing.item,
  },
  secondaryButton: {
    backgroundColor: '#f5f5f5',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.item,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 8,
    backgroundColor: '#fff',
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
    borderColor: '#ccc',
    marginRight: 10,
  },
  radioSelected: {
    borderColor: PRIMARY_COLOR,
    backgroundColor: PRIMARY_COLOR,
  },
  radioLabel: {
    fontSize: 14,
    color: '#222',
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
    color: '#666',
    marginTop: 6,
  },
  infoBoxValue: {
    fontSize: 13,
    color: '#111',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // Stops tab
  stopsContainer: {
    flex: 1,
  },
  map: {
    height: 260,
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
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 14,
    color: '#111',
    padding: 0,
  },
  searchDropdown: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  searchDropdownItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  searchDropdownText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
  coordPreview: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  addStopForm: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  addStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  stopNameInput: {
    flex: 1,
    marginBottom: 0,
  },
  addStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: PRIMARY_COLOR,
    borderRadius: borderRadius.md,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  addStopBtnDisabled: {
    opacity: 0.45,
  },
  addStopBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 12,
    marginBottom: 4,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    gap: 10,
  },
  stopName: {
    flex: 1,
    fontSize: 15,
    color: '#222',
  },
  // Routes
  routesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.section,
  },
  planLimitBadge: {
    fontSize: 12,
    color: '#888',
    marginLeft: 'auto' as any,
    marginRight: 8,
  },
  routeCard: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: borderRadius.md,
    marginBottom: 8,
    overflow: 'hidden',
  },
  routeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 8,
    backgroundColor: '#fafafa',
  },
  routeName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#222',
  },
  routeStopCount: {
    fontSize: 12,
    color: '#888',
  },
  routeDeleteBtn: {
    paddingLeft: 4,
  },
  routeEditor: {
    padding: spacing.item,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  routeEditorLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  routeStopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  routeStopIndex: {
    fontSize: 13,
    color: '#999',
    width: 20,
  },
  routeStopName: {
    flex: 1,
    fontSize: 14,
    color: '#222',
  },
  routeStopAvailable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
    opacity: 0.6,
  },
  // Billing
  statusCard: {
    backgroundColor: '#fff',
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
    color: '#888',
    marginBottom: 2,
  },
  statusPlanName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
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
    color: '#444',
  },
  trialNote: {
    fontSize: 12,
    color: '#888',
    marginTop: spacing.item,
    lineHeight: 17,
  },
  planCard: {
    backgroundColor: '#fff',
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
    color: '#111',
  },
  popularBadge: {
    backgroundColor: PRIMARY_COLOR + '20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
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
    borderRadius: 8,
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
    color: '#888',
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
