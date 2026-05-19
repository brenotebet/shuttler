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
  const { user, role } = useAuth();
  const { org } = useOrg();
  const navigation = useNavigation<Nav>();
  const didNavigate = useRef(false);
  // Track how long the current role has been stable before acting on it.
  const stableRole = useRef<OnboardingRole | null>(null);

  useEffect(() => {
    const onboardingRole = toOnboardingRole(role);

    // Reset stability if role changed to something different.
    if (onboardingRole !== stableRole.current) {
      stableRole.current = onboardingRole;
    }

    if (!user || !org || !onboardingRole || didNavigate.current) return;

    // Key is role-specific so admins see admin onboarding, students see rider
    // onboarding — even if they previously saw a different role's onboarding.
    const key = `onboarding_seen_${org.orgId}_${user.uid}_${onboardingRole}`;

    // Wait 400ms to ensure the role is stable and not a transient value.
    const timer = setTimeout(() => {
      if (toOnboardingRole(role) !== onboardingRole || didNavigate.current) return;
      AsyncStorage.getItem(key).then((seen) => {
        if (!seen && !didNavigate.current && toOnboardingRole(role) === onboardingRole) {
          didNavigate.current = true;
          AsyncStorage.setItem(key, '1').catch(() => {});
          navigation.navigate('HowToUse', { role: onboardingRole, isOnboarding: true });
        }
      }).catch(() => {});
    }, 400);

    return () => clearTimeout(timer);
  }, [user?.uid, org?.orgId, role]);
}
