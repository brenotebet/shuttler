import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInWithCustomToken } from 'firebase/auth';

import { auth } from '../../firebase/firebaseconfig';
import { SAML_TOKEN_EXCHANGE_URL } from '../../config';

const SAML_HANDOFF_STORAGE_KEY = 'samlHandoffToken';

function extractTokenFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const parsed = Linking.parse(url);
  const params = parsed.queryParams ?? {};
  const tokenParam =
    (params.samlToken as string) ||
    (params.saml_token as string) ||
    (params.samlHandoff as string);
  return tokenParam ?? null;
}

async function cacheToken(token: string) {
  await AsyncStorage.setItem(SAML_HANDOFF_STORAGE_KEY, token);
}

async function exchangeAndSignIn(token: string) {
  const response = await fetch(SAML_TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ samlToken: token }),
  });

  if (!response.ok) {
    throw new Error('Failed to exchange SAML handoff token');
  }

  const { firebaseToken } = await response.json();
  await signInWithCustomToken(auth, firebaseToken);
}

/**
 * Store a token from a deep link so it can be consumed after the app is ready.
 */
export async function persistSamlHandoffFromUrl(url?: string | null) {
  const token = extractTokenFromUrl(url);
  if (token) {
    await cacheToken(token);
  }
}

/**
 * Try to complete a SAML handoff login either from the provided URL, an
 * initial deep link, or a token cached in storage. Returns true if a login was
 * completed.
 */
export async function trySamlHandoffLogin(urlFromEvent?: string | null) {
  const eventToken = extractTokenFromUrl(urlFromEvent);
  const initialUrl = urlFromEvent ? null : await Linking.getInitialURL();
  const initialToken = eventToken ?? extractTokenFromUrl(initialUrl);

  let tokenToUse = initialToken;
  if (!tokenToUse) {
    tokenToUse = await AsyncStorage.getItem(SAML_HANDOFF_STORAGE_KEY);
  }

  if (!tokenToUse) {
    return false;
  }

  await exchangeAndSignIn(tokenToUse);
  await AsyncStorage.removeItem(SAML_HANDOFF_STORAGE_KEY);
  return true;
}
