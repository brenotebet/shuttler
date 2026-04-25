// screens/ParentChildLinkScreen.tsx
//
// Lets parents link/unlink student accounts to their profile.
// Linked child UIDs are stored in orgs/{orgId}/users/{parentUid}.linkedChildUids.
// The parent's MapScreen and history screens use these UIDs to show child activity.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  FlatList,
} from 'react-native';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { useAuth } from '../src/auth/AuthProvider';
import Icon from 'react-native-vector-icons/MaterialIcons';
import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import AppButton from '../components/AppButton';
import { PRIMARY_COLOR, CARD_BACKGROUND } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

type LinkedChild = { uid: string; displayName: string; email: string | null };

export default function ParentChildLinkScreen() {
  const { orgId } = useAuth();
  const [linkedChildren, setLinkedChildren] = useState<LinkedChild[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLinking, setIsLinking] = useState(false);

  const parentUid = auth.currentUser?.uid;

  const loadLinkedChildren = useCallback(async () => {
    if (!orgId || !parentUid) return;
    setIsLoading(true);
    try {
      const parentSnap = await getDoc(doc(db, 'orgs', orgId, 'users', parentUid));
      const uids: string[] = parentSnap.data()?.linkedChildUids ?? [];
      if (uids.length === 0) { setLinkedChildren([]); return; }

      const children: LinkedChild[] = [];
      for (const uid of uids) {
        const snap = await getDoc(doc(db, 'orgs', orgId, 'users', uid));
        if (snap.exists()) {
          children.push({
            uid,
            displayName: snap.data()?.displayName ?? snap.data()?.email ?? 'Student',
            email: snap.data()?.email ?? null,
          });
        }
      }
      setLinkedChildren(children);
    } catch (e) {
      console.error('Failed to load linked children', e);
    } finally {
      setIsLoading(false);
    }
  }, [orgId, parentUid]);

  useEffect(() => { loadLinkedChildren(); }, [loadLinkedChildren]);

  const handleLink = useCallback(async () => {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    if (!orgId || !parentUid) return;

    setIsLinking(true);
    try {
      const q = query(
        collection(db, 'orgs', orgId, 'users'),
        where('email', '==', email),
        where('role', '==', 'student'),
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        Alert.alert('Not found', 'No student account found with that email address in this organisation.');
        return;
      }

      const childUid = snap.docs[0].id;
      if (linkedChildren.some((c) => c.uid === childUid)) {
        Alert.alert('Already linked', 'This student is already linked to your account.');
        return;
      }

      const parentRef = doc(db, 'orgs', orgId, 'users', parentUid);
      const currentSnap = await getDoc(parentRef);
      const current: string[] = currentSnap.data()?.linkedChildUids ?? [];
      await updateDoc(parentRef, { linkedChildUids: [...current, childUid] });

      setEmailInput('');
      await loadLinkedChildren();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to link child. Try again.');
    } finally {
      setIsLinking(false);
    }
  }, [emailInput, orgId, parentUid, linkedChildren, loadLinkedChildren]);

  const handleUnlink = useCallback((child: LinkedChild) => {
    Alert.alert(
      'Remove child',
      `Remove ${child.displayName} from your linked children?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!orgId || !parentUid) return;
            const parentRef = doc(db, 'orgs', orgId, 'users', parentUid);
            const snap = await getDoc(parentRef);
            const current: string[] = snap.data()?.linkedChildUids ?? [];
            await updateDoc(parentRef, { linkedChildUids: current.filter((u) => u !== child.uid) });
            setLinkedChildren((prev) => prev.filter((c) => c.uid !== child.uid));
          },
        },
      ],
    );
  }, [orgId, parentUid]);

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="My Children" />

      <FlatList
        data={linkedChildren}
        keyExtractor={(item) => item.uid}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.infoBox}>
              <Icon name="info-outline" size={18} color={PRIMARY_COLOR} style={{ marginTop: 1 }} />
              <Text style={styles.infoText}>
                Link your child's student account to track their shuttle in real time and view their ride history.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Link a child</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Child's school email"
                placeholderTextColor="#aaa"
                value={emailInput}
                onChangeText={setEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <AppButton
                label={isLinking ? '…' : 'Link'}
                onPress={handleLink}
                disabled={isLinking || !emailInput.trim()}
                style={styles.linkBtn}
              />
            </View>
            <Text style={styles.hint}>
              Enter the email address your child uses to log in to Shuttler.
            </Text>

            {linkedChildren.length > 0 && (
              <Text style={[styles.sectionLabel, { marginTop: spacing.section }]}>Linked children</Text>
            )}
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardIconWrap}>
              <Icon name="person" size={20} color={PRIMARY_COLOR} />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardName}>{item.displayName}</Text>
              {item.email ? <Text style={styles.cardEmail}>{item.email}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => handleUnlink(item)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Icon name="link-off" size={22} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={PRIMARY_COLOR} style={{ marginTop: 24 }} />
          ) : (
            <View style={styles.emptyContainer}>
              <Icon name="people-outline" size={44} color="#d1d5db" />
              <Text style={styles.emptyText}>No children linked yet.</Text>
              <Text style={styles.emptyHint}>Add your child's email above to get started.</Text>
            </View>
          )
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: spacing.section,
    flexGrow: 1,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: `${PRIMARY_COLOR}10`,
    borderRadius: borderRadius.lg,
    padding: 14,
    marginBottom: spacing.section,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.item / 2,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fff',
  },
  linkBtn: {
    paddingHorizontal: 0,
    width: 72,
  },
  hint: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 6,
    marginBottom: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BACKGROUND,
    borderRadius: borderRadius.lg,
    padding: spacing.item,
    marginBottom: spacing.item / 2,
    ...cardShadow,
  },
  cardIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f0f4ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.item,
  },
  cardContent: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: '#111' },
  cardEmail: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
});
