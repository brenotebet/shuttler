import { useEffect, useState } from 'react';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../../firebase/firebaseconfig';
import { useAuth } from '../auth/AuthProvider';

export type ProfileStatus = {
  missingFields: string[];
  isComplete: boolean;
  isLoading: boolean;
};

export function useProfileStatus(): ProfileStatus {
  const { user, orgId, displayName, phone, role } = useAuth();
  const [hasChildren, setHasChildren] = useState<boolean | null>(null);

  useEffect(() => {
    if (role !== 'parent' || !user?.uid || !orgId) {
      setHasChildren(null);
      return;
    }
    getDocs(query(collection(db, 'orgs', orgId, 'users', user.uid, 'children'), limit(1)))
      .then((snap) => setHasChildren(!snap.empty))
      .catch(() => setHasChildren(false));
  }, [role, user?.uid, orgId]);

  const missingFields: string[] = [];

  // Name: must be present and contain at least two words (first + last)
  const nameParts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!displayName?.trim()) {
    missingFields.push('full name');
  } else if (nameParts.length < 2) {
    missingFields.push('last name');
  }

  // Phone: required for all roles
  if (!phone?.trim()) {
    missingFields.push('phone number');
  }

  // Parents must have at least one child profile
  if (role === 'parent' && hasChildren === false) {
    missingFields.push('child profile');
  }

  const waitingForChildren = role === 'parent' && hasChildren === null;

  return {
    missingFields,
    isComplete: missingFields.length === 0,
    isLoading: waitingForChildren,
  };
}
