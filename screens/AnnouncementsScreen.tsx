// screens/AnnouncementsScreen.tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text } from '../components/Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';

import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import AppButton from '../components/AppButton';
import FormField from '../components/FormField';
import { db, auth } from '../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../config';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { showToast } from '../src/components/Toast';
import { showAlert } from '../src/utils/alerts';
import { containsProfanity } from '../src/utils/profanity';
import { spacing, borderRadius } from '../src/styles/common';
import type { AnnouncementSeverity } from '../src/hooks/useAnnouncements';
import {
  DANGER_COLOR,
  WHITE,
  GRAY_200,
  GRAY_400,
  GRAY_500,
  GRAY_600,
  GRAY_800,
  GRAY_900,
} from '../src/constants/theme';

interface ActiveAlert {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  createdAt: Date | null;
  expiresAt: Date | null;
  createdByName: string | null;
}

const SEVERITY_OPTIONS: { value: AnnouncementSeverity; label: string; icon: string; color: string }[] = [
  { value: 'info', label: 'Notice', icon: 'campaign', color: '#2563eb' },
  { value: 'warning', label: 'Delay', icon: 'warning-amber', color: '#d97706' },
  { value: 'alert', label: 'Urgent', icon: 'error-outline', color: DANGER_COLOR },
];

const DURATION_OPTIONS: { value: number | null; label: string }[] = [
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 720, label: '12 hours' },
  { value: null, label: 'Until cleared' },
];

