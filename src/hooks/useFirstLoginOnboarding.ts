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

    const key = `onboarding_seen_${org.orgId}_${user.uid}_${onboardingRole}`;

    // 600ms delay — long enough for the screen transition and overlay fade to complete.
    const timer = setTimeout(() => {
      if (toOnboardingRole(role) !== onboardingRole || didNavigate.current) return;
      AsyncStorage.getItem(key).then((seen) => {
        if (!seen && !didNavigate.current && toOnboardingRole(role) === onboardingRole) {
          didNavigate.current = true;
          AsyncStorage.setItem(key, '1').catch(() => {});
          navigation.navigate('HowToUse', { role: onboardingRole, isOnboarding: true });
        }
      }).catch(() => {});
    }, 600);

    return () => clearTimeout(timer);
  }, [user?.uid, org?.orgId, role, initializing, isLoadingOrg]);
}
