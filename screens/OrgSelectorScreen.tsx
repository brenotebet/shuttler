// screens/OrgSelectorScreen.tsx
//
// Step 1 of the new two-step login flow.
// Fetches the list of active orgs from the backend, lets the user search
// and pick theirs, then navigates to AuthScreen for the actual sign-in.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/StackNavigator';
import ScreenContainer from '../components/ScreenContainer';
import { useOrg, OrgConfig } from '../src/org/OrgContext';
import { SHUTTLER_API_URL } from '../config';
import { PRIMARY_COLOR } from '../src/constants/theme';
import { borderRadius, cardShadow, spacing } from '../src/styles/common';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Nav = NativeStackNavigationProp<RootStackParamList, 'OrgSelector' | 'CreateOrg'>;

const AUTH_METHOD_LABEL: Record<string, string> = {
  saml: 'SSO',
  email: 'Email',
  'email+google': 'Email',
};

export default function OrgSelectorScreen() {
  const navigation = useNavigation<Nav>();
  const { selectOrg } = useOrg();

  const [orgs, setOrgs] = useState<OrgConfig[]>([]);
  const [filtered, setFiltered] = useState<OrgConfig[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch(`${SHUTTLER_API_URL}/orgs`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data: OrgConfig[] = await res.json();
        if (!isMounted.current) return;
        setOrgs(data);
        setFiltered(data);
      } catch (e: any) {
        if (isMounted.current) setError('Could not load organizations. Check your connection.');
      } finally {
        if (isMounted.current) setIsLoading(false);
      }
    })();
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      const q = text.toLowerCase().trim();
      setFiltered(q ? orgs.filter((o) => o.name.toLowerCase().includes(q)) : orgs);
    },
    [orgs],
  );

  const handleSelect = useCallback(
    async (org: OrgConfig) => {
      await selectOrg(org);
      navigation.navigate('Auth', { orgId: org.orgId });
    },
    [navigation, selectOrg],
  );

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Shuttler</Text>
        <Text style={styles.subtitle}>Select your organization to continue</Text>
      </View>

      <View style={styles.searchRow}>
        <Icon name="search" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search organizations…"
          placeholderTextColor="#999"
          value={query}
          onChangeText={handleSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.centered} size="large" color={PRIMARY_COLOR} />
      ) : error ? (
        <View style={styles.centered}>
          <Icon name="wifi-off" size={40} color="#ccc" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No organizations found.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.orgId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.orgCard} onPress={() => handleSelect(item)} activeOpacity={0.75}>
              {item.logoUrl ? (
                <Image source={{ uri: item.logoUrl }} style={styles.orgLogo} resizeMode="contain" />
              ) : (
                <View style={[styles.orgLogo, styles.orgLogoPlaceholder]}>
                  <Icon name="directions-bus" size={26} color={PRIMARY_COLOR} />
                </View>
              )}
              <View style={styles.orgInfo}>
                <Text style={styles.orgName}>{item.name}</Text>
                <Text style={styles.orgType}>{item.mapCenter ? 'Active' : ''}</Text>
              </View>
              <View style={styles.authBadge}>
                <Text style={styles.authBadgeText}>
                  {AUTH_METHOD_LABEL[item.authMethod] ?? item.authMethod}
                </Text>
              </View>
              <Icon name="chevron-right" size={22} color="#ccc" />
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <TouchableOpacity
              style={styles.createOrgBtn}
              onPress={() => navigation.navigate('CreateOrg')}
              activeOpacity={0.8}
            >
              <Icon name="add-circle-outline" size={20} color={PRIMARY_COLOR} />
              <Text style={styles.createOrgBtnText}>Create a new organisation</Text>
            </TouchableOpacity>
          }
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    paddingTop: spacing.section,
    paddingBottom: spacing.section,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: PRIMARY_COLOR,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f2f2',
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.section,
    marginBottom: spacing.item,
    paddingHorizontal: spacing.item,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111',
  },
  list: {
    paddingHorizontal: spacing.section,
    paddingBottom: spacing.section * 2,
  },
  orgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    padding: spacing.item,
    marginBottom: spacing.item / 2,
    ...cardShadow,
  },
  orgLogo: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    marginRight: spacing.item,
  },
  orgLogoPlaceholder: {
    backgroundColor: '#f0f4ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgInfo: {
    flex: 1,
  },
  orgName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  orgType: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  authBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: borderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 8,
  },
  authBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: PRIMARY_COLOR,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    color: '#888',
    textAlign: 'center',
    maxWidth: 260,
    fontSize: 14,
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
  },
  createOrgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  createOrgBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY_COLOR,
  },
});
