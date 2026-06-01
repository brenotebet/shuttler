// Module-level flag set just before signInWithCredential so AuthProvider's
// Firestore snapshot knows a user doc is about to be created and should not
// evict the user if it briefly returns "not found."
let _pending = false;

export function markSocialSignInPending(): void  { _pending = true;  }
export function clearSocialSignInPending(): void  { _pending = false; }
export function isSocialSignInPending(): boolean  { return _pending;  }