export default function AnnouncementsScreen() {
  const { orgId } = useAuth();
  const { primaryColor } = useOrgTheme();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info');
  const [durationMinutes, setDurationMinutes] = useState<number | null>(60);
  const [posting, setPosting] = useState(false);

  const [activeAlerts, setActiveAlerts] = useState<ActiveAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [clearingId, setClearingId] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, 'orgs', orgId, 'announcements'), where('active', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      const items: ActiveAlert[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title ?? '',
          body: data.body ?? '',
          severity: (['info', 'warning', 'alert'].includes(data.severity) ? data.severity : 'info') as AnnouncementSeverity,
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
          expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : null,
          createdByName: data.createdByName ?? null,
        };
      });
      items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      setActiveAlerts(items);
      setLoadingAlerts(false);
    }, () => setLoadingAlerts(false));
    return () => unsub();
  }, [orgId]);

  const post = async () => {
    if (!title.trim() || posting) return;
    if (containsProfanity(title) || containsProfanity(body)) {
      showAlert('This alert contains inappropriate language. Please revise it before posting.', 'Inappropriate content', 'error');
      return;
    }
    setPosting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${SHUTTLER_API_URL}/announcements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          severity,
          ...(durationMinutes ? { durationMinutes } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to post alert');
      setTitle('');
      setBody('');
      showToast(`Alert posted — ${data.sent} rider${data.sent === 1 ? '' : 's'} notified.`, 'success');
    } catch (e: any) {
      showAlert(e?.message ?? 'Failed to post the alert. Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const clearAlert = async (id: string) => {
    if (clearingId) return;
    setClearingId(id);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${SHUTTLER_API_URL}/announcements/${id}/deactivate`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to clear alert');
      }
      showToast('Alert cleared.', 'success');
    } catch (e: any) {
      showAlert(e?.message ?? 'Failed to clear the alert. Please try again.');
    } finally {
      setClearingId(null);
    }
  };

  const severityMeta = (s: AnnouncementSeverity) =>
    SEVERITY_OPTIONS.find((o) => o.value === s) ?? SEVERITY_OPTIONS[0];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenContainer padded={false}>
        <HeaderBar title="Service Alerts" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>Post an Alert</Text>
          <Text style={styles.hint}>
            Riders see this instantly as a banner on their live map and get a push notification.
          </Text>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.chipRow}>
              {SEVERITY_OPTIONS.map((opt) => {
                const selected = severity === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, selected && { backgroundColor: `${opt.color}15`, borderColor: opt.color }]}
                    onPress={() => setSeverity(opt.value)}
                  >
                    <Icon name={opt.icon} size={16} color={selected ? opt.color : GRAY_500} />
                    <Text style={[styles.chipText, selected && { color: opt.color, fontWeight: '700' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <FormField
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Main Loop running 15 min late"
              maxLength={80}
            />
            <FormField
              label="Details (optional)"
              value={body}
              onChangeText={setBody}
              placeholder="What riders should do"
              multiline
              maxLength={300}
              style={styles.detailsInput}
            />

            <Text style={styles.fieldLabel}>Show for</Text>
            <View style={styles.chipRow}>
              {DURATION_OPTIONS.map((opt) => {
                const selected = durationMinutes === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.chip, selected && { backgroundColor: `${primaryColor}15`, borderColor: primaryColor }]}
                    onPress={() => setDurationMinutes(opt.value)}
                  >
                    <Text style={[styles.chipText, selected && { color: primaryColor, fontWeight: '700' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <AppButton
              label={posting ? 'Posting…' : 'Post Alert'}
              onPress={post}
              disabled={!title.trim() || posting}
              style={{ marginTop: 14 }}
            />
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>Active Alerts</Text>
          {loadingAlerts ? (
            <ActivityIndicator color={primaryColor} style={{ marginTop: 16 }} />
          ) : activeAlerts.length === 0 ? (
            <View style={styles.emptyCard}>
              <Icon name="check-circle-outline" size={28} color={GRAY_400} />
              <Text style={styles.emptyText}>No active alerts — service is running normally.</Text>
            </View>
          ) : (
            activeAlerts.map((a) => {
              const meta = severityMeta(a.severity);
              const expired = !!a.expiresAt && a.expiresAt.getTime() <= Date.now();
              return (
                <View key={a.id} style={styles.alertCard}>
                  <Icon name={meta.icon} size={20} color={meta.color} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertTitle}>{a.title}</Text>
                    {a.body ? <Text style={styles.alertBody}>{a.body}</Text> : null}
                    <Text style={styles.alertMeta}>
                      {a.createdByName ? `By ${a.createdByName} · ` : ''}
                      {expired
                        ? 'Expired'
                        : a.expiresAt
                          ? `Until ${a.expiresAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                          : 'Until cleared'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.clearBtn, { borderColor: `${primaryColor}50` }]}
                    onPress={() => clearAlert(a.id)}
                    disabled={clearingId === a.id}
                  >
                    {clearingId === a.id ? (
                      <ActivityIndicator size="small" color={primaryColor} />
                    ) : (
                      <Text style={[styles.clearBtnText, { color: primaryColor }]}>Clear</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.item,
    paddingBottom: spacing.section * 3,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: GRAY_400,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    color: GRAY_500,
    marginBottom: 16,
    lineHeight: 18,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: GRAY_200,
    padding: 14,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderColor: GRAY_200,
    borderRadius: borderRadius.xl,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: WHITE,
  },
  chipText: { fontSize: 13, color: GRAY_500, fontWeight: '600' },
  // Matches FormField's label so all fields in the card read as one form.
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: GRAY_800,
    marginBottom: 6,
  },
  detailsInput: {
    height: 90,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: WHITE,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: GRAY_200,
    padding: 24,
  },
  emptyText: { fontSize: 13, color: GRAY_500, textAlign: 'center' },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: WHITE,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: GRAY_200,
    padding: 14,
    marginBottom: 10,
  },
  alertTitle: { fontSize: 14, fontWeight: '700', color: GRAY_900 },
  alertBody: { fontSize: 13, color: GRAY_600, marginTop: 2, lineHeight: 18 },
  alertMeta: { fontSize: 11, color: GRAY_400, marginTop: 5 },
  clearBtn: {
    borderWidth: 1.5,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  clearBtnText: { fontSize: 13, fontWeight: '700' },
});
