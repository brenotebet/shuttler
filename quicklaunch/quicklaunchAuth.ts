import * as AuthSession from 'expo-auth-session';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import {
  QUICKLAUNCH_AUTHORIZATION_ENDPOINT,
  QUICKLAUNCH_CLIENT_ID,
  QUICKLAUNCH_TOKEN_EXCHANGE_URL,
} from '../config';

/**
 * Initiates the QuickLaunch login flow and signs the user into Firebase using
 * a custom token returned from your backend.
 */
export async function signInWithQuickLaunch() {
  const redirectUri = AuthSession.makeRedirectUri({ useProxy: true } as any);
  const authUrl = `${QUICKLAUNCH_AUTHORIZATION_ENDPOINT}?client_id=${encodeURIComponent(
    QUICKLAUNCH_CLIENT_ID,
  )}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;

  const result = await (AuthSession as any).startAsync({ authUrl });

  if (result.type !== 'success' || !result.params?.code) {
    throw new Error('QuickLaunch authentication failed');
  }

  const exchangeRes = await fetch(QUICKLAUNCH_TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: result.params.code, redirectUri }),
  });

  if (!exchangeRes.ok) {
    throw new Error('Failed to exchange QuickLaunch token');
  }

  const { firebaseToken } = await exchangeRes.json();

  await signInWithCustomToken(auth, firebaseToken);
}
