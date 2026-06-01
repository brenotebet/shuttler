// screens/AdminAnalyticsScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { useOrg } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { showToast } from '../src/components/Toast';
import { SHUTTLER_API_URL } from '../config';
import { cardShadow, spacing } from '../src/styles/common';
import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import AppButton from '../components/AppButton';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Tab = 'insights' | 'analytics';

async function getBearerToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

// ---- Insights ----

interface OrgInsight {
  narrative: string;
  totalBoardings: number;
  activeDrivers: number;
  topStop: string | null;
  generatedAt: any;
}

function InsightsSection() {
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [weekly, setWeekly] = useState<OrgInsight | null>(null);
  const [monthly, setMonthly] = useState<OrgInsight | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState<'weekly' | 'monthly' | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    setIsLoading(true);
    try {
      const [wSnap, mSnap] = await Promise.all([
        getDoc(doc(db, 'orgs', org.orgId, 'insights', 'weekly')),
        getDoc(doc(db, 'orgs', org.orgId, 'insights', 'monthly')),
      ]);
      setWeekly(wSnap.exists() ? (wSnap.data() as OrgInsight) : null);
      setMonthly(mSnap.exists() ? (mSnap.data() as OrgInsight) : null);
    } finally {
      setIsLoading(false);
    }
  }, [org?.orgId]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (period: 'weekly' | 'monthly') => {
    if (!org) return;
    setIsGenerating(period);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/ai/generate-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: org.orgId, period }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? 'Failed to generate insight');
      }
      if (!body?.generated) {
        showToast(
          `No ${period === 'weekly' ? 'weekly' : 'monthly'} data yet — insights will generate automatically once rides are logged.`,
          'error',
        );
        return;
      }
      await load();
      showToast('Insight generated.', 'success');
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to generate insight.', 'error');
    } finally {
      setIsGenerating(null);
    }
  }, [org, load]);

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={primaryColor} />
      </View>
    );
  }

  const renderCard = (period: 'weekly' | 'monthly', insight: OrgInsight | null) => {
    const label = period === 'weekly' ? 'Weekly' : 'Monthly';
    const dateStr = insight?.generatedAt?.toDate?.()?.toLocaleDateString([], {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    return (
      <View style={s.card} key={period}>
        <View style={s.cardHeader}>
          <Text style={s.cardTitle}>{label} Insight</Text>
          {dateStr && <Text style={s.cardDate}>Updated {dateStr}</Text>}
        </View>
        {insight ? (
          <>
            <View style={s.statsRow}>
              <View style={s.statItem}>
                <Text style={[s.statValue, { color: primaryColor }]}>{insight.totalBoardings}</Text>
                <Text style={s.statLabel}>Boardings</Text>
              </View>
              <View style={s.statItem}>
                <Text style={[s.statValue, { color: primaryColor }]}>{insight.activeDrivers}</Text>
                <Text style={s.statLabel}>Active Drivers</Text>
              </View>
              {insight.topStop && (
                <View style={[s.statItem, { flex: 2 }]}>
                  <Text style={[s.statValue, { color: primaryColor, fontSize: 13 }]} numberOfLines={1}>
                    {insight.topStop.split(' (')[0]}
                  </Text>
                  <Text style={s.statLabel}>Top Stop</Text>
                </View>
              )}
            </View>
            <Text style={s.narrative}>{insight.narrative}</Text>
          </>
        ) : (
          <Text style={s.emptyText}>No {label.toLowerCase()} insight yet — generate one below.</Text>
        )}
        <TouchableOpacity
          style={[s.generateBtn, { borderColor: primaryColor }]}
          onPress={() => generate(period)}
          disabled={isGenerating === period}
        >
          {isGenerating === period ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : (
            <>
              <Icon name="auto-awesome" size={16} color={primaryColor} />
              <Text style={[s.generateBtnText, { color: primaryColor }]}>Generate now</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={s.scrollContent}>
      <Text style={s.intro}>
        AI-generated summaries of your operation, updated automatically each week and month.
      </Text>
      {renderCard('weekly', weekly)}
      {renderCard('monthly', monthly)}
    </ScrollView>
  );
}

// ---- Analytics (gated) ----

interface BoardingCount {
  id: string;
  driverUid: string;
  stopId: string;
  stopName: string;
  count: number;
  createdAt: any;
}

function AnalyticsSection() {
  const { org, refreshOrg } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [records, setRecords] = useState<BoardingCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [isUpgrading, setIsUpgrading] = useState(false);

  // Upsell flow
  const openAddonCheckout = useCallback(async () => {
    if (!org) return;
    setIsUpgrading(true);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/billing/create-addon-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: org.orgId, returnUrl: 'shuttler://billing' }),
      });
      const { url, error: err } = await res.json();
      if (err) throw new Error(err);
      await WebBrowser.openAuthSessionAsync(url, 'shuttler://billing');
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await refreshOrg();
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to open billing.', 'error');
    } finally {
      setIsUpgrading(false);
    }
  }, [org, refreshOrg]);

  useEffect(() => {
    if (!org?.dataAddonActive) return;
    const load = async () => {
      try {
        setIsLoading(true);
        const q = query(collection(db, 'orgs', org.orgId, 'boardingCounts'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        setRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BoardingCount, 'id'>) })));
      } catch (e: any) {
        setError(e.message ?? 'Failed to load analytics');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [org?.orgId, org?.dataAddonActive]);

  useEffect(() => {
    if (!org || records.length === 0) return;
    const uids = [...new Set(records.map((r) => r.driverUid).filter(Boolean))];
    Promise.all(
      uids.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'orgs', org.orgId, 'publicUsers', uid));
          const name: string = snap.data()?.displayName ?? '';
          return [uid, name.split(' ')[0] || uid.slice(0, 8)] as const;
        } catch {
          return [uid, uid.slice(0, 8)] as const;
        }
      }),
    ).then((pairs) => setDriverNames(Object.fromEntries(pairs)));
  }, [records, org?.orgId]);

  if (!org?.dataAddonActive) {
    return (
      <View style={s.upsellContainer}>
        <Icon name="lock" size={40} color="#d1d5db" />
        <Text style={s.upsellTitle}>Raw Data Analytics</Text>
        <Text style={s.upsellBody}>
          Access full boarding records, stop logs, driver stats, and more — everything collected, all in one place.
        </Text>
        <View style={s.featureList}>
          {['All boarding records', 'Per-driver performance', 'Stop-by-stop breakdown', 'Recent activity log'].map((f) => (
            <View key={f} style={s.featureRow}>
              <Icon name="check-circle" size={16} color={primaryColor} />
              <Text style={s.featureText}>{f}</Text>
            </View>
          ))}
        </View>
        <View style={s.priceBox}>
          <Text style={[s.price, { color: primaryColor }]}>$49<Text style={s.priceSub}>/mo</Text></Text>
          <Text style={s.priceNote}>Add-on to any plan</Text>
        </View>
        <AppButton
          label={isUpgrading ? '…' : 'Add Data Analytics — $49/mo'}
          onPress={openAddonCheckout}
          disabled={isUpgrading}
          style={[s.upgradeBtn, { backgroundColor: primaryColor }]}
        />
      </View>
    );
  }

  if (isLoading) return <View style={s.center}><ActivityIndicator size="large" color={primaryColor} /></View>;
  if (error) return <View style={s.center}><Text style={s.errorText}>{error}</Text></View>;
  if (records.length === 0) return (
    <View style={s.center}>
      <Text style={s.emptyText}>No boarding data yet.</Text>
      <Text style={s.emptySubtext}>Data will appear here once drivers start recording pickups.</Text>
    </View>
  );

  const stopMap = new Map<string, { name: string; total: number }>();
  const driverMap = new Map<string, { name: string; total: number }>();
  let totalBoarded = 0;

  records.forEach((r) => {
    totalBoarded += r.count ?? 0;
    const sEntry = stopMap.get(r.stopId) ?? { name: r.stopName ?? r.stopId, total: 0 };
    sEntry.total += r.count ?? 0;
    stopMap.set(r.stopId, sEntry);
    if (r.driverUid) {
      const dEntry = driverMap.get(r.driverUid) ?? { name: driverNames[r.driverUid] ?? r.driverUid.slice(0, 8), total: 0 };
      dEntry.total += r.count ?? 0;
      dEntry.name = driverNames[r.driverUid] ?? dEntry.name;
      driverMap.set(r.driverUid, dEntry);
    }
  });

  const topStops = [...stopMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const topDrivers = [...driverMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);

  return (
    <ScrollView contentContainerStyle={s.scrollContent}>
      <View style={s.summaryRow}>
        <View style={[s.summaryCard, { flex: 1 }]}>
          <Text style={[s.summaryValue, { color: primaryColor }]}>{totalBoarded}</Text>
          <Text style={s.summaryLabel}>Total Boarded</Text>
        </View>
        <View style={[s.summaryCard, { flex: 1 }]}>
          <Text style={[s.summaryValue, { color: primaryColor }]}>{stopMap.size}</Text>
          <Text style={s.summaryLabel}>Active Stops</Text>
        </View>
        <View style={[s.summaryCard, { flex: 1 }]}>
          <Text style={[s.summaryValue, { color: primaryColor }]}>{driverMap.size}</Text>
          <Text style={s.summaryLabel}>Active Drivers</Text>
        </View>
      </View>

      <Text style={s.sectionTitle}>Busiest Stops</Text>
      <View style={s.listCard}>
        {topStops.map(([stopId, { name, total }], i) => (
          <View key={stopId} style={[s.listRow, i > 0 && s.listRowBorder]}>
            <View style={s.rankBadge}><Text style={s.rankText}>{i + 1}</Text></View>
            <Text style={s.listLabel} numberOfLines={1}>{name}</Text>
            <Text style={s.listValue}>{total} boarded</Text>
          </View>
        ))}
      </View>

      <Text style={s.sectionTitle}>Top Drivers</Text>
      <View style={s.listCard}>
        {topDrivers.map(([uid, { name, total }], i) => (
          <View key={uid} style={[s.listRow, i > 0 && s.listRowBorder]}>
            <View style={s.rankBadge}><Text style={s.rankText}>{i + 1}</Text></View>
            <Text style={s.listLabel} numberOfLines={1}>{name}</Text>
            <Text style={s.listValue}>{total} boarded</Text>
          </View>
        ))}
      </View>

      <Text style={s.sectionTitle}>Recent Activity</Text>
      <View style={s.listCard}>
        {records.slice(0, 20).map((r, i) => {
          const dateStr = r.createdAt?.toDate?.()?.toLocaleDateString([], { month: 'short', day: 'numeric' });
          return (
            <View key={r.id} style={[s.listRow, i > 0 && s.listRowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={s.listLabel} numberOfLines={1}>{r.stopName ?? r.stopId}</Text>
                <Text style={s.listMeta}>{driverNames[r.driverUid] ?? r.driverUid?.slice(0, 8)} · {dateStr}</Text>
              </View>
              <Text style={s.listValue}>{r.count} boarded</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ---- Main Screen ----

export default function AdminAnalyticsScreen() {
  const { primaryColor } = useOrgTheme();
  const [activeTab, setActiveTab] = useState<Tab>('insights');

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: 'insights', icon: 'auto-awesome', label: 'Insights' },
    { key: 'analytics', icon: 'bar-chart', label: 'Raw Data' },
  ];

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Analytics" />

      <View style={s.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabItem, activeTab === t.key && s.tabItemActive, activeTab === t.key && { borderBottomColor: primaryColor }]}
            onPress={() => setActiveTab(t.key)}
          >
            <Icon name={t.icon} size={18} color={activeTab === t.key ? primaryColor : '#9ca3af'} />
            <Text style={[s.tabLabel, activeTab === t.key && { color: primaryColor, fontWeight: '600' }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'insights' && <InsightsSection />}
        {activeTab === 'analytics' && <AnalyticsSection />}
      </View>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {},
  tabLabel: { fontSize: 14, color: '#9ca3af' },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 40 },
  // Insight cards
  intro: { fontSize: 13, color: '#6b7280', lineHeight: 18 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12, ...cardShadow },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  cardDate: { fontSize: 11, color: '#9ca3af' },
  statsRow: { flexDirection: 'row', gap: 12 },
  statItem: { flex: 1, alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 10, padding: 10 },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  narrative: { fontSize: 14, color: '#374151', lineHeight: 21 },
  emptyText: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' },
  emptySubtext: { fontSize: 12, color: '#9ca3af', textAlign: 'center' },
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16,
  },
  generateBtnText: { fontSize: 14, fontWeight: '600' },
  // Analytics
  summaryRow: { flexDirection: 'row', gap: 10 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', gap: 4, ...cardShadow },
  summaryValue: { fontSize: 24, fontWeight: '700', color: '#111' },
  summaryLabel: { fontSize: 11, color: '#6b7280', textAlign: 'center' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 4 },
  listCard: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', ...cardShadow },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  listRowBorder: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  rankBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  listLabel: { flex: 1, fontSize: 14, color: '#111' },
  listMeta: { fontSize: 11, color: '#9ca3af' },
  listValue: { fontSize: 13, fontWeight: '600', color: '#374151' },
  errorText: { color: '#DC2626', fontSize: 14, textAlign: 'center' },
  // Upsell
  upsellContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  upsellTitle: { fontSize: 20, fontWeight: '700', color: '#111', textAlign: 'center' },
  upsellBody: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  featureList: { alignSelf: 'stretch', gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 14, color: '#374151' },
  priceBox: { alignItems: 'center' },
  price: { fontSize: 36, fontWeight: '700' },
  priceSub: { fontSize: 18, fontWeight: '400' },
  priceNote: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  upgradeBtn: { width: '100%', marginTop: 4 },
});
