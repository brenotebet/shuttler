// screens/ParentChildLinkScreen.tsx
//
// Parent manages their children's profiles (name + optional grade).
// No child account needed — profiles are stored as a subcollection:
//   orgs/{orgId}/users/{parentUid}/children/{childId}
// The parent selects a child when requesting a stop on MapScreen.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';
import { auth, db } from '../firebase/firebaseconfig';
import { useAuth } from '../src/auth/AuthProvider';
import { useOrgTheme } from '../src/org/useOrgTheme';
import Icon from 'react-native-vector-icons/MaterialIcons';
import ScreenContainer from '../components/ScreenContainer';
import HeaderBar from '../components/HeaderBar';
import AppButton from '../components/AppButton';
import { CARD_BACKGROUND } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';

export type ChildProfile = { id: string; name: string; grade?: string };

export async function loadChildProfiles(orgId: string, parentUid: string): Promise<ChildProfile[]> {
  const snap = await getDocs(
    query(
      collection(db, 'orgs', orgId, 'users', parentUid, 'children'),
      orderBy('createdAt', 'asc'),
    ),
  );
  return snap.docs.map((d) => ({
    id: d.id,
    name: d.data().name as string,
    grade: d.data().grade ?? undefined,
  }));
}

export default function ParentChildLinkScreen() {
  const { orgId } = useAuth();
  const { primaryColor } = useOrgTheme();
  const parentUid = auth.currentUser?.uid ?? '';

  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nameInput, setNameInput] = useState('');
  const [gradeInput, setGradeInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || !parentUid) return;
    setIsLoading(true);
    try {
      setChildren(await loadChildProfiles(orgId, parentUid));
    } catch (e) {
      console.error('Failed to load child profiles', e);
    } finally {
      setIsLoading(false);
    }
  }, [orgId, parentUid]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const name = nameInput.trim();
    if (!name || !orgId || !parentUid) return;
    setIsAdding(true);
    try {
      const ref = await addDoc(
        collection(db, 'orgs', orgId, 'users', parentUid, 'children'),
        { name, grade: gradeInput.trim() || null, createdAt: new Date() },
      );
      setChildren((prev) => [...prev, { id: ref.id, name, grade: gradeInput.trim() || undefined }]);
      setNameInput('');
      setGradeInput('');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to add child.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemove = (child: ChildProfile) => {
    Alert.alert(
      'Remove child',
      `Remove ${child.name} from your profile?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'orgs', orgId!, 'users', parentUid, 'children', child.id));
              setChildren((prev) => prev.filter((c) => c.id !== child.id));
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Failed to remove.');
            }
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer padded={false}>
      <HeaderBar title="My Children" />
      <FlatList
        data={children}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={[styles.infoBox, { backgroundColor: `${primaryColor}12` }]}>
              <Icon name="info-outline" size={18} color={primaryColor} style={{ marginTop: 1 }} />
              <Text style={styles.infoText}>
                Add your children here. When requesting a stop you'll be asked to select which child you're requesting for.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Add a child</Text>
            <TextInput
              style={styles.input}
              placeholder="Child's name"
              placeholderTextColor="#aaa"
              value={nameInput}
              onChangeText={setNameInput}
              autoCapitalize="words"
            />
            <TextInput
              style={[styles.input, { marginTop: -4 }]}
              placeholder="Grade (optional, e.g. Grade 3)"
              placeholderTextColor="#aaa"
              value={gradeInput}
              onChangeText={setGradeInput}
              autoCapitalize="words"
            />
            <AppButton
              label={isAdding ? 'Adding…' : 'Add child'}
              onPress={handleAdd}
              disabled={isAdding || !nameInput.trim()}
              style={{ marginBottom: spacing.section }}
            />

            {children.length > 0 && (
              <Text style={[styles.sectionLabel, { marginTop: 4 }]}>Your children</Text>
            )}
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={[styles.avatar, { backgroundColor: `${primaryColor}22` }]}>
              <Icon name="person" size={20} color={primaryColor} />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardName}>{item.name}</Text>
              {item.grade ? <Text style={styles.cardGrade}>{item.grade}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => handleRemove(item)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Icon name="delete-outline" size={22} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={primaryColor} style={{ marginTop: 24 }} />
          ) : (
            <View style={styles.empty}>
              <Icon name="people-outline" size={44} color="#d1d5db" />
              <Text style={styles.emptyText}>No children added yet.</Text>
              <Text style={styles.emptyHint}>Add your child's name above to get started.</Text>
            </View>
          )
        }
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.section, flexGrow: 1 },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: borderRadius.lg,
    padding: 14,
    marginBottom: spacing.section,
  },
  infoText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 19 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.item / 2,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fff',
    marginBottom: spacing.item,
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
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.item,
  },
  cardContent: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', color: '#111' },
  cardGrade: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
});
