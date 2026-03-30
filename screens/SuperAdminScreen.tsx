// screens/SuperAdminScreen.tsx
// Visible only to users with the superAdmin Firebase custom claim.
// Lists pending org applications and allows approving or rejecting them.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../config';
import { PRIMARY_COLOR, BACKGROUND_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import HeaderBar from '../components/HeaderBar';
import ScreenContainer from '../components/ScreenContainer';

type Application = {
  orgId: string;
  name: string | null;
  slug: string | null;
  founderEmail: string | null;
  authMethod: string | null;
  submittedAt: string | null;
  reviewStatus: string;
};

async function getIdToken(): Promise<string | null> {
  try {
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch {
    return null;
  }
}

export default function SuperAdminScreen() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${SHUTTLER_API_URL}/super-admin/org-applications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setApplications(data.applications ?? []);
    } catch (err) {
      Alert.alert('Error', 'Failed to load applications. Check your connection.');
      console.error('[SuperAdminScreen] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleApprove = async (orgId: string, name: string | null) => {
    Alert.alert(
      'Approve Org',
      `Approve "${name ?? orgId}"? They will be able to subscribe and use Shuttler.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            setActionInFlight(orgId);
            try {
              const token = await getIdToken();
              const res = await fetch(
                `${SHUTTLER_API_URL}/super-admin/org-applications/${orgId}/approve`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
              );
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              setApplications((prev) => prev.filter((a) => a.orgId !== orgId));
            } catch (err) {
              Alert.alert('Error', 'Failed to approve. Try again.');
              console.error('[SuperAdminScreen] approve error:', err);
            } finally {
              setActionInFlight(null);
            }
          },
        },
      ],
    );
  };

  const handleReject = async (orgId: string, name: string | null) => {
    Alert.alert(
      'Reject Org',
      `Reject "${name ?? orgId}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setActionInFlight(orgId);
            try {
              const token = await getIdToken();
              const res = await fetch(
                `${SHUTTLER_API_URL}/super-admin/org-applications/${orgId}/reject`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ reason: 'Rejected by super admin' }),
                },
              );
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              setApplications((prev) => prev.filter((a) => a.orgId !== orgId));
            } catch (err) {
              Alert.alert('Error', 'Failed to reject. Try again.');
              console.error('[SuperAdminScreen] reject error:', err);
            } finally {
              setActionInFlight(null);
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: Application }) => {
    const isActing = actionInFlight === item.orgId;
    const submittedDate = item.submittedAt
      ? new Date(item.submittedAt).toLocaleDateString()
      : 'Unknown date';

    return (
      <View style={styles.card}>
        <Text style={styles.orgName}>{item.name ?? item.orgId}</Text>
        <Text style={styles.detail}>Slug: {item.slug ?? '—'}</Text>
        <Text style={styles.detail}>Founder: {item.founderEmail ?? '—'}</Text>
        <Text style={styles.detail}>Auth: {item.authMethod ?? '—'}</Text>
        <Text style={styles.detail}>Applied: {submittedDate}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.approveButton, isActing && styles.buttonDisabled]}
            disabled={isActing}
            onPress={() => handleApprove(item.orgId, item.name)}
          >
            {isActing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Approve</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.rejectButton, isActing && styles.buttonDisabled]}
            disabled={isActing}
            onPress={() => handleReject(item.orgId, item.name)}
          >
            <Text style={styles.buttonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="Org Applications" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={PRIMARY_COLOR} />
        </View>
      ) : (
        <FlatList
          data={applications}
          keyExtractor={(item) => item.orgId}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>No pending applications.</Text>
            </View>
          }
          onRefresh={fetchApplications}
          refreshing={loading}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.screenPadding,
    flexGrow: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  card: {
    backgroundColor: BACKGROUND_COLOR,
    borderRadius: borderRadius.lg,
    padding: spacing.section,
    marginBottom: spacing.section,
    ...cardShadow,
  },
  orgName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  detail: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveButton: {
    backgroundColor: PRIMARY_COLOR,
  },
  rejectButton: {
    backgroundColor: '#DC2626',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
