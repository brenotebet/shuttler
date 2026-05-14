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

  useEffect(() => {
    const onboardingRole = toOnboardingRole(role);
    if (!user || !org || !onboardingRole || didNavigate.current) return;

    const key = `onboarding_seen_${org.orgId}_${user.uid}`;
    AsyncStorage.getItem(key).then((seen) => {
      // Re-check role hasn't changed while we waited for AsyncStorage
      if (!seen && !didNavigate.current && toOnboardingRole(role) === onboardingRole) {
        didNavigate.current = true;
        AsyncStorage.setItem(key, '1').catch(() => {});
        navigation.navigate('HowToUse', { role: onboardingRole, isOnboarding: true });
      }
    }).catch(() => {});
  }, [user?.uid, org?.orgId, role]);
}
