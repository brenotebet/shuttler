// screens/NotificationPrefsScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Switch, ScrollView, ActivityIndicator, TouchableOpacity, Linking, AppState } from 'react-native';
import { Text } from '../components/Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import * as Notifications from 'expo-notifications';

import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import { db, auth } from '../firebase/firebaseconfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { showToast } from '../src/components/Toast';
import { spacing, borderRadius } from '../src/styles/common';

type NotifPrefs = {
  busArriving: boolean;
  requestCancelled: boolean;
  requestCompleted: boolean;
  newRequest: boolean;
  serviceAlerts: boolean;
};

const DEFAULTS: NotifPrefs = {
  busArriving: true,
  requestCancelled: true,
  requestCompleted: true,
  newRequest: true,
  serviceAlerts: true,
};

export default function NotificationPrefsScreen() {
  const { orgId, role } = useAuth();
  const { primaryColor } = useOrgTheme();
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permStatus, setPermStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null);

  const uid = auth.currentUser?.uid;

  const checkPermission = useCallback(async () => {
    const { status } = await Notifications.getPermissionsAsync();
    setPermStatus(status as 'granted' | 'denied' | 'undetermined');
  }, []);

  useEffect(() => {
    checkPermission();
    // Re-check when user comes back from Settings
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPermission();
    });
    return () => sub.remove();
  }, [checkPermission]);

  useEffect(() => {
    if (!orgId || !uid) return;
    getDoc(doc(db, 'orgs', orgId, 'users', uid))
      .then((snap) => {
        if (snap.exists()) {
          const stored = snap.data()?.notificationPrefs ?? {};
          setPrefs({ ...DEFAULTS, ...stored });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId, uid]);

  const toggle = async (key: keyof NotifPrefs, value: boolean) => {
    if (!orgId || !uid) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'orgs', orgId, 'users', uid),
        { notificationPrefs: next },
        { merge: true },
      );
    } catch {
      showToast('Failed to save preference.', 'error');
      setPrefs(prefs); // revert
    } finally {
      setSaving(false);
    }
  };

  const isDriver = role === 'driver' || role === 'admin';
  const isStudent = role === 'student' || role === 'parent';

  const studentRows: { key: keyof NotifPrefs; icon: string; title: string; desc: string }[] = [
    {
      key: 'busArriving',
      icon: 'directions-bus',
      title: 'Bus Arriving',
      desc: 'Notify me when the bus is a few minutes away and when it reaches my stop',
    },
    {
      key: 'requestCompleted',
      icon: 'check-circle',
      title: 'Pickup Completed',
      desc: 'Notify me when my pickup is marked complete',
    },
    {
      key: 'requestCancelled',
      icon: 'cancel',
      title: 'Request Cancelled',
      desc: 'Notify me when my stop request is cancelled',
    },
    {
      key: 'serviceAlerts',
      icon: 'campaign',
      title: 'Service Alerts',
      desc: 'Notify me about delays, detours, and service notices',
    },
  ];

  const driverRows: { key: keyof NotifPrefs; icon: string; title: string; desc: string }[] = [
    {
      key: 'newRequest',
      icon: 'notifications-active',
      title: 'New Stop Request',
      desc: 'Notify me when a student requests a pickup',
    },
    {
      key: 'serviceAlerts',
      icon: 'campaign',
      title: 'Service Alerts',
      desc: 'Notify me about delays, detours, and service notices',
    },
  ];

  const rows = isDriver ? driverRows : studentRows;

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Notifications" />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {permStatus === 'denied' && (
            <View style={styles.permBanner}>
              <Icon name="notifications-off" size={22} color="#92400e" style={{ flexShrink: 0 }} />
              <View style={styles.permBannerText}>
                <Text style={styles.permBannerTitle}>Notifications are disabled</Text>
                <Text style={styles.permBannerBody}>
                  You won't receive bus arrival alerts or pickup updates. Enable them in Settings.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.permBannerBtn}
                onPress={() => Linking.openSettings()}
              >
                <Text style={styles.permBannerBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.sectionLabel}>Push Notifications</Text>
          <Text style={styles.hint}>
            You'll always receive critical alerts. Toggle the optional ones below.
          </Text>

          <View style={styles.card}>
            {rows.map((row, i) => (
              <View
                key={row.key}
                style={[styles.row, i > 0 && styles.rowBorder]}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${primaryColor}15` }]}>
                  <Icon name={row.icon} size={20} color={primaryColor} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <Text style={styles.rowDesc}>{row.desc}</Text>
                </View>
                <Switch
                  value={prefs[row.key]}
                  onValueChange={(v) => toggle(row.key, v)}
                  trackColor={{ false: '#e5e7eb', true: `${primaryColor}60` }}
                  thumbColor={prefs[row.key] ? primaryColor : '#9ca3af'}
                  disabled={saving}
                />
              </View>
            ))}
          </View>

          {saving && (
            <Text style={styles.savingText}>Saving…</Text>
          )}

          <Text style={styles.footer}>
            Notification delivery also depends on your device's system settings. Make sure
            Shuttler notifications are enabled in your phone's Settings app.
          </Text>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.item,
    paddingBottom: spacing.section * 3,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 2 },
  rowDesc: { fontSize: 12, color: '#6b7280', lineHeight: 16 },
  savingText: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginBottom: 8 },
  footer: {
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  permBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: borderRadius.lg,
    padding: 14,
    marginBottom: 20,
  },
  permBannerText: { flex: 1 },
  permBannerTitle: { fontSize: 13, fontWeight: '700', color: '#92400e', marginBottom: 3 },
  permBannerBody: { fontSize: 12, color: '#78350f', lineHeight: 17 },
  permBannerBtn: {
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  permBannerBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
