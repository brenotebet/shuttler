// screens/RoutesScreen.tsx
import React, { useState, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { Text } from '../components/Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';

import ScreenContainer from '../components/ScreenContainer';
import { useOrg } from '../src/org/OrgContext';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useAuth } from '../src/auth/AuthProvider';
import { spacing } from '../src/styles/common';
import { isRouteActive, getTodayScheduleText, getTodayKey } from '../src/utils/scheduleUtils';
import type { Route, WeekSchedule } from '../src/org/OrgContext';

const DAY_KEYS: (keyof WeekSchedule)[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];
const DAY_LABELS: Record<keyof WeekSchedule, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

function fmt12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function RouteCard({ route, stops, primaryColor, timezone }: {
  route: Route;
  stops: { id: string; name: string }[];
  primaryColor: string;
  timezone?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const open = isRouteActive(route, new Date(), timezone);
  const todayHours = route.schedule
    ? getTodayScheduleText(route, new Date(), timezone)
    : 'No schedule';
  const routeStops = (route.stopIds ?? [])
    .map((id) => stops.find((s) => s.id === id))
    .filter(Boolean) as { id: string; name: string }[];

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={[styles.routeIconWrap, { backgroundColor: `${primaryColor}15` }]}>
          <Icon name="directions-bus" size={20} color={primaryColor} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.routeName}>{route.name}</Text>
          <Text style={styles.todayHours}>{todayHours}</Text>
        </View>
        <View style={styles.cardRight}>
          {open ? (
            <View style={styles.openBadge}>
              <View style={styles.openDot} />
              <Text style={styles.openText}>Open</Text>
            </View>
          ) : (
            <View style={styles.closedBadge}>
              <Text style={styles.closedText}>Closed</Text>
            </View>
          )}
          <Icon
            name={expanded ? 'expand-less' : 'expand-more'}
            size={20}
            color="#9ca3af"
            style={{ marginLeft: 8 }}
          />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.cardBody}>
          {/* Stops */}
          {routeStops.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Stops ({routeStops.length})</Text>
              {routeStops.map((stop, i) => (
                <View key={stop.id} style={styles.stopRow}>
                  <View style={[styles.stopDot, { borderColor: primaryColor }]}>
                    {i === 0 && <View style={[styles.stopDotFill, { backgroundColor: primaryColor }]} />}
                  </View>
                  {i < routeStops.length - 1 && (
                    <View style={[styles.stopLine, { backgroundColor: `${primaryColor}30` }]} />
                  )}
                  <Text style={styles.stopName}>{stop.name}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Weekly schedule */}
          {route.schedule && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Weekly Schedule</Text>
              <View style={styles.scheduleGrid}>
                {DAY_KEYS.map((key) => {
                  const day = route.schedule![key];
                  const isToday = getTodayKey(new Date(), timezone) === key;
                  return (
                    <View
                      key={key}
                      style={[
                        styles.scheduleCell,
                        isToday && { backgroundColor: `${primaryColor}10`, borderColor: `${primaryColor}30` },
                        !day.isOpen && styles.scheduleCellClosed,
                      ]}
                    >
                      <Text style={[styles.scheduleDayLabel, isToday && { color: primaryColor, fontWeight: '700' }]}>
                        {DAY_LABELS[key]}
                      </Text>
                      {day.isOpen ? (
                        <>
                          <Text style={[styles.scheduleTime, isToday && { color: primaryColor }]}>
                            {fmt12h(day.open)}
                          </Text>
                          <Text style={styles.scheduleDash}>–</Text>
                          <Text style={[styles.scheduleTime, isToday && { color: primaryColor }]}>
                            {fmt12h(day.close)}
                          </Text>
                        </>
                      ) : (
                        <Text style={styles.scheduleClosed}>Closed</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {!route.schedule && routeStops.length === 0 && (
            <Text style={styles.noInfo}>No schedule or stops configured yet.</Text>
          )}
        </View>
      )}
    </View>
  );
}

export default function RoutesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const { role } = useAuth();
  const routes = org?.routes ?? [];
  const stops = org?.stops ?? [];

  const openCount = useMemo(
    () => routes.filter((r) => isRouteActive(r, new Date(), org?.timezone)).length,
    [routes, org?.timezone],
  );

  if (routes.length === 0) {
    const isAdmin = role === 'admin';
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: primaryColor }]}>Routes & Schedule</Text>
          <Text style={styles.subtitle}>{org?.name ?? ''}</Text>
        </View>
        <View style={styles.emptyState}>
          <Icon name="directions-bus" size={52} color="#d1d5db" style={{ marginBottom: 12 }} />
          <Text style={styles.emptyTitle}>No routes yet</Text>
          <Text style={styles.emptyBody}>
            {isAdmin
              ? 'Create a route in Org Setup to define the stop order your drivers follow.'
              : 'Your organization hasn\'t set up any routes yet. Check back later.'}
          </Text>
          {isAdmin && (
            <TouchableOpacity
              style={[styles.emptyBtn, { borderColor: primaryColor }]}
              onPress={() => navigation.navigate('AdminOrgSetup', { initialTab: 'stops' })}
            >
              <Icon name="add-road" size={16} color={primaryColor} />
              <Text style={[styles.emptyBtnText, { color: primaryColor }]}>Set Up Routes</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: primaryColor }]}>Routes & Schedule</Text>
          <Text style={styles.subtitle}>{org?.name ?? ''}</Text>
          {openCount > 0 && (
            <View style={styles.openSummary}>
              <View style={styles.openDot} />
              <Text style={styles.openSummaryText}>
                {openCount} route{openCount !== 1 ? 's' : ''} currently running
              </Text>
            </View>
          )}
        </View>

        <View style={styles.list}>
          {routes.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              stops={stops}
              primaryColor={primaryColor}
              timezone={org?.timezone}
            />
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.section * 3,
    paddingBottom: spacing.section * 2,
  },
  header: { marginBottom: spacing.section },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#6b7280' },
  openSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  openSummaryText: { fontSize: 13, color: '#16a34a', fontWeight: '600' },
  list: { gap: 12, paddingBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  routeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderText: { flex: 1 },
  routeName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  todayHours: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  cardRight: { flexDirection: 'row', alignItems: 'center' },
  openBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  openDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#16a34a',
  },
  openText: { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  closedBadge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closedText: { fontSize: 11, fontWeight: '600', color: '#9ca3af' },
  cardBody: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    padding: 16,
    gap: 16,
  },
  section: { gap: 10 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: 8,
    position: 'relative',
    minHeight: 28,
  },
  stopDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    marginRight: 10,
    marginTop: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  stopDotFill: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stopLine: {
    position: 'absolute',
    left: 14,
    top: 16,
    bottom: -14,
    width: 2,
  },
  stopName: { fontSize: 14, color: '#374151', flex: 1, lineHeight: 20 },
  scheduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  scheduleCell: {
    flex: 1,
    minWidth: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 6,
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  scheduleCellClosed: { opacity: 0.45 },
  scheduleDayLabel: { fontSize: 10, fontWeight: '600', color: '#6b7280', marginBottom: 3 },
  scheduleTime: { fontSize: 10, color: '#374151', fontWeight: '500' },
  scheduleDash: { fontSize: 9, color: '#9ca3af' },
  scheduleClosed: { fontSize: 9, color: '#9ca3af', fontStyle: 'italic', marginTop: 2 },
  noInfo: { fontSize: 13, color: '#9ca3af', textAlign: 'center', paddingVertical: 8 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#374151' },
  emptyBody: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  emptyBtnText: { fontSize: 14, fontWeight: '600' },
});
