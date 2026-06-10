// screens/AdminAnalyticsScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Text } from '../components/Text';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BottomSheet from '../components/BottomSheet';
import * as WebBrowser from 'expo-web-browser';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { useOrg } from '../src/org/OrgContext';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { showToast } from '../src/components/Toast';
import { SHUTTLER_API_URL } from '../config';
import { cardShadow, spacing } from '../src/styles/common';
import {
  busiestHours,
  computeServicePerformance,
  RequestRecord,
} from '../src/utils/analyticsMetrics';
import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import AppButton from '../components/AppButton';
import Icon from 'react-native-vector-icons/MaterialIcons';

const ANALYTICS_WELCOME_KEY = 'shuttler_analytics_welcomed';

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

function InsightsSection({ onGoToAnalytics }: { onGoToAnalytics: () => void }) {
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [weekly, setWeekly] = useState<OrgInsight | null>(null);
  const [monthly, setMonthly] = useState<OrgInsight | null>(null);
  const [satisfaction, setSatisfaction] = useState<FeedbackSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState<'weekly' | 'monthly' | null>(null);
  const [hasBoardingData, setHasBoardingData] = useState(false);

  const hasAnalytics = !!(org?.dataAddonActive || org?.entitlements?.dataApi);

  // Headline satisfaction is free for every org — riders volunteered it.
  useEffect(() => {
    if (!org) return;
    (async () => {
      try {
        const token = await getBearerToken();
        const res = await fetch(`${SHUTTLER_API_URL}/analytics/feedback-summary?days=30`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { setSatisfaction(null); return; }
        setSatisfaction(await res.json());
      } catch {
        setSatisfaction(null);
      }
    })();
  }, [org?.orgId]);

  const load = useCallback(async () => {
    if (!org) return;
    setIsLoading(true);
    try {
      const [wSnap, mSnap, boardingSnap] = await Promise.all([
        getDoc(doc(db, 'orgs', org.orgId, 'insights', 'weekly')),
        getDoc(doc(db, 'orgs', org.orgId, 'insights', 'monthly')),
        getDocs(query(collection(db, 'orgs', org.orgId, 'boardingCounts'), limit(1))),
      ]);
      setWeekly(wSnap.exists() ? (wSnap.data() as OrgInsight) : null);
      setMonthly(mSnap.exists() ? (mSnap.data() as OrgInsight) : null);
      setHasBoardingData(!boardingSnap.empty);
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
        ) : hasBoardingData ? (
          <Text style={s.emptyText}>No {label.toLowerCase()} insight yet — generate one below.</Text>
        ) : (
          <Text style={s.emptyText}>
            No rides logged yet. Insights generate automatically once drivers start recording pickups.
          </Text>
        )}
        {hasBoardingData ? (
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
        ) : (
          <View style={[s.generateBtn, s.generateBtnDisabled]}>
            <Icon name="auto-awesome" size={16} color="#d1d5db" />
            <Text style={[s.generateBtnText, { color: '#d1d5db' }]}>Available once rides are logged</Text>
          </View>
        )}
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

      {/* Rider satisfaction headline — free for every org */}
      {satisfaction && satisfaction.ratingCount > 0 && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Rider Satisfaction</Text>
            <Text style={s.cardDate}>Last 30 days</Text>
          </View>
          <View style={a.ratingHeader}>
            <Text style={[a.ratingValue, { color: primaryColor }]}>{satisfaction.avgRating}</Text>
            <View>
              <View style={a.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Icon
                    key={star}
                    name={star <= Math.round(satisfaction.avgRating ?? 0) ? 'star' : 'star-border'}
                    size={16}
                    color="#f59e0b"
                  />
                ))}
              </View>
              <Text style={a.ratingMeta}>
                {satisfaction.ratingCount} rating{satisfaction.ratingCount !== 1 ? 's' : ''} from riders
              </Text>
            </View>
          </View>
          {satisfaction.limited && (
            <TouchableOpacity onPress={onGoToAnalytics}>
              <Text style={[s.satisfactionUpsell, { color: primaryColor }]}>
                See per-question scores and rider comments with Data Analytics →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Free data export — orgs always own their data */}
      {!hasAnalytics && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Export Your Data</Text>
            <Text style={s.cardDate}>Last 90 days</Text>
          </View>
          <ExportButtons
            days={90}
            periodLabel="last 90 days"
            hint="Included with every plan — your data is always yours. Data Analytics extends exports to a full year."
          />
        </View>
      )}
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

interface StopRequestDoc {
  id: string;
  status: string;
  createdAt: any;
  arrivedAt: any;
  stop?: { name?: string };
  cancelledReason?: string | null;
}

interface FeedbackSummary {
  responseCount: number;
  avgRating: number | null;
  ratingCount: number;
  /** true when the org isn't entitled — headline only, no breakdowns */
  limited?: boolean;
  byQuestion: { question: string; avgRating: number; count: number }[];
  recentComments: { question: string; answer: string; date: string }[];
}

// ---- Shared export buttons (backend-served CSV) ----

function ExportButtons({ days, periodLabel, hint }: { days: number; periodLabel: string; hint: string }) {
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [exporting, setExporting] = useState<'boardings' | 'requests' | null>(null);

  const run = async (type: 'boardings' | 'requests') => {
    if (exporting) return;
    setExporting(type);
    try {
      const token = await getBearerToken();
      const res = await fetch(`${SHUTTLER_API_URL}/export/csv?type=${type}&days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? body?.error ?? 'Export failed');
      }
      const csv = await res.text();
      await Share.share({
        message: csv,
        title: `${org?.name ?? 'Shuttler'} — ${type === 'boardings' ? 'Boardings' : 'Stop Requests'} (${periodLabel})`,
      });
    } catch (e: any) {
      showToast(e?.message ?? 'Export failed. Please try again.', 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <View style={a.exportRow}>
        {(['boardings', 'requests'] as const).map((type) => (
          <TouchableOpacity
            key={type}
            style={[a.exportBtn, { borderColor: primaryColor }]}
            onPress={() => run(type)}
            disabled={exporting !== null}
          >
            {exporting === type ? (
              <ActivityIndicator size="small" color={primaryColor} />
            ) : (
              <>
                <Icon name={type === 'boardings' ? 'directions-bus' : 'list-alt'} size={16} color={primaryColor} />
                <Text style={[a.exportBtnText, { color: primaryColor }]}>
                  {type === 'boardings' ? 'Boardings CSV' : 'Requests CSV'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={a.exportHint}>{hint}</Text>
    </>
  );
}

type Period = '7d' | '30d' | '90d' | 'all';

const PERIOD_OPTIONS: { label: string; value: Period; days: number | null }[] = [
  { label: '7D', value: '7d', days: 7 },
  { label: '30D', value: '30d', days: 30 },
  { label: '90D', value: '90d', days: 90 },
  { label: 'All', value: 'all', days: null },
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function HBarChart({
  items,
  color,
  maxItems = 6,
}: {
  items: { label: string; value: number }[];
  color: string;
  maxItems?: number;
}) {
  const shown = items.slice(0, maxItems);
  const max = Math.max(...shown.map((i) => i.value), 1);
  return (
    <View style={a.barChartWrap}>
      {shown.map(({ label, value }, i) => (
        <View key={i} style={a.barRow}>
          <Text style={a.barLabel} numberOfLines={1}>{label}</Text>
          <View style={a.barTrack}>
            <View
              style={[
                a.barFill,
                {
                  width: `${Math.max((value / max) * 100, 2)}%` as any,
                  backgroundColor: i === 0 ? color : `${color}70`,
                },
              ]}
            />
          </View>
          <Text style={a.barValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function TrendBadge({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return null;
  const up = pct >= 0;
  // For metrics where lower is better (e.g. wait time), invert the coloring.
  const good = invert ? !up : up;
  return (
    <View style={[a.trendBadge, { backgroundColor: good ? '#dcfce7' : '#fee2e2' }]}>
      <Icon name={up ? 'arrow-upward' : 'arrow-downward'} size={11} color={good ? '#16a34a' : '#dc2626'} />
      <Text style={[a.trendText, { color: good ? '#16a34a' : '#dc2626' }]}>
        {Math.abs(pct)}% vs prev. period
      </Text>
    </View>
  );
}

function AnalyticsSection() {
  const { org, refreshOrg } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [records, setRecords] = useState<BoardingCount[]>([]);
  const [requests, setRequests] = useState<StopRequestDoc[]>([]);
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [period, setPeriod] = useState<Period>('30d');
  const [showWelcome, setShowWelcome] = useState(false);
  const [showAddonDetail, setShowAddonDetail] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const baselineAddon = useRef(org?.dataAddonActive);

  // Enterprise plans include analytics without the add-on purchase.
  const hasAnalytics = !!(org?.dataAddonActive || org?.entitlements?.dataApi);

  // Show confirmation the moment the webhook updates Firestore
  useEffect(() => {
    if (org?.dataAddonActive && !baselineAddon.current) {
      setShowConfirmation(true);
      baselineAddon.current = true;
    }
  }, [org?.dataAddonActive]);

  // One-time welcome banner after purchase
  useEffect(() => {
    if (!org?.dataAddonActive) return;
    AsyncStorage.getItem(ANALYTICS_WELCOME_KEY).then((seen) => {
      if (!seen) {
        setShowWelcome(true);
        AsyncStorage.setItem(ANALYTICS_WELCOME_KEY, '1');
      }
    });
  }, [org?.dataAddonActive]);

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
      const result = await WebBrowser.openAuthSessionAsync(url, 'shuttler://billing');
      const redirectedUrl = (result as any).url as string | undefined;
      if (result.type === 'success' && redirectedUrl?.includes('session_id=')) {
        void refreshOrg();
        setTimeout(() => void refreshOrg(), 3000);
        setTimeout(() => void refreshOrg(), 7000);
      }
    } catch (e: any) {
      showToast(e?.message ?? 'Failed to open billing.', 'error');
    } finally {
      setIsUpgrading(false);
    }
  }, [org, refreshOrg]);

  useEffect(() => {
    if (!hasAnalytics || !org) return;
    const load = async () => {
      try {
        setIsLoading(true);
        const [boardingSnap, requestSnap] = await Promise.all([
          getDocs(query(collection(db, 'orgs', org.orgId, 'boardingCounts'), orderBy('createdAt', 'desc'))),
          getDocs(query(collection(db, 'orgs', org.orgId, 'stopRequests'), orderBy('createdAt', 'desc'))),
        ]);
        setRecords(boardingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BoardingCount, 'id'>) })));
        setRequests(requestSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StopRequestDoc, 'id'>) })));
      } catch (e: any) {
        setError(e.message ?? 'Failed to load analytics');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [org?.orgId, hasAnalytics]);

  // Rider satisfaction aggregates come from the backend — the feedback
  // collection itself is never readable client-side.
  useEffect(() => {
    if (!hasAnalytics || !org) return;
    const days = PERIOD_OPTIONS.find((p) => p.value === period)?.days ?? 365;
    (async () => {
      try {
        const token = await getBearerToken();
        const res = await fetch(`${SHUTTLER_API_URL}/analytics/feedback-summary?days=${days}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { setFeedback(null); return; }
        setFeedback(await res.json());
      } catch {
        setFeedback(null);
      }
    })();
  }, [org?.orgId, hasAnalytics, period]);

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

  // ── Upsell gate ──
  if (!hasAnalytics) {
    return (
      <>
        <View style={s.upsellContainer}>
          <View style={[s.upsellIconWrap, { backgroundColor: `${primaryColor}12` }]}>
            <Icon name="bar-chart" size={40} color={primaryColor} />
          </View>
          <Text style={s.upsellTitle}>Unlock Data Analytics</Text>
          <Text style={s.upsellBody}>
            How long do riders wait? When do you need more buses? Are riders happy?
            Get the answers — wait times, demand patterns, and satisfaction in one dashboard.
          </Text>
          <View style={s.priceBox}>
            <Text style={[s.price, { color: primaryColor }]}>$49<Text style={s.priceSub}>/mo</Text></Text>
            <Text style={s.priceNote}>Add-on to any plan · Cancel anytime</Text>
          </View>
          <AppButton
            label={isUpgrading ? '…' : 'Add Data Analytics — $49/mo'}
            onPress={openAddonCheckout}
            disabled={isUpgrading}
            style={[s.upgradeBtn, { backgroundColor: primaryColor }]}
          />
          <TouchableOpacity style={s.learnMoreBtn} onPress={() => setShowAddonDetail(true)}>
            <Text style={[s.learnMoreText, { color: primaryColor }]}>See everything that's included →</Text>
          </TouchableOpacity>
        </View>

        {/* Inline detail sheet */}
        <BottomSheet
          visible={showAddonDetail}
          onClose={() => setShowAddonDetail(false)}
          sheetStyle={s.detailSheet}
        >
          <View style={s.detailHandle} />
            <View style={[s.detailHighlight, { backgroundColor: `${primaryColor}12` }]}>
              <Icon name="star" size={12} color={primaryColor} />
              <Text style={[s.detailHighlightText, { color: primaryColor }]}>Add-on to any plan</Text>
            </View>
            <Text style={s.detailName}>Data Analytics</Text>
            <Text style={[s.detailPrice, { color: primaryColor }]}>$49 / mo</Text>
            <Text style={s.detailTagline}>Wait times, demand patterns, and rider satisfaction — the numbers that run your shuttle.</Text>
            <View style={s.detailDivider} />
            {[
              { icon: 'timer', text: 'Rider wait times — average, trend, and per stop' },
              { icon: 'fact-check', text: 'Fulfillment rate & why requests get cancelled' },
              { icon: 'schedule', text: 'Busiest hours — know when to add buses' },
              { icon: 'sentiment-satisfied', text: 'Rider satisfaction scores and comments' },
              { icon: 'trending-up', text: 'Boarding trends vs previous periods (7D / 30D / 90D)' },
              { icon: 'place', text: 'Stop-by-stop and per-driver breakdowns' },
              { icon: 'share', text: 'Extends your free 90-day CSV exports to a full year' },
            ].map(({ icon, text }) => (
              <View key={text} style={s.detailFeatureRow}>
                <View style={[s.detailFeatureIcon, { backgroundColor: `${primaryColor}12` }]}>
                  <Icon name={icon} size={16} color={primaryColor} />
                </View>
                <Text style={s.detailFeatureText}>{text}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={[s.detailCta, { backgroundColor: isUpgrading ? '#e5e7eb' : primaryColor }]}
              onPress={() => { setShowAddonDetail(false); openAddonCheckout(); }}
              disabled={isUpgrading}
            >
              <Text style={[s.detailCtaText, { color: isUpgrading ? '#9ca3af' : '#fff' }]}>
                Add Data Analytics — $49/mo
              </Text>
            </TouchableOpacity>
        </BottomSheet>

        {/* Confirmation — shown when Firestore confirms the purchase */}
        <BottomSheet visible={showConfirmation} onClose={() => setShowConfirmation(false)} sheetStyle={s.confirmSheet}>
          <View style={[s.confirmIconCircle, { backgroundColor: `${primaryColor}15` }]}>
            <Icon name="check-circle" size={48} color={primaryColor} />
          </View>
          <Text style={s.confirmTitle}>Analytics Unlocked!</Text>
          <Text style={s.confirmBody}>
            Wait times, busiest hours, rider satisfaction, and your full boarding history are now live.
            Use the period filter to spot trends and export everything as CSV.
          </Text>
          <TouchableOpacity
            style={[s.confirmBtn, { backgroundColor: primaryColor }]}
            onPress={() => setShowConfirmation(false)}
          >
            <Text style={s.confirmBtnText}>View My Analytics</Text>
          </TouchableOpacity>
        </BottomSheet>
      </>
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

  // ── Data computation ──
  const now = Date.now();
  const opt = PERIOD_OPTIONS.find((p) => p.value === period)!;
  const cutoffMs = opt.days ? now - opt.days * 86_400_000 : 0;
  const prevCutoffMs = opt.days ? now - 2 * opt.days * 86_400_000 : 0;

  const ts = (r: BoardingCount) => r.createdAt?.toDate?.()?.getTime?.() ?? 0;
  const filtered = opt.days ? records.filter((r) => ts(r) >= cutoffMs) : records;
  const prev = opt.days ? records.filter((r) => ts(r) >= prevCutoffMs && ts(r) < cutoffMs) : [];

  const aggregate = (recs: BoardingCount[]) => {
    const stops = new Map<string, { name: string; total: number }>();
    const drivers = new Map<string, { name: string; total: number }>();
    const days = [0, 0, 0, 0, 0, 0, 0];
    let total = 0;
    recs.forEach((r) => {
      const c = r.count ?? 0;
      total += c;
      const s = stops.get(r.stopId) ?? { name: r.stopName ?? r.stopId, total: 0 };
      s.total += c;
      stops.set(r.stopId, s);
      if (r.driverUid) {
        const d = drivers.get(r.driverUid) ?? { name: driverNames[r.driverUid] ?? r.driverUid.slice(0, 8), total: 0 };
        d.total += c;
        d.name = driverNames[r.driverUid] ?? d.name;
        drivers.set(r.driverUid, d);
      }
      const dayIdx = r.createdAt?.toDate?.()?.getDay?.() ?? 0;
      days[dayIdx] += c;
    });
    return { total, stops, drivers, days };
  };

  const cur = aggregate(filtered);
  const prevAgg = aggregate(prev);

  const trendPct: number | null =
    opt.days && prevAgg.total > 0
      ? Math.round(((cur.total - prevAgg.total) / prevAgg.total) * 100)
      : null;

  const topStops = [...cur.stops.values()].sort((a, b) => b.total - a.total).slice(0, 6);
  const topDrivers = [...cur.drivers.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  // Order Mon–Sun
  const weekdayData = [1, 2, 3, 4, 5, 6, 0].map((i) => ({ label: DAY_LABELS[i], value: cur.days[i] }));

  // ── Service performance (from stop requests) ──
  const toRequestRecord = (r: StopRequestDoc): RequestRecord => ({
    status: r.status,
    createdAtMs: r.createdAt?.toDate?.()?.getTime?.() ?? null,
    arrivedAtMs: r.arrivedAt?.toDate?.()?.getTime?.() ?? null,
    stopName: r.stop?.name ?? 'Unknown stop',
    cancelledReason: r.cancelledReason ?? null,
  });
  const reqTs = (r: StopRequestDoc) => r.createdAt?.toDate?.()?.getTime?.() ?? 0;
  const reqFiltered = (opt.days ? requests.filter((r) => reqTs(r) >= cutoffMs) : requests).map(toRequestRecord);
  const reqPrev = (opt.days ? requests.filter((r) => reqTs(r) >= prevCutoffMs && reqTs(r) < cutoffMs) : []).map(toRequestRecord);

  const perf = computeServicePerformance(reqFiltered);
  const prevPerf = computeServicePerformance(reqPrev);
  const waitTrendPct: number | null =
    opt.days && perf.avgWaitMin !== null && prevPerf.avgWaitMin !== null && prevPerf.avgWaitMin > 0
      ? Math.round(((perf.avgWaitMin - prevPerf.avgWaitMin) / prevPerf.avgWaitMin) * 100)
      : null;

  const topHours = busiestHours(
    filtered.map((r) => ({ createdAtMs: ts(r) || null, count: r.count ?? 0 })),
  );
  const slowestStops = perf.waitByStop.slice(0, 6);

  // Grouped recent activity
  const todayStr = new Date().toDateString();
  const yesterdayStr = new Date(now - 86_400_000).toDateString();
  const grouped: { label: string; items: BoardingCount[] }[] = [];
  const seenLabels = new Map<string, BoardingCount[]>();
  filtered.slice(0, 40).forEach((r) => {
    const d = r.createdAt?.toDate?.();
    const ds = d?.toDateString?.() ?? 'Unknown';
    const label = ds === todayStr ? 'Today'
      : ds === yesterdayStr ? 'Yesterday'
      : d?.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) ?? ds;
    if (!seenLabels.has(label)) { seenLabels.set(label, []); grouped.push({ label, items: seenLabels.get(label)! }); }
    seenLabels.get(label)!.push(r);
  });

  return (
    <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

      {/* Welcome banner — shown once after purchase */}
      {showWelcome && (
        <View style={[a.welcomeBanner, { borderColor: `${primaryColor}30`, backgroundColor: `${primaryColor}08` }]}>
          <View style={{ flex: 1 }}>
            <Text style={[a.welcomeTitle, { color: primaryColor }]}>Analytics Unlocked 🎉</Text>
            <Text style={a.welcomeBody}>Wait times, busiest hours, and rider satisfaction are now live alongside your full boarding history. Use the period filter to spot trends and the export buttons to share data with your team.</Text>
          </View>
          <TouchableOpacity onPress={() => setShowWelcome(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="close" size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}

      {/* Period filter */}
      <View style={a.periodRow}>
        {PERIOD_OPTIONS.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[a.periodChip, period === p.value && { backgroundColor: primaryColor, borderColor: primaryColor }]}
            onPress={() => setPeriod(p.value)}
          >
            <Text style={[a.periodChipText, period === p.value && a.periodChipTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Hero metric */}
      <View style={[a.heroCard, { ...cardShadow }]}>
        <Text style={a.heroLabel}>Total Boardings</Text>
        <Text style={[a.heroValue, { color: primaryColor }]}>{cur.total.toLocaleString()}</Text>
        <TrendBadge pct={trendPct} />
        <View style={a.heroStatsRow}>
          <View style={a.heroStat}>
            <Text style={[a.heroStatValue, { color: primaryColor }]}>{cur.stops.size}</Text>
            <Text style={a.heroStatLabel}>Active Stops</Text>
          </View>
          <View style={a.heroStatDivider} />
          <View style={a.heroStat}>
            <Text style={[a.heroStatValue, { color: primaryColor }]}>{cur.drivers.size}</Text>
            <Text style={a.heroStatLabel}>Active Drivers</Text>
          </View>
          <View style={a.heroStatDivider} />
          <View style={a.heroStat}>
            <Text style={[a.heroStatValue, { color: primaryColor }]}>
              {cur.drivers.size > 0 ? Math.round(cur.total / cur.drivers.size) : 0}
            </Text>
            <Text style={a.heroStatLabel}>Avg / Driver</Text>
          </View>
        </View>
      </View>

      {/* Service Performance — from stop requests */}
      {perf.totalRequests > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Service Performance</Text>
          <View style={[a.chartCard, cardShadow]}>
            <View style={a.heroStatsRow}>
              <View style={a.heroStat}>
                <Text style={[a.heroStatValue, { color: primaryColor }]}>
                  {perf.avgWaitMin !== null ? `${perf.avgWaitMin}m` : '—'}
                </Text>
                <Text style={a.heroStatLabel}>Avg Wait</Text>
              </View>
              <View style={a.heroStatDivider} />
              <View style={a.heroStat}>
                <Text style={[a.heroStatValue, { color: primaryColor }]}>
                  {perf.fulfillmentPct !== null ? `${perf.fulfillmentPct}%` : '—'}
                </Text>
                <Text style={a.heroStatLabel}>Fulfilled</Text>
              </View>
              <View style={a.heroStatDivider} />
              <View style={a.heroStat}>
                <Text style={[a.heroStatValue, { color: primaryColor }]}>{perf.totalRequests}</Text>
                <Text style={a.heroStatLabel}>Requests</Text>
              </View>
            </View>
            {waitTrendPct !== null && (
              <View style={a.perfTrendRow}>
                <Text style={a.perfTrendLabel}>Wait time</Text>
                <TrendBadge pct={waitTrendPct} invert />
              </View>
            )}
          </View>
        </View>
      )}

      {/* Wait time by stop — slowest first */}
      {slowestStops.length > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Avg Wait by Stop (min)</Text>
          <View style={[a.chartCard, cardShadow]}>
            <HBarChart items={slowestStops} color={primaryColor} />
          </View>
        </View>
      )}

      {/* Busiest hours — staffing signal */}
      {topHours.length > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Busiest Hours</Text>
          <View style={[a.chartCard, cardShadow]}>
            <HBarChart items={topHours} color={primaryColor} />
          </View>
        </View>
      )}

      {/* Cancellation reasons */}
      {perf.cancelReasons.length > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Cancelled Requests</Text>
          <View style={s.listCard}>
            {perf.cancelReasons.map((r, i) => (
              <View key={r.label} style={[s.listRow, i > 0 && s.listRowBorder]}>
                <Text style={s.listLabel}>{r.label}</Text>
                <Text style={s.listValue}>{r.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Rider satisfaction — aggregated server-side */}
      {feedback && feedback.ratingCount > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Rider Satisfaction</Text>
          <View style={[a.chartCard, cardShadow]}>
            <View style={a.ratingHeader}>
              <Text style={[a.ratingValue, { color: primaryColor }]}>{feedback.avgRating}</Text>
              <View>
                <View style={a.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Icon
                      key={star}
                      name={star <= Math.round(feedback.avgRating ?? 0) ? 'star' : 'star-border'}
                      size={16}
                      color="#f59e0b"
                    />
                  ))}
                </View>
                <Text style={a.ratingMeta}>
                  {feedback.ratingCount} rating{feedback.ratingCount !== 1 ? 's' : ''} this period
                </Text>
              </View>
            </View>
            {feedback.byQuestion.map((q) => (
              <View key={q.question} style={a.questionRow}>
                <Text style={a.questionText} numberOfLines={2}>{q.question}</Text>
                <Text style={[a.questionRating, { color: primaryColor }]}>{q.avgRating} ★</Text>
              </View>
            ))}
            {feedback.recentComments.length > 0 && (
              <>
                <View style={a.commentsDivider} />
                {feedback.recentComments.map((c, i) => (
                  <Text key={i} style={a.commentText}>"{c.answer}"</Text>
                ))}
              </>
            )}
          </View>
        </View>
      )}

      {/* Busiest Stops */}
      {topStops.length > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Busiest Stops</Text>
          <View style={[a.chartCard, cardShadow]}>
            <HBarChart items={topStops.map((s) => ({ label: s.name, value: s.total }))} color={primaryColor} />
          </View>
        </View>
      )}

      {/* Top Drivers */}
      {topDrivers.length > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Top Drivers</Text>
          <View style={[a.chartCard, cardShadow]}>
            <HBarChart items={topDrivers.map((d) => ({ label: d.name, value: d.total }))} color={primaryColor} />
          </View>
        </View>
      )}

      {/* Weekday pattern */}
      {weekdayData.some((d) => d.value > 0) && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Ridership by Day</Text>
          <View style={[a.chartCard, cardShadow]}>
            <HBarChart items={weekdayData} color={primaryColor} maxItems={7} />
          </View>
        </View>
      )}

      {/* Recent Activity — grouped */}
      {grouped.length > 0 && (
        <View style={a.section}>
          <Text style={s.sectionTitle}>Recent Activity</Text>
          {grouped.map(({ label, items }) => (
            <View key={label}>
              <Text style={a.groupLabel}>{label}</Text>
              <View style={[s.listCard, { marginBottom: 8 }]}>
                {items.map((r, i) => (
                  <View key={r.id} style={[s.listRow, i > 0 && s.listRowBorder]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.listLabel} numberOfLines={1}>{r.stopName ?? r.stopId}</Text>
                      <Text style={s.listMeta}>{driverNames[r.driverUid] ?? r.driverUid?.slice(0, 8)}</Text>
                    </View>
                    <Text style={s.listValue}>{r.count} boarded</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Export */}
      <View style={a.section}>
        <Text style={s.sectionTitle}>Export Data</Text>
        <ExportButtons
          days={opt.days ?? 365}
          periodLabel={opt.label}
          hint="Exports match the selected period. Requests include wait times and cancellation reasons."
        />
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
        {activeTab === 'insights' && <InsightsSection onGoToAnalytics={() => setActiveTab('analytics')} />}
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
  generateBtnDisabled: { borderColor: '#e5e7eb' },
  satisfactionUpsell: { fontSize: 13, fontWeight: '600' },
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
  upsellIconWrap: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  upsellTitle: { fontSize: 22, fontWeight: '800', color: '#111', textAlign: 'center' },
  upsellBody: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  featureList: { alignSelf: 'stretch', gap: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 14, color: '#374151' },
  priceBox: { alignItems: 'center' },
  price: { fontSize: 36, fontWeight: '700' },
  priceSub: { fontSize: 18, fontWeight: '400' },
  priceNote: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  upgradeBtn: { width: '100%', marginTop: 4 },
  learnMoreBtn: { paddingVertical: 4 },
  learnMoreText: { fontSize: 14, fontWeight: '600' },
  // Inline detail sheet
  detailSheet: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 48 },
  detailHandle: { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  detailHighlight: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  detailHighlightText: { fontSize: 12, fontWeight: '700' },
  detailName: { fontSize: 22, fontWeight: '800', color: '#111', marginBottom: 4 },
  detailPrice: { fontSize: 28, fontWeight: '700', marginBottom: 6 },
  detailTagline: { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  detailDivider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 16 },
  detailFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  detailFeatureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  detailFeatureText: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 20 },
  detailCta: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  detailCtaText: { fontSize: 16, fontWeight: '700' },
  // Purchase confirmation
  confirmSheet: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48, alignItems: 'center' },
  confirmIconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  confirmTitle: { fontSize: 22, fontWeight: '800', color: '#111', textAlign: 'center', marginBottom: 10 },
  confirmBody: { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  confirmBtn: { borderRadius: 14, paddingVertical: 15, paddingHorizontal: 32, width: '100%', alignItems: 'center' },
  confirmBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});

// Styles for the unlocked analytics section
const a = StyleSheet.create({
  // Welcome banner
  welcomeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 4,
  },
  welcomeTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  welcomeBody: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 19,
  },
  // Period filter
  periodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  periodChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  periodChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  periodChipTextActive: {
    color: '#fff',
  },
  // Hero card
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  heroLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroValue: {
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 56,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 2,
  },
  trendText: {
    fontSize: 12,
    fontWeight: '600',
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    width: '100%',
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  heroStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#f3f4f6',
  },
  heroStatValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  heroStatLabel: {
    fontSize: 11,
    color: '#9ca3af',
  },
  // Chart cards
  section: {
    gap: 8,
  },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
  },
  barChartWrap: {
    gap: 10,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barLabel: {
    width: 80,
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  barTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  barValue: {
    width: 36,
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
  },
  // Activity groups
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  // Service performance
  perfTrendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  perfTrendLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  // Rider satisfaction
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  ratingValue: {
    fontSize: 36,
    fontWeight: '800',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 1,
  },
  ratingMeta: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  questionText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  questionRating: {
    fontSize: 13,
    fontWeight: '700',
  },
  commentsDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginVertical: 10,
  },
  commentText: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
    lineHeight: 19,
    marginBottom: 8,
  },
  // Export
  exportRow: {
    flexDirection: 'row',
    gap: 10,
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  exportBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  exportHint: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 16,
  },
});
