// screens/AdminOrgSetupScreen.tsx
//
// Four-tab admin onboarding screen for org admins.
// Tabs: Org Profile | Auth Settings | Stop Configuration | Billing

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
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
import MapView, { Marker, Region } from 'react-native-maps';
import { doc, updateDoc, setDoc, getDoc, serverTimestamp, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { GOOGLE_MAPS_API_KEY } from '../config';
import * as WebBrowser from 'expo-web-browser';
import { auth, db } from '../firebase/firebaseconfig';
import { useOrg, Stop, Route, RouteHours } from '../src/org/OrgContext';
import { SHUTTLER_API_URL } from '../config';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import { getPlanLimits, vehicleLimitText, routeLimitText, stopLimitText } from '../src/constants/planLimits';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Tab = 'profile' | 'auth' | 'stops' | 'users' | 'billing' | 'analytics';

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

type AuthMethod = 'saml' | 'email' | 'phone';

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

      {(['email', 'phone', 'saml'] as AuthMethod[]).map((m) => (
        <TouchableOpacity
          key={m}
          style={[styles.radioRow, authMethod === m && styles.radioRowActive]}
          onPress={() => setAuthMethod(m)}
        >
          <View style={[styles.radio, authMethod === m && styles.radioSelected]} />
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

// ---- Hours Editor (used inside route cards) ----

function HoursEditor({
  route,
  onAdd,
  onDelete,
}: {
  route: Route;
  onAdd: (entry: RouteHours) => void;
  onDelete: (idx: number) => void;
}) {
  const [days, setDays] = useState('');
  const [open, setOpen] = useState('');
  const [close, setClose] = useState('');
  const [showForm, setShowForm] = useState(false);

  const handleAdd = () => {
    if (!days.trim() || !open.trim() || !close.trim()) return;
    onAdd({ days: days.trim(), open: open.trim(), close: close.trim() });
    setDays(''); setOpen(''); setClose('');
    setShowForm(false);
  };

  const hours = route.hoursOfOperation ?? [];

  return (
    <View style={{ marginTop: 12 }}>
      <View style={hoursStyles.header}>
        <Icon name="schedule" size={14} color="#6b7280" />
        <Text style={hoursStyles.label}>Hours of Operation</Text>
        <TouchableOpacity onPress={() => setShowForm((v) => !v)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Icon name={showForm ? 'remove' : 'add'} size={18} color={PRIMARY_COLOR} />
        </TouchableOpacity>
      </View>

      {hours.map((h, idx) => (
        <View key={idx} style={hoursStyles.row}>
          <Text style={hoursStyles.rowText}>{h.days}  {h.open} – {h.close}</Text>
          <TouchableOpacity onPress={() => onDelete(idx)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Icon name="close" size={14} color="#e53935" />
          </TouchableOpacity>
        </View>
      ))}
      {hours.length === 0 && !showForm && (
        <Text style={hoursStyles.empty}>No hours set — tap + to add.</Text>
      )}

      {showForm && (
        <View style={hoursStyles.form}>
          <TextInput
            style={hoursStyles.input}
            placeholder="Days (e.g. Mon–Fri)"
            value={days}
            onChangeText={setDays}
            placeholderTextColor="#aaa"
          />
          <View style={hoursStyles.timeRow}>
            <TextInput
              style={[hoursStyles.input, { flex: 1 }]}
              placeholder="Open (e.g. 7:30 AM)"
              value={open}
              onChangeText={setOpen}
              placeholderTextColor="#aaa"
            />
            <Text style={hoursStyles.dash}>–</Text>
            <TextInput
              style={[hoursStyles.input, { flex: 1 }]}
              placeholder="Close (e.g. 10:00 PM)"
              value={close}
              onChangeText={setClose}
              placeholderTextColor="#aaa"
            />
          </View>
          <TouchableOpacity
            style={[hoursStyles.addBtn, (!days.trim() || !open.trim() || !close.trim()) && { opacity: 0.4 }]}
            onPress={handleAdd}
            disabled={!days.trim() || !open.trim() || !close.trim()}
          >
            <Text style={hoursStyles.addBtnText}>Add Hours</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const hoursStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  label: { flex: 1, fontSize: 12, fontWeight: '600', color: '#6b7280' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  rowText: { fontSize: 13, color: '#374151' },
  empty: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },
  form: { gap: 6, marginTop: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dash: { fontSize: 14, color: '#6b7280' },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    color: '#111',
    backgroundColor: '#fafafa',
  },
  addBtn: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});

// ---- Stop tab extra styles ----
const stopStyles = StyleSheet.create({
  manualToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    marginBottom: 4,
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

function StopsTab() {
  const { org, refreshOrg } = useOrg();
  const planLimits = getPlanLimits(org?.subscriptionPlan, org?.subscriptionStatus);
  const mapRef = useRef<MapView>(null);
  const [stops, setStops] = useState<Stop[]>(org?.stops ?? []);
  const [routes, setRoutes] = useState<Route[]>(org?.routes ?? []);

  // Keep local state in sync when org updates via real-time Firestore listener
  useEffect(() => { setStops(org?.stops ?? []); }, [org?.stops]);
  useEffect(() => { setRoutes(org?.routes ?? []); }, [org?.routes]);

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
      Alert.alert('Invalid coordinates', 'Latitude must be −90 to 90, longitude −180 to 180.');
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
      Alert.alert('Name required', 'Enter a stop name.');
      return;
    }
    if (!pendingCoords) {
      Alert.alert('Coordinates required', 'Tap the map or enter latitude and longitude.');
      return;
    }
    if (stops.length >= planLimits.maxStops) {
      Alert.alert(
        'Stop limit reached',
        `Your ${planLimits.label} plan allows ${stopLimitText(planLimits)}. Upgrade to Campus for unlimited stops.`,
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
    setIsSaving(true);
    try {
      const bounds = calcBoundsFromStops(stops);
      await updateDoc(doc(db, 'orgs', org.orgId), {
        stops,
        routes,
        mapCenter: bounds?.mapCenter ?? mapCenter,
        ...(bounds ? { mapBoundingBox: bounds.mapBoundingBox } : {}),
        updatedAt: serverTimestamp(),
      });
      await refreshOrg();
      Alert.alert('Saved', 'Stops, routes, and map bounds updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  }, [org, stops, routes, mapCenter, refreshOrg]);

  // Route helpers
  const handleAddRoute = useCallback(() => {
    if (!newRouteName.trim()) return;
    if (routes.length >= planLimits.maxRoutes) {
      Alert.alert(
        'Route limit reached',
        `Your ${planLimits.label} plan allows ${routeLimitText(planLimits)}. Upgrade to Campus for unlimited routes.`,
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

  const handleAddHours = useCallback(
    (routeId: string, entry: RouteHours) => {
      setRoutes((prev) =>
        prev.map((r) =>
          r.id !== routeId ? r : { ...r, hoursOfOperation: [...(r.hoursOfOperation ?? []), entry] },
        ),
      );
    },
    [],
  );

  const handleDeleteHours = useCallback(
    (routeId: string, idx: number) => {
      setRoutes((prev) =>
        prev.map((r) =>
          r.id !== routeId ? r : { ...r, hoursOfOperation: (r.hoursOfOperation ?? []).filter((_, i) => i !== idx) },
        ),
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
        style={styles.map}
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
          <Marker coordinate={pendingCoords} pinColor="orange" title="New stop" />
        )}
      </MapView>

      <ScrollView style={styles.stopsPanel} nestedScrollEnabled>
        {/* --- Stops section --- */}
        <View style={styles.routesHeader}>
          <Text style={styles.sectionLabel}>Stops</Text>
          <Text style={styles.planLimitBadge}>
            {stops.length}/{planLimits.maxStops === Infinity ? '∞' : planLimits.maxStops}
          </Text>
        </View>
        <Text style={styles.hint}>Search for a location or tap the map to place a pin.</Text>

        {/* Search bar */}
        <View style={styles.searchBarRow}>
          <Icon name="search" size={18} color="#9ca3af" style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchBarInput}
            placeholder="Search address or place…"
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholderTextColor="#aaa"
            returnKeyType="search"
            autoCorrect={false}
          />
          {isSearching && <ActivityIndicator size="small" color={PRIMARY_COLOR} style={{ marginLeft: 6 }} />}
          {searchQuery.length > 0 && !isSearching && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Icon name="close" size={16} color="#9ca3af" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          )}
        </View>

        {/* Autocomplete dropdown */}
        {searchResults.length > 0 && (
          <View style={styles.searchDropdown}>
            {searchResults.map((s) => (
              <TouchableOpacity
                key={s.placeId}
                style={styles.searchDropdownItem}
                onPress={() => handleSelectPlace(s)}
              >
                <Icon name="place" size={14} color="#9ca3af" style={{ marginRight: 8, marginTop: 1 }} />
                <Text style={styles.searchDropdownText} numberOfLines={2}>{s.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Manual coordinate entry — collapsible */}
        <TouchableOpacity
          style={stopStyles.manualToggle}
          onPress={() => setShowManualCoords((v) => !v)}
        >
          <Icon name="my-location" size={14} color="#6b7280" />
          <Text style={stopStyles.manualToggleText}>Enter coordinates manually</Text>
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
              style={[stopStyles.applyBtn, (!manualLat || !manualLon) && { opacity: 0.4 }]}
              onPress={handleApplyManualCoords}
              disabled={!manualLat || !manualLon}
            >
              <Text style={stopStyles.applyBtnText}>Use These Coordinates</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.addStopForm}>
          <TextInput
            style={styles.input}
            placeholder="Stop name"
            value={pendingName}
            onChangeText={setPendingName}
            placeholderTextColor="#aaa"
          />
          {pendingCoords && (
            <Text style={styles.coordPreview}>
              📍 {pendingCoords.latitude.toFixed(5)}, {pendingCoords.longitude.toFixed(5)}
            </Text>
          )}
          <TouchableOpacity
            style={[styles.addStopBtn, (!pendingName.trim() || !pendingCoords) && styles.addStopBtnDisabled]}
            onPress={handleAddStop}
            disabled={!pendingName.trim() || !pendingCoords}
          >
            <Icon name="add" size={20} color="#fff" />
            <Text style={styles.addStopBtnText}>Add Stop</Text>
          </TouchableOpacity>
        </View>

        {stops.map((stop) => (
          <View key={stop.id} style={styles.stopRow}>
            <Icon name="place" size={18} color={PRIMARY_COLOR} />
            <Text style={styles.stopName} numberOfLines={1}>{stop.name}</Text>
            <TouchableOpacity onPress={() => handleDeleteStop(stop.id)}>
              <Icon name="close" size={18} color="#e53935" />
            </TouchableOpacity>
          </View>
        ))}
        {stops.length === 0 && <Text style={styles.hint}>No stops yet. Fill the form above and tap Add Stop.</Text>}

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
                  `Your ${planLimits.label} plan allows ${routeLimitText(planLimits)}. Upgrade to Campus for unlimited routes.`,
                );
                return;
              }
              setShowRouteForm(true);
            }}
          >
            <Icon
              name="add-circle"
              size={24}
              color={routes.length >= planLimits.maxRoutes ? '#ccc' : PRIMARY_COLOR}
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
            <TouchableOpacity style={styles.addStopBtn} onPress={handleAddRoute}>
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
                <Icon name="directions-bus" size={18} color={PRIMARY_COLOR} />
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
                      <Icon name="add-circle-outline" size={18} color={PRIMARY_COLOR} />
                      <Text style={styles.routeStopName}>{stop.name}</Text>
                    </TouchableOpacity>
                  ))}

                  {stops.length === 0 && (
                    <Text style={styles.hint}>Add stops above first.</Text>
                  )}

                  {/* Hours of operation */}
                  <HoursEditor
                    route={route}
                    onAdd={(entry) => handleAddHours(route.id, entry)}
                    onDelete={(idx) => handleDeleteHours(route.id, idx)}
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
  role: 'student' | 'driver' | 'admin';
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
  admin: PRIMARY_COLOR,
  parent: '#10b981',
};

function UsersTab() {
  const { org } = useOrg();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // uid → defaultRouteId currently saved in Firestore for drivers
  const [driverDefaults, setDriverDefaults] = useState<Record<string, string | null>>({});
  const [savingRoute, setSavingRoute] = useState<string | null>(null);

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
      const current = driverDefaults[member.uid] ?? null;
      Alert.alert(
        `Assign default route`,
        `${member.displayName ?? member.email}`,
        [
          ...orgRoutes.map((r) => ({
            text: r.id === current ? `✓ ${r.name}` : r.name,
            onPress: () => saveDefaultRoute(member.uid, r.id),
          })),
          { text: 'Clear assignment', onPress: () => saveDefaultRoute(member.uid, null) },
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
    },
    [org, orgRoutes, driverDefaults],
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
        Alert.alert('Error', e?.message ?? 'Could not save route assignment.');
      } finally {
        setSavingRoute(null);
      }
    },
    [org],
  );

  const handleChangeRole = useCallback(
    (member: OrgMember) => {
      if (!org) return;
      Alert.alert(
        `Change role for ${member.displayName ?? member.email}`,
        `Current role: ${ROLE_LABELS[member.role]}`,
        [
          { text: 'Student', onPress: () => applyRole(member.uid, 'student') },
          { text: 'Driver', onPress: () => applyRole(member.uid, 'driver') },
          { text: 'Admin', onPress: () => applyRole(member.uid, 'admin') },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
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
        Alert.alert('Error', e?.message ?? 'Could not update role.');
      }
    },
    [org],
  );

  const handleRemoveUser = useCallback(
    (member: OrgMember) => {
      if (!org) return;
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
                Alert.alert('Error', e?.message ?? 'Could not remove user.');
              }
            },
          },
        ],
      );
    },
    [org],
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
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

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <Text style={styles.hint}>
        Tap a member's role badge to change it. Tap the route badge on drivers to assign a default route.
      </Text>
      {members.length === 0 && (
        <Text style={styles.hint}>No members yet. Share your org slug so people can register.</Text>
      )}
      {members.map((member) => {
        const isDriver = member.role === 'driver' || member.role === 'admin';
        const assignedRouteId = driverDefaults[member.uid] ?? null;
        const assignedRoute = assignedRouteId ? orgRoutes.find((r) => r.id === assignedRouteId) : null;
        return (
          <View key={member.uid} style={styles.memberRow}>
            <View style={styles.memberAvatar}>
              <Text style={styles.memberAvatarText}>
                {(member.displayName ?? member.email).charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName} numberOfLines={1}>
                {member.displayName ?? '—'}
              </Text>
              <Text style={styles.memberEmail} numberOfLines={1}>{member.email}</Text>
            </View>
            {isDriver && orgRoutes.length > 0 && (
              <TouchableOpacity
                style={styles.routeBadge}
                onPress={() => handleAssignRoute(member)}
                disabled={savingRoute === member.uid}
              >
                {savingRoute === member.uid ? (
                  <ActivityIndicator size="small" color={PRIMARY_COLOR} />
                ) : (
                  <Text style={styles.routeBadgeText} numberOfLines={1}>
                    {assignedRoute ? assignedRoute.name : 'Route…'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.roleBadge, { backgroundColor: `${ROLE_COLORS[member.role]}20` }]}
              onPress={() => handleChangeRole(member)}
            >
              <Text style={[styles.roleBadgeText, { color: ROLE_COLORS[member.role] }]}>
                {ROLE_LABELS[member.role]}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleRemoveUser(member)} style={styles.removeUserBtn}>
              <Icon name="person-remove" size={18} color="#e53935" />
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ---- Billing Tab ----

function BillingTab() {
  const { org, refreshOrg } = useOrg();
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
        await WebBrowser.openAuthSessionAsync(url, 'shuttler://billing');
        // Poll for webhook to process — retry up to 5× at 2s intervals (~10s total)
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          await refreshOrg();
        }
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Failed to open billing.');
      } finally {
        setIsLoading(false);
      }
    },
    [org, refreshOrg],
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
      await WebBrowser.openAuthSessionAsync(url, 'shuttler://billing');
      // Poll for portal changes (e.g. plan upgrade/cancel) to reflect in app
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await refreshOrg();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to open billing portal.');
    } finally {
      setIsLoading(false);
    }
  }, [org, refreshOrg]);

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
          <View key={plan.key} style={[styles.planCard, isCurrent && styles.planCardActive]}>
            <View style={styles.planInfo}>
              <View style={styles.planNameRow}>
                <Text style={styles.planName}>{plan.label}</Text>
                {plan.popular && <View style={styles.popularBadge}><Text style={styles.popularBadgeText}>Most Popular</Text></View>}
                {isCurrent && <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>Current</Text></View>}
              </View>
              <Text style={styles.planPrice}>{plan.price}</Text>
              <Text style={styles.planDesc}>{plan.desc}</Text>
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
          <Text style={styles.planPrice}>Custom pricing</Text>
          <Text style={styles.planDesc}>Unlimited vehicles · SSO · SLA · Custom branding</Text>
        </View>
        <AppButton
          label="Contact us"
          onPress={() => WebBrowser.openBrowserAsync('https://shuttler.net')}
          style={styles.planButton}
        />
      </View>

      {isActive && (
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

// ---- Analytics Tab ----

interface BoardingCount {
  id: string;
  driverUid: string;
  stopId: string;
  stopName: string;
  count: number;
  createdAt: any;
}

interface StopStat {
  stopName: string;
  total: number;
}

interface DriverStat {
  driverUid: string;
  total: number;
}

function AnalyticsTab() {
  const { org } = useOrg();
  const [records, setRecords] = useState<BoardingCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    const load = async () => {
      try {
        setIsLoading(true);
        const q = query(
          collection(db, 'orgs', org.orgId, 'boardingCounts'),
          orderBy('createdAt', 'desc'),
        );
        const snap = await getDocs(q);
        setRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BoardingCount, 'id'>) })));
      } catch (e: any) {
        setError(e.message ?? 'Failed to load analytics');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [org?.orgId]);

  if (isLoading) {
    return (
      <View style={analyticsStyles.center}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={analyticsStyles.center}>
        <Text style={analyticsStyles.errorText}>{error}</Text>
      </View>
    );
  }

  if (records.length === 0) {
    return (
      <View style={analyticsStyles.center}>
        <Icon name="bar-chart" size={48} color="#d1d5db" />
        <Text style={analyticsStyles.emptyText}>No boarding data yet.</Text>
        <Text style={analyticsStyles.emptySubtext}>
          Analytics will appear once drivers start completing stop requests.
        </Text>
      </View>
    );
  }

  const totalBoarded = records.reduce((sum, r) => sum + (r.count ?? 0), 0);

  const stopMap = new Map<string, StopStat>();
  for (const r of records) {
    const key = r.stopName ?? r.stopId ?? 'Unknown';
    const existing = stopMap.get(key);
    stopMap.set(key, { stopName: key, total: (existing?.total ?? 0) + (r.count ?? 0) });
  }
  const topStops = Array.from(stopMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const driverMap = new Map<string, DriverStat>();
  for (const r of records) {
    const key = r.driverUid ?? 'Unknown';
    const existing = driverMap.get(key);
    driverMap.set(key, { driverUid: key, total: (existing?.total ?? 0) + (r.count ?? 0) });
  }
  const topDrivers = Array.from(driverMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const recent = records.slice(0, 10);

  return (
    <ScrollView contentContainerStyle={analyticsStyles.container}>
      {/* Summary cards */}
      <View style={analyticsStyles.cardRow}>
        <View style={[analyticsStyles.card, { flex: 1 }]}>
          <Icon name="people" size={24} color={PRIMARY_COLOR} />
          <Text style={analyticsStyles.cardValue}>{totalBoarded}</Text>
          <Text style={analyticsStyles.cardLabel}>Total Boarded</Text>
        </View>
        <View style={[analyticsStyles.card, { flex: 1 }]}>
          <Icon name="place" size={24} color={PRIMARY_COLOR} />
          <Text style={analyticsStyles.cardValue}>{stopMap.size}</Text>
          <Text style={analyticsStyles.cardLabel}>Active Stops</Text>
        </View>
        <View style={[analyticsStyles.card, { flex: 1 }]}>
          <Icon name="directions-bus" size={24} color={PRIMARY_COLOR} />
          <Text style={analyticsStyles.cardValue}>{driverMap.size}</Text>
          <Text style={analyticsStyles.cardLabel}>Active Drivers</Text>
        </View>
      </View>

      {/* Busiest stops */}
      <Text style={analyticsStyles.sectionTitle}>Busiest Stops</Text>
      <View style={analyticsStyles.listCard}>
        {topStops.map((s, i) => (
          <View key={s.stopName} style={[analyticsStyles.listRow, i > 0 && analyticsStyles.listRowBorder]}>
            <View style={analyticsStyles.rankBadge}>
              <Text style={analyticsStyles.rankText}>{i + 1}</Text>
            </View>
            <Text style={analyticsStyles.listLabel} numberOfLines={1}>{s.stopName}</Text>
            <Text style={analyticsStyles.listValue}>{s.total} boarded</Text>
          </View>
        ))}
      </View>

      {/* Top drivers */}
      <Text style={analyticsStyles.sectionTitle}>Top Drivers</Text>
      <View style={analyticsStyles.listCard}>
        {topDrivers.map((d, i) => (
          <View key={d.driverUid} style={[analyticsStyles.listRow, i > 0 && analyticsStyles.listRowBorder]}>
            <View style={analyticsStyles.rankBadge}>
              <Text style={analyticsStyles.rankText}>{i + 1}</Text>
            </View>
            <Text style={[analyticsStyles.listLabel, { fontFamily: 'Menlo', fontSize: 12 }]} numberOfLines={1}>
              {d.driverUid.slice(0, 16)}…
            </Text>
            <Text style={analyticsStyles.listValue}>{d.total} boarded</Text>
          </View>
        ))}
      </View>

      {/* Recent activity */}
      <Text style={analyticsStyles.sectionTitle}>Recent Activity</Text>
      <View style={analyticsStyles.listCard}>
        {recent.map((r, i) => {
          const ts = r.createdAt?.toDate?.();
          const dateStr = ts ? ts.toLocaleDateString() : '—';
          return (
            <View key={r.id} style={[analyticsStyles.listRow, i > 0 && analyticsStyles.listRowBorder]}>
              <Icon name="check-circle" size={16} color="#22c55e" style={{ marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={analyticsStyles.listLabel} numberOfLines={1}>{r.stopName ?? r.stopId}</Text>
                <Text style={analyticsStyles.listMeta}>{dateStr}</Text>
              </View>
              <Text style={analyticsStyles.listValue}>{r.count} boarded</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const analyticsStyles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  errorText: { color: '#DC2626', fontSize: 14, textAlign: 'center' },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
  container: { padding: 16, gap: 8, paddingBottom: 40 },
  cardRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    ...cardShadow,
  },
  cardValue: { fontSize: 24, fontWeight: '700', color: '#111' },
  cardLabel: { fontSize: 11, color: '#6b7280', textAlign: 'center' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 12, marginBottom: 4 },
  listCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    ...cardShadow,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  listRowBorder: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  rankText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  listLabel: { flex: 1, fontSize: 14, color: '#111' },
  listMeta: { fontSize: 11, color: '#9ca3af' },
  listValue: { fontSize: 13, fontWeight: '600', color: '#374151' },
});

// ---- Main Screen ----

export default function AdminOrgSetupScreen() {
  const navigation = useNavigation();
  const { org: setupOrg } = useOrg();
  const [activeTab, setActiveTab] = useState<Tab>(
    (setupOrg?.stops?.length ?? 0) === 0 ? 'stops' : 'profile',
  );

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'profile', icon: 'business', label: 'Profile' },
    { key: 'auth', icon: 'lock', label: 'Auth' },
    { key: 'stops', icon: 'place', label: 'Stops' },
    { key: 'users', icon: 'people', label: 'Users' },
    { key: 'billing', icon: 'credit-card', label: 'Billing' },
    { key: 'analytics', icon: 'bar-chart', label: 'Analytics' },
  ];

  return (
    <ScreenContainer>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => (navigation as any).goBack()} style={styles.backButton}>
          <Icon name="arrow-back" size={24} color={PRIMARY_COLOR} />
        </TouchableOpacity>
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
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'billing' && <BillingTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
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
    height: 240,
  },
  stopsPanel: {
    flex: 1,
    padding: spacing.item,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 4,
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
    marginBottom: 8,
    overflow: 'hidden',
  },
  searchDropdownItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  searchDropdownText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  coordPreview: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: -4,
    marginBottom: 2,
  },
  addStopForm: {
    marginBottom: spacing.item,
    gap: 8,
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
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  addStopBtnDisabled: {
    opacity: 0.45,
  },
  addStopBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
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
    padding: spacing.item,
    gap: 6,
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
    paddingVertical: 6,
    gap: 8,
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
  planButton: {
    minWidth: 90,
  },
});
