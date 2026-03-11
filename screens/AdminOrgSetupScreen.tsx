// screens/AdminOrgSetupScreen.tsx
//
// Four-tab admin onboarding screen for org admins.
// Tabs: Org Profile | Auth Settings | Stop Configuration | Billing

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import * as WebBrowser from 'expo-web-browser';
import { auth, db } from '../firebase/firebaseconfig';
import { useOrg, Stop } from '../src/org/OrgContext';
import { SHUTTLER_API_URL } from '../config';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Tab = 'profile' | 'auth' | 'stops' | 'billing';

// ---- Helpers ----

async function getBearerToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

// ---- Profile Tab ----

function ProfileTab() {
  const { org, refreshOrg } = useOrg();
  const [name, setName] = useState(org?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!org) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'orgs', org.orgId), {
        name: name.trim(),
        updatedAt: serverTimestamp(),
      });
      await refreshOrg();
      Alert.alert('Saved', 'Organization name updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }, [org, name, refreshOrg]);

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Text style={styles.sectionLabel}>Organization Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. McKendree University"
        placeholderTextColor="#aaa"
        autoCapitalize="words"
      />
      <Text style={styles.hint}>
        This name appears in the org selector screen for all users.
      </Text>
      <AppButton
        label={isSaving ? 'Saving…' : 'Save Profile'}
        onPress={handleSave}
        disabled={isSaving || !name.trim()}
        style={styles.actionButton}
      />
    </ScrollView>
  );
}

// ---- Auth Settings Tab ----

type AuthMethod = 'saml' | 'email' | 'email+google';

function AuthTab() {
  const { org, refreshOrg } = useOrg();
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
      Alert.alert('Saved', 'Auth configuration updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }, [org, authMethod, domains, idpEntityId, idpSsoUrl, idpCert, refreshOrg]);

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Text style={styles.sectionLabel}>Authentication Method</Text>

      {(['email', 'saml', 'email+google'] as AuthMethod[]).map((m) => (
        <TouchableOpacity
          key={m}
          style={[styles.radioRow, authMethod === m && styles.radioRowActive]}
          onPress={() => setAuthMethod(m)}
        >
          <View style={[styles.radio, authMethod === m && styles.radioSelected]} />
          <Text style={styles.radioLabel}>
            {m === 'email' ? 'Email / Password' : m === 'saml' ? 'SAML SSO (IT-managed)' : 'Email + Google'}
          </Text>
        </TouchableOpacity>
      ))}

      <Text style={styles.sectionLabel} style={{ marginTop: spacing.section }}>
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
          <Text style={styles.infoBoxTitle}>Give these to your IT team:</Text>
          <Text style={styles.infoBoxLabel}>ACS URL</Text>
          <Text style={styles.infoBoxValue} selectable>{savedSpInfo.acsUrl}</Text>
          <Text style={styles.infoBoxLabel}>SP Entity ID</Text>
          <Text style={styles.infoBoxValue} selectable>{savedSpInfo.spEntityId}</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ---- Stop Configuration Tab ----

function StopsTab() {
  const { org, refreshOrg } = useOrg();
  const mapRef = useRef<MapView>(null);
  const [stops, setStops] = useState<Stop[]>(org?.stops ?? []);
  const [mapCenter, setMapCenter] = useState(
    org?.mapCenter ?? { latitude: 38.9072, longitude: -77.0369 },
  );
  const [pendingName, setPendingName] = useState('');
  const [pendingCoords, setPendingCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleMapPress = useCallback((e: any) => {
    const coords = e.nativeEvent.coordinate;
    setPendingCoords(coords);
  }, []);

  const handleAddStop = useCallback(() => {
    if (!pendingCoords || !pendingName.trim()) {
      Alert.alert('Name required', 'Enter a stop name before adding.');
      return;
    }
    const newStop: Stop = {
      id: `stop_${Date.now()}`,
      name: pendingName.trim(),
      latitude: pendingCoords.latitude,
      longitude: pendingCoords.longitude,
    };
    setStops((prev) => [...prev, newStop]);
    setPendingName('');
    setPendingCoords(null);
  }, [pendingCoords, pendingName]);

  const handleDeleteStop = useCallback((id: string) => {
    Alert.alert('Remove stop', 'Remove this stop?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setStops((prev) => prev.filter((s) => s.id !== id)) },
    ]);
  }, []);

  const handleSaveStops = useCallback(async () => {
    if (!org) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'orgs', org.orgId), {
        stops,
        mapCenter,
        updatedAt: serverTimestamp(),
      });
      await refreshOrg();
      Alert.alert('Saved', 'Stops and map center updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save stops.');
    } finally {
      setIsSaving(false);
    }
  }, [org, stops, mapCenter, refreshOrg]);

  const initialRegion: Region = {
    latitude: mapCenter.latitude,
    longitude: mapCenter.longitude,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  return (
    <View style={styles.stopsContainer}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
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
            pinColor={PRIMARY_COLOR}
            onCalloutPress={() => handleDeleteStop(stop.id)}
          />
        ))}
        {pendingCoords && (
          <Marker
            coordinate={pendingCoords}
            pinColor="orange"
            title="New stop (tap callout to confirm)"
          />
        )}
      </MapView>

      <View style={styles.stopsPanel}>
        <Text style={styles.hint}>
          Tap the map to place a new stop. The map center is saved as the default view.
        </Text>

        {pendingCoords && (
          <View style={styles.addStopRow}>
            <TextInput
              style={[styles.input, styles.stopNameInput]}
              placeholder="Stop name"
              value={pendingName}
              onChangeText={setPendingName}
              placeholderTextColor="#aaa"
            />
            <TouchableOpacity style={styles.addStopBtn} onPress={handleAddStop}>
              <Icon name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        <ScrollView style={styles.stopsList} nestedScrollEnabled>
          {stops.map((stop) => (
            <View key={stop.id} style={styles.stopRow}>
              <Icon name="place" size={18} color={PRIMARY_COLOR} />
              <Text style={styles.stopName} numberOfLines={1}>{stop.name}</Text>
              <TouchableOpacity onPress={() => handleDeleteStop(stop.id)}>
                <Icon name="close" size={18} color="#e53935" />
              </TouchableOpacity>
            </View>
          ))}
          {stops.length === 0 && (
            <Text style={styles.hint}>No stops yet. Tap the map to add some.</Text>
          )}
        </ScrollView>

        <AppButton
          label={isSaving ? 'Saving…' : 'Save Stops & Map Center'}
          onPress={handleSaveStops}
          disabled={isSaving}
          style={styles.actionButton}
        />
      </View>
    </View>
  );
}

