// screens/RoutesScreen.tsx
//
// Routes tab (students, parents, drivers). Pick a route, see its stops on a
// map and as a timeline with live bus positions, and (riders only) tap a
// stop to request a pickup there.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { Text } from '../components/Text';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { collection, onSnapshot } from 'firebase/firestore';

import ScreenContainer from '../components/ScreenContainer';
import { db } from '../firebase/firebaseconfig';
import { useOrg } from '../src/org/OrgContext';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { useAuth } from '../src/auth/AuthProvider';
import { spacing, borderRadius, cardShadow } from '../src/styles/common';
import {
  isRouteActive,
  getTodayKey,
  getRunsUntilText,
  getNextOpenText,
  getTodayScheduleText,
} from '../src/utils/scheduleUtils';
import { getBusRouteProgress } from '../src/utils/busRoute';
import { decodePath } from '../src/utils/routePath';
import { STALE_WINDOW_SECONDS } from '../src/constants/stops';
import type { Route, Stop, WeekSchedule } from '../src/org/OrgContext';
import {
  WHITE,
  GRAY_50,
  GRAY_100,
  GRAY_200,
  GRAY_300,
  GRAY_400,
  GRAY_500,
  GRAY_700,
  GRAY_900,
} from '../src/constants/theme';

const DAY_KEYS: (keyof WeekSchedule)[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];
const DAY_LABELS: Record<keyof WeekSchedule, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

function fmt12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

type LiveBus = { id: string; latitude: number; longitude: number; routeId: string | null; onBreak: boolean };

// Live buses for the org, only while this tab is on screen. Same freshness
// rule as the rider map: online and updated within STALE_WINDOW_SECONDS.
function useLiveBuses(orgId: string | null | undefined, enabled: boolean): LiveBus[] {
  const [buses, setBuses] = useState<LiveBus[]>([]);
  useEffect(() => {
    if (!orgId || !enabled) return;
    return onSnapshot(
      collection(db, 'orgs', orgId, 'buses'),
      (snap) => {
        const now = Date.now();
        const live: LiveBus[] = [];
        snap.docs.forEach((d) => {
          const data = d.data({ serverTimestamps: 'estimate' }) as any;
          const ms = data?.updatedAt?.toMillis?.() ?? data?.lastSeen?.toMillis?.() ?? 0;
          if (data?.online !== true || (now - ms) / 1000 > STALE_WINDOW_SECONDS) return;
          if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return;
          live.push({
            id: d.id,
            latitude: data.latitude,
            longitude: data.longitude,
            routeId: typeof data.routeId === 'string' ? data.routeId : null,
            onBreak: data.onBreak === true,
          });
        });
        setBuses(live);
      },
      (err) => console.error('RoutesScreen buses snapshot error', err),
    );
  }, [orgId, enabled]);
  return buses;
}

