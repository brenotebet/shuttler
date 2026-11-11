// screens/PendingApprovalScreen.tsx
// Shown to a member of a K-12 / phone org until an org admin approves them
// (approvalStatus 'pending'), or after they were declined. The Firestore rules
// give them no org data until then — this screen only reads their own doc.
// AuthProvider's live user-doc listener moves them into the app the moment
// an admin approves them.

import React, { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { Text } from '../components/Text';
import ScreenContainer from '../components/ScreenContainer';
import AppButton from '../components/AppButton';
import { auth, db } from '../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../config';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrg } from '../src/org/OrgContext';
import { useOrgTheme } from '../src/org/useOrgTheme';
import { showAlert } from '../src/utils/alerts';
import ParentApplicationForm, { type ParentApplication } from '../src/components/ParentApplicationForm';
import { WHITE, GRAY_500, GRAY_700, GRAY_900 } from '../src/constants/theme';
import { spacing, borderRadius, cardShadow } from '../src/styles/common';

type Submitted = {
  displayName?: string | null;
  phone?: string | null;
  email?: string | null;
  relationship?: ParentApplication['relationship'];
  children?: { name: string; grade: string | null }[];
};

export default function PendingApprovalScreen() {
  const { user, approvalStatus, declineReason } = useAuth();
  const { org } = useOrg();
  const { primaryColor } = useOrgTheme();
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);

  const orgName = org?.name ?? 'your school';
  const isPhone = auth.currentUser?.providerData.some((p) => p.providerId === 'phone') ?? false;
  const declined = approvalStatus === 'declined';

  useEffect(() => {
    if (!user || !org?.orgId) return;
    getDoc(doc(db, 'orgs', org.orgId, 'users', user.uid))
      .then((snap) => {
        const d = snap.data() ?? {};
        setSubmitted({
          displayName: d.displayName ?? null,
          phone: d.phone ?? null,
          email: d.email ?? null,
          relationship: d.relationship,
          children: d.approvalRequest?.children ?? [],
        });
      })
      .catch(() => {});
  }, [user?.uid, org?.orgId, approvalStatus]);

  // No screen to go back to — back signs out, like the email verification gate.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      signOut(auth).catch(() => {});
      return true;
    });
    return () => sub.remove();
  }, []);

  const reapply = async (application?: ParentApplication) => {
    if (!org || !auth.currentUser) return;
    setSending(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`${SHUTTLER_API_URL}/orgs/${org.orgId}/membership/reapply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(application ? { application } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'Could not send your request.');
      setShowForm(false);
      // AuthProvider's listener flips the status back to pending.
    } catch (e: any) {
      showAlert(e?.message ?? 'Could not send your request.', 'Error');
    } finally {
      setSending(false);
    }
  };

  const onRequestAgain = () => (isPhone ? setShowForm(true) : reapply());

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Icon
          name={declined ? 'block' : 'hourglass-top'}
          size={64}
          color={declined ? GRAY_500 : primaryColor}
          style={styles.icon}
        />
        <Text style={styles.title}>
          {declined ? 'Request not approved' : 'Waiting for approval'}
        </Text>
        <Text style={styles.body}>
          {declined
            ? `${orgName} didn't approve your request.${declineReason ? `\n\n"${declineReason}"` : ''}\n\nPlease contact the school office.`
            : `${orgName} checks every new account against its records before you can see the bus. You'll get a notification when you're approved.`}
        </Text>

        {showForm ? (
          <View style={styles.card}>
            <ParentApplicationForm
              primaryColor={primaryColor}
              submitting={sending}
              submitLabel="Send request again"
              initial={{
                fullName: submitted?.displayName ?? '',
                relationship: submitted?.relationship,
                children: submitted?.children,
              }}
              onSubmit={reapply}
              onCancel={() => setShowForm(false)}
            />
          </View>
        ) : (
          <>
            {submitted && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>What the school sees</Text>
                {!!submitted.displayName && <Text style={styles.detail}>{submitted.displayName}</Text>}
                {!!submitted.phone && <Text style={styles.detail}>{submitted.phone}</Text>}
                {!submitted.phone && !!submitted.email && <Text style={styles.detail}>{submitted.email}</Text>}
                {(submitted.children ?? []).map((c, i) => (
                  <Text key={i} style={styles.detail}>
                    • {c.name}{c.grade ? ` (grade ${c.grade})` : ''}
                  </Text>
                ))}
              </View>
            )}
            {declined && (
              <AppButton
                label={sending ? 'Sending…' : 'Request again'}
                onPress={onRequestAgain}
                disabled={sending}
                style={{ marginTop: spacing.item, alignSelf: 'stretch' }}
              />
            )}
          </>
        )}

        <TouchableOpacity onPress={() => signOut(auth).catch(() => {})} style={styles.signOutButton}>
          <Text style={[styles.signOutText, { color: primaryColor }]}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.section,
    paddingVertical: spacing.section,
  },
  icon: { marginBottom: spacing.section },
  title: { fontSize: 24, fontWeight: '700', color: GRAY_900, marginBottom: spacing.item, textAlign: 'center' },
  body: { fontSize: 15, color: GRAY_700, textAlign: 'center', lineHeight: 22, marginBottom: spacing.section },
  card: {
    alignSelf: 'stretch',
    backgroundColor: WHITE,
    borderRadius: borderRadius.xl,
    padding: spacing.section,
    ...cardShadow,
  },
  cardLabel: { fontSize: 12, fontWeight: '700', color: GRAY_500, textTransform: 'uppercase', marginBottom: 8 },
  detail: { fontSize: 15, color: GRAY_900, marginBottom: 4 },
  signOutButton: { marginTop: spacing.section, padding: spacing.item },
  signOutText: { fontSize: 15, fontWeight: '600' },
});