// ---- Billing Tab ----

function BillingTab() {
  const { org } = useOrg();
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
        await WebBrowser.openBrowserAsync(url);
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Failed to open billing.');
      } finally {
        setIsLoading(false);
      }
    },
    [org],
  );

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
      await WebBrowser.openBrowserAsync(url);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to open billing portal.');
    } finally {
      setIsLoading(false);
    }
  }, [org]);

  const statusColor =
    org?.subscriptionStatus === 'active' || org?.subscriptionStatus === 'trialing'
      ? '#2e7d32'
      : '#e53935';

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Current Status</Text>
        <Text style={[styles.statusValue, { color: statusColor }]}>
          {org?.subscriptionStatus ?? '—'}
        </Text>
        <Text style={styles.statusPlan}>Plan: {org?.subscriptionPlan ?? '—'}</Text>
      </View>

      {['starter', 'professional'].map((plan) => (
        <View key={plan} style={styles.planCard}>
          <View style={styles.planInfo}>
            <Text style={styles.planName}>{plan === 'starter' ? 'Starter' : 'Professional'}</Text>
            <Text style={styles.planPrice}>{plan === 'starter' ? '$99/mo' : '$249/mo'}</Text>
            <Text style={styles.planDesc}>
              {plan === 'starter' ? 'Up to 3 drivers, 10 stops' : 'Up to 10 drivers, 30 stops'}
            </Text>
          </View>
          <AppButton
            label={isLoading ? '…' : 'Subscribe'}
            onPress={() => openCheckout(plan)}
            disabled={isLoading}
            style={styles.planButton}
          />
        </View>
      ))}

      {org?.subscriptionStatus && org.subscriptionStatus !== 'trialing' && (
        <AppButton
          label={isLoading ? '…' : 'Manage Billing'}
          onPress={openPortal}
          disabled={isLoading}
          style={[styles.actionButton, styles.secondaryButton]}
        />
      )}
    </ScrollView>
  );
}

// ---- Main Screen ----

export default function AdminOrgSetupScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'profile', icon: 'business', label: 'Profile' },
    { key: 'auth', icon: 'lock', label: 'Auth' },
    { key: 'stops', icon: 'place', label: 'Stops' },
    { key: 'billing', icon: 'credit-card', label: 'Billing' },
  ];

  return (
    <ScreenContainer>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Organization Setup</Text>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBarItem, activeTab === t.key && styles.tabBarItemActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Icon name={t.icon} size={20} color={activeTab === t.key ? PRIMARY_COLOR : '#aaa'} />
            <Text style={[styles.tabBarLabel, activeTab === t.key && styles.tabBarLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab Content */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'auth' && <AuthTab />}
        {activeTab === 'stops' && <StopsTab />}
        {activeTab === 'billing' && <BillingTab />}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    paddingHorizontal: spacing.section,
    paddingVertical: spacing.item,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  tabBarItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    gap: 3,
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
  tabContent: {
    padding: spacing.section,
    paddingBottom: spacing.section * 3,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 6,
    marginTop: spacing.item,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.item,
    paddingVertical: Platform.OS === 'ios' ? 12 : 9,
    fontSize: 15,
    color: '#111',
    marginBottom: 4,
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
  stopsPanel: {
    flex: 1,
    padding: spacing.item,
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
    backgroundColor: PRIMARY_COLOR,
    borderRadius: borderRadius.md,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopsList: {
    flex: 1,
    maxHeight: 160,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  stopName: {
    flex: 1,
    fontSize: 14,
    color: '#222',
  },
  // Billing
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    ...cardShadow,
    marginBottom: spacing.section,
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 22,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  statusPlan: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
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
  planInfo: {
    flex: 1,
  },
  planName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
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
  planButton: {
    minWidth: 90,
  },
});
