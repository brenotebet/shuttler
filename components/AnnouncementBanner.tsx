// components/AnnouncementBanner.tsx
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Text } from './Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAnnouncements, AnnouncementSeverity } from '../src/hooks/useAnnouncements';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

const DISMISSED_KEY = 'dismissedAnnouncementIds';
const MAX_REMEMBERED = 50;

const SEVERITY_STYLES: Record<AnnouncementSeverity, { bg: string; border: string; fg: string; icon: string }> = {
  info: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1d4ed8', icon: 'campaign' },
  warning: { bg: '#fffbeb', border: '#fcd34d', fg: '#92400e', icon: 'warning-amber' },
  alert: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c', icon: 'error-outline' },
};

export type AnnouncementBannerProps = {
  orgId: string | null | undefined;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shows the newest active service alert for the org. Dismissing hides that
 * specific alert on this device only (persisted), so a new alert still appears.
 */
export default function AnnouncementBanner({ orgId, style }: AnnouncementBannerProps) {
  const announcements = useAnnouncements(orgId);
  const [dismissedIds, setDismissedIds] = useState<string[] | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((raw) => setDismissedIds(raw ? JSON.parse(raw) : []))
      .catch(() => setDismissedIds([]));
  }, []);

  // Wait for dismissed ids to load so the banner doesn't flash in and out.
  if (dismissedIds === null) return null;

  const current = announcements.find((a) => !dismissedIds.includes(a.id));
  if (!current) return null;

  const colors = SEVERITY_STYLES[current.severity];

  const dismiss = () => {
    const next = [...dismissedIds, current.id].slice(-MAX_REMEMBERED);
    setDismissedIds(next);
    AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next)).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, borderColor: colors.border }, style]}>
      <Icon name={colors.icon} size={22} color={colors.fg} style={styles.icon} />
      <View style={styles.textWrapper}>
        <Text style={[styles.title, { color: colors.fg }]}>{current.title}</Text>
        {current.body ? <Text style={[styles.body, { color: colors.fg }]}>{current.body}</Text> : null}
      </View>
      <TouchableOpacity onPress={dismiss} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Icon name="close" size={18} color={colors.fg} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.item,
    ...cardShadow,
  },
  icon: { marginRight: 10, marginTop: 1 },
  textWrapper: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 18, opacity: 0.9 },
  closeBtn: { marginLeft: 8, padding: 2 },
});
