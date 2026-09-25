import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../auth/AuthProvider';
import { useOrg } from '../org/OrgContext';
import type { RootStackParamList } from '../../navigation/StackNavigator';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type OnboardingRole = RootStackParamList['HowToUse']['role'];

function toOnboardingRole(role: string | null | undefined): OnboardingRole | null {
  if (role === 'student' || role === 'driver' || role === 'admin' || role === 'parent') {
    return role;
  }
  return null;
}

// This hook mounts independently on up to 4 screens (Map, DriverScreen,
// DriverMenuScreen, AdminOrgSetupScreen). If two happen to mount within the
// same 600ms window (e.g. a tab switch right at app startup), each has its
// own per-instance `didNavigate` ref and would otherwise both pass the
// AsyncStorage "seen" check before either writes it, firing two navigations.
// This module-level lock makes the check-and-navigate atomic across every
// instance for a given user+org, regardless of how many are mounted.
const inFlightKeys = new Set<string>();

export function useFirstLoginOnboarding() {
  const { user, role, initializing } = useAuth();
  const { org, isLoadingOrg } = useOrg();
  const navigation = useNavigation<Nav>();
  const didNavigate = useRef(false);
  const stableRole = useRef<OnboardingRole | null>(null);

  useEffect(() => {
    const onboardingRole = toOnboardingRole(role);

    if (onboardingRole !== stableRole.current) {
      stableRole.current = onboardingRole;
    }

    // Don't fire while auth or org is still loading — the overlay is still showing
    // and navigation would be invisible or race against the screen appearing.
    if (!user || !org || !onboardingRole || didNavigate.current || initializing || isLoadingOrg) return;

    // Deliberately not role-scoped: a role stack switch (e.g. cache reporting
    // 'student' before the server confirms 'admin') remounts this hook fresh
    // with a new `didNavigate` ref, so a role-specific key would let the
    // corrected role fire its own onboarding right after the wrong one already
    // showed. One tour per user per org is the intent, not one per role seen.
    const key = `onboarding_seen_${org.orgId}_${user.uid}`;

    // 600ms delay — long enough for the screen transition and overlay fade to complete.
    const timer = setTimeout(() => {
      if (toOnboardingRole(role) !== onboardingRole || didNavigate.current) return;
      // Another mounted instance is already mid-check for this same key — bail
      // rather than race it.
      if (inFlightKeys.has(key)) return;
      inFlightKeys.add(key);
      AsyncStorage.getItem(key).then((seen) => {
        if (!seen && !didNavigate.current && toOnboardingRole(role) === onboardingRole) {
          didNavigate.current = true;
          AsyncStorage.setItem(key, '1').catch(() => {});
          // Only the founding admin (org has no stops yet) is walked through org
          // setup — an admin invited into an already-configured org would otherwise
          // see setup instructions referencing a screen that isn't open.
          const isOnboarding = onboardingRole !== 'admin' || (org.stops?.length ?? 0) === 0;
          navigation.navigate('HowToUse', { role: onboardingRole, isOnboarding });
        }
      }).catch(() => {}).finally(() => {
        inFlightKeys.delete(key);
      });
    }, 600);

    return () => clearTimeout(timer);
  }, [user?.uid, org?.orgId, role, initializing, isLoadingOrg]);
}