export default function RoutesScreen() {
  const navigation = useNavigation<any>();
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const { role, orgId } = useAuth();
  const isFocused = useIsFocused();
  const routes = org?.routes ?? [];
  const allStops = org?.stops ?? [];
  const canRequest = role === 'student' || role === 'parent';

  // Re-evaluate open/closed each minute while on screen.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!isFocused) return;
    const t = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [isFocused]);
  const now = new Date(clock);

  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [showHours, setShowHours] = useState(false);
  const selectedRoute: Route | null =
    routes.find((r) => r.id === selectedRouteId) ??
    routes.find((r) => isRouteActive(r, now, org?.timezone)) ??
    routes[0] ??
    null;

  const liveBuses = useLiveBuses(orgId ?? org?.orgId, isFocused);

  const routeStops: Stop[] = useMemo(
    () => (selectedRoute?.stopIds ?? [])
      .map((id) => allStops.find((s) => s.id === id))
      .filter((s): s is Stop => !!s),
    [selectedRoute?.stopIds, allStops],
  );

  // Where each bus on this route is: at a stop, or heading to one.
  const busMarks = useMemo(() => {
    const at: Record<number, number> = {};
    const toward: Record<number, number> = {};
    let onBreak = 0;
    const onRoute = liveBuses.filter((b) => selectedRoute && b.routeId === selectedRoute.id);
    onRoute.forEach((b) => {
      if (b.onBreak) { onBreak += 1; return; }
      const p = getBusRouteProgress(routeStops, b, 1);
      if (!p) return;
      if (p.atStop) {
        const idx = routeStops.findIndex((s) => s.name === p.atStop);
        if (idx >= 0) at[idx] = (at[idx] ?? 0) + 1;
      } else {
        const idx = p.nextPosition - 1;
        toward[idx] = (toward[idx] ?? 0) + 1;
      }
    });
    return { at, toward, total: onRoute.length, onBreak };
  }, [liveBuses, selectedRoute, routeStops]);

  const roadPath = useMemo(() => decodePath(selectedRoute?.path), [selectedRoute?.path]);

  const mapRef = useRef<MapView>(null);
  const fitMap = useCallback(() => {
    if (routeStops.length === 0) return;
    mapRef.current?.fitToCoordinates(
      [...routeStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })), ...roadPath],
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false },
    );
  }, [routeStops, roadPath]);

  const requestStop = (stop: Stop) => {
    navigation.navigate('Map', { focusStopId: stop.id, focusStopName: stop.name });
  };

  if (routes.length === 0 || !selectedRoute) {
    const isAdmin = role === 'admin';
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: primaryColor }]}>Routes</Text>
          <Text style={styles.subtitle}>{org?.name ?? ''}</Text>
        </View>
        <View style={styles.emptyState}>
          <Icon name="directions-bus" size={52} color={GRAY_300} style={{ marginBottom: 12 }} />
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

  const open = isRouteActive(selectedRoute, now, org?.timezone);
  const statusText = open
    ? getRunsUntilText(selectedRoute, now, org?.timezone) || 'Running now'
    : selectedRoute.schedule
      ? getNextOpenText(selectedRoute, now, org?.timezone) || 'Not running now'
      : 'Not running now';
  const busText = !open
    ? null
    : busMarks.total === 0
      ? 'No buses on this route right now'
      : `${busMarks.total} bus${busMarks.total === 1 ? '' : 'es'} on this route${busMarks.onBreak > 0 ? ` · ${busMarks.onBreak} on break` : ''}`;
  const todayKey = getTodayKey(now, org?.timezone);

  return (
    <ScreenContainer style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: primaryColor }]}>Routes</Text>
          <Text style={styles.subtitle}>{org?.name ?? ''}</Text>
        </View>

        {/* Route picker — only when there's more than one */}
        {routes.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {routes.map((r) => {
              const active = r.id === selectedRoute.id;
              const running = isRouteActive(r, now, org?.timezone);
              return (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => { setSelectedRouteId(r.id); setShowHours(false); }}
                  style={[styles.chip, active && { backgroundColor: primaryColor, borderColor: primaryColor }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.chipDot, { backgroundColor: running ? '#22c55e' : GRAY_300 }]} />
                  <Text style={[styles.chipText, active && { color: WHITE }]}>{r.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.card}>
          {/* Name + status */}
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeName}>{selectedRoute.name}</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: open ? '#22c55e' : GRAY_300 }]} />
                <Text style={[styles.statusText, open && { color: '#15803d' }]}>
                  {open ? 'Running' : 'Not running'} · {statusText}
                </Text>
              </View>
              {busText && <Text style={styles.busText}>{busText}</Text>}
            </View>
          </View>

          {/* Map of the route — remounted per route so markers never get reused across routes */}
          {routeStops.length > 0 && (
            <MapView
              key={selectedRoute.id}
              ref={mapRef}
              style={styles.map}
              onMapReady={fitMap}
              pitchEnabled={false}
              rotateEnabled={false}
              toolbarEnabled={false}
            >
              {roadPath.length >= 2 && (
                <Polyline coordinates={roadPath} strokeColor={primaryColor} strokeWidth={4} />
              )}
              {routeStops.map((s, i) => (
                <Marker
                  key={`${selectedRoute.id}-${s.id}`}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  title={`${i + 1}. ${s.name}`}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                >
                  <View style={[styles.mapPin, { backgroundColor: primaryColor }]}>
                    <Text style={styles.mapPinText}>{i + 1}</Text>
                  </View>
                </Marker>
              ))}
            </MapView>
          )}

          {/* Stop timeline */}
          <Text style={styles.sectionLabel}>Stops in order</Text>
          {canRequest && routeStops.length > 0 && (
            <Text style={styles.sectionHint}>Tap a stop to request a pickup there.</Text>
          )}
          {routeStops.length === 0 && (
            <Text style={styles.noInfo}>No stops on this route yet.</Text>
          )}
          {routeStops.map((stop, i) => {
            const atCount = busMarks.at[i] ?? 0;
            const towardCount = busMarks.toward[i] ?? 0;
            const isLast = i === routeStops.length - 1;
            const Row: any = canRequest ? TouchableOpacity : View;
            return (
              <Row
                key={stop.id}
                style={styles.timelineRow}
                {...(canRequest ? { onPress: () => requestStop(stop), activeOpacity: 0.6, accessibilityRole: 'button', accessibilityHint: 'Opens the map to request a pickup here' } : {})}
              >
                <View style={styles.rail}>
                  <View style={[styles.railLine, { backgroundColor: i === 0 ? 'transparent' : `${primaryColor}40` }]} />
                  <View style={[styles.railDot, { borderColor: primaryColor }, atCount > 0 && { backgroundColor: primaryColor }]}>
                    {atCount > 0 && <Icon name="directions-bus" size={11} color={WHITE} />}
                  </View>
                  <View style={[styles.railLine, { backgroundColor: isLast ? 'transparent' : `${primaryColor}40` }]} />
                </View>
                <View style={styles.timelineBody}>
                  <Text style={styles.timelineStop} numberOfLines={2}>{stop.name}</Text>
                  {atCount > 0 ? (
                    <Text style={[styles.timelineTag, { color: primaryColor }]}>Bus here now</Text>
                  ) : towardCount > 0 ? (
                    <Text style={[styles.timelineTag, { color: '#b45309' }]}>Bus on the way</Text>
                  ) : isLast && routeStops.length > 1 ? (
                    <Text style={styles.timelineHint}>Then back to {routeStops[0].name}</Text>
                  ) : null}
                </View>
                {canRequest && <Icon name="chevron-right" size={20} color={GRAY_400} />}
              </Row>
            );
          })}

          {/* Hours */}
          {selectedRoute.schedule && (
            <>
              <TouchableOpacity style={styles.hoursToggle} onPress={() => setShowHours((v) => !v)}>
                <Icon name="schedule" size={16} color={GRAY_500} />
                <Text style={styles.hoursToggleText}>
                  {getTodayScheduleText(selectedRoute, now, org?.timezone)}
                </Text>
                <Text style={[styles.hoursToggleLink, { color: primaryColor }]}>
                  {showHours ? 'Hide week' : 'See week'}
                </Text>
              </TouchableOpacity>
              {showHours && DAY_KEYS.map((key) => {
                const day = selectedRoute.schedule![key];
                const isToday = key === todayKey;
                return (
                  <View key={key} style={[styles.hoursRow, isToday && { backgroundColor: `${primaryColor}0d` }]}>
                    <Text style={[styles.hoursDay, isToday && { color: primaryColor, fontWeight: '700' }]}>
                      {DAY_LABELS[key]}{isToday ? ' (today)' : ''}
                    </Text>
                    <Text style={[styles.hoursTime, !day.isOpen && { color: GRAY_400, fontStyle: 'italic' }]}>
                      {day.isOpen ? `${fmt12h(day.open)} – ${fmt12h(day.close)}` : 'Closed'}
                    </Text>
                  </View>
                );
              })}
            </>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.section * 3,
  },
  header: { marginBottom: spacing.section },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 14, color: GRAY_500 },
  chips: { gap: 8, paddingBottom: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderColor: GRAY_200,
    backgroundColor: WHITE,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 14, fontWeight: '600', color: GRAY_700 },
  card: {
    backgroundColor: WHITE,
    borderRadius: borderRadius.lg,
    padding: 16,
    ...cardShadow,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  routeName: { fontSize: 20, fontWeight: '700', color: GRAY_900 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 14, fontWeight: '600', color: GRAY_500, flexShrink: 1 },
  busText: { fontSize: 13, color: GRAY_500, marginTop: 3 },
  map: { height: 200, borderRadius: borderRadius.md, marginBottom: 14 },
  mapPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: WHITE,
  },
  mapPinText: { color: WHITE, fontSize: 11, fontWeight: '800' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: GRAY_500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  sectionHint: { fontSize: 13, color: GRAY_500, marginTop: -2, marginBottom: 6 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  rail: { width: 28, alignItems: 'center', alignSelf: 'stretch' },
  railLine: { width: 2, flex: 1 },
  railDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineBody: { flex: 1, paddingVertical: 8, paddingLeft: 10 },
  timelineStop: { fontSize: 15, fontWeight: '600', color: GRAY_900 },
  timelineTag: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  timelineHint: { fontSize: 12, color: GRAY_400, marginTop: 2 },
  hoursToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: GRAY_100,
  },
  hoursToggleText: { flex: 1, fontSize: 14, color: GRAY_700, fontWeight: '500' },
  hoursToggleLink: { fontSize: 13, fontWeight: '700' },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: borderRadius.sm,
  },
  hoursDay: { fontSize: 14, color: GRAY_700 },
  hoursTime: { fontSize: 14, color: GRAY_900, fontWeight: '500' },
  noInfo: { fontSize: 13, color: GRAY_400, paddingVertical: 8 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: GRAY_700 },
  emptyBody: { fontSize: 14, color: GRAY_500, textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 8,
    backgroundColor: GRAY_50,
  },
  emptyBtnText: { fontSize: 14, fontWeight: '600' },
});
