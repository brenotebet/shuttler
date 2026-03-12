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
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import * as WebBrowser from 'expo-web-browser';
import { auth, db } from '../firebase/firebaseconfig';
import { useOrg, Stop, Route } from '../src/org/OrgContext';
import { SHUTTLER_API_URL } from '../config';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Tab = 'profile' | 'auth' | 'stops' | 'users' | 'billing';

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
  const mapRef = useRef<MapView>(null);
  const [stops, setStops] = useState<Stop[]>(org?.stops ?? []);
  const [routes, setRoutes] = useState<Route[]>(org?.routes ?? []);
  const hasOrgCenter = org?.mapCenter && (org.mapCenter.latitude !== 0 || org.mapCenter.longitude !== 0);
  const [mapCenter, setMapCenter] = useState(
    hasOrgCenter ? org!.mapCenter : { latitude: 39.5, longitude: -98.35 },
  );
  const [pendingName, setPendingName] = useState('');
  const [pendingLat, setPendingLat] = useState('');
  const [pendingLng, setPendingLng] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const pendingCoords =
    pendingLat && pendingLng &&
    !Number.isNaN(parseFloat(pendingLat)) && !Number.isNaN(parseFloat(pendingLng))
      ? { latitude: parseFloat(pendingLat), longitude: parseFloat(pendingLng) }
      : null;

  // Route editing state
  const [newRouteName, setNewRouteName] = useState('');
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);

  const handleMapPress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPendingLat(latitude.toFixed(6));
    setPendingLng(longitude.toFixed(6));
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
    const newStop: Stop = {
      id: `stop_${Date.now()}`,
      name: pendingName.trim(),
      latitude: pendingCoords.latitude,
      longitude: pendingCoords.longitude,
    };
    setStops((prev) => [...prev, newStop]);
    setPendingName('');
    setPendingLat('');
    setPendingLng('');
  }, [pendingCoords, pendingName]);

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
    setRoutes((prev) => [
      ...prev,
      { id: `route_${Date.now()}`, name: newRouteName.trim(), stopIds: [] },
    ]);
    setNewRouteName('');
    setShowRouteForm(false);
  }, [newRouteName]);

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
        <Text style={styles.sectionLabel}>Stops</Text>
        <Text style={styles.hint}>Tap the map to fill coordinates, or type them in directly.</Text>

        <View style={styles.addStopForm}>
          <TextInput
            style={styles.input}
            placeholder="Stop name"
            value={pendingName}
            onChangeText={setPendingName}
            placeholderTextColor="#aaa"
          />
          <View style={styles.coordRow}>
            <TextInput
              style={[styles.input, styles.coordInput]}
              placeholder="Latitude"
              value={pendingLat}
              onChangeText={setPendingLat}
              keyboardType="numeric"
              placeholderTextColor="#aaa"
            />
            <TextInput
              style={[styles.input, styles.coordInput]}
              placeholder="Longitude"
              value={pendingLng}
              onChangeText={setPendingLng}
              keyboardType="numeric"
              placeholderTextColor="#aaa"
            />
          </View>
          <TouchableOpacity
            style={[styles.addStopBtn, (!pendingName.trim() || !pendingCoords) && styles.addStopBtnDisabled]}
            onPress={handleAddStop}
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
          <TouchableOpacity onPress={() => setShowRouteForm(true)}>
            <Icon name="add-circle" size={24} color={PRIMARY_COLOR} />
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
};

const ROLE_LABELS: Record<string, string> = {
  student: 'Student',
  driver: 'Driver',
  admin: 'Admin',
};

const ROLE_COLORS: Record<string, string> = {
  student: '#3b82f6',
  driver: '#f59e0b',
  admin: PRIMARY_COLOR,
};

function UsersTab() {
  const { org } = useOrg();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setMembers(await res.json());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load members.');
    } finally {
      setIsLoading(false);
    }
  }, [org]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

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
        Tap a member's role badge to change it. All members start as Student after registering.
      </Text>
      {members.length === 0 && (
        <Text style={styles.hint}>No members yet. Share your org slug so people can register.</Text>
      )}
      {members.map((member) => (
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
          <TouchableOpacity
            style={[styles.roleBadge, { backgroundColor: `${ROLE_COLORS[member.role]}20` }]}
            onPress={() => handleChangeRole(member)}
          >
            <Text style={[styles.roleBadgeText, { color: ROLE_COLORS[member.role] }]}>
              {ROLE_LABELS[member.role]}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
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
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'profile', icon: 'business', label: 'Profile' },
    { key: 'auth', icon: 'lock', label: 'Auth' },
    { key: 'stops', icon: 'place', label: 'Stops' },
    { key: 'users', icon: 'people', label: 'Users' },
    { key: 'billing', icon: 'credit-card', label: 'Billing' },
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
  addStopForm: {
    marginBottom: spacing.item,
    gap: 8,
  },
  coordRow: {
    flexDirection: 'row',
    gap: 8,
  },
  coordInput: {
    flex: 1,
    marginBottom: 0,
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
