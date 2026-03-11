import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { signInWithCustomToken } from 'firebase/auth';

import { auth } from '../../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../../config';

const SAML_HANDOFF_STORAGE_KEY = 'samlHandoffToken';

function isInvalidOrExpiredTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('Invalid or expired SAML handoff token') ||
    message.includes('Missing SAML handoff token')
  );
}

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
  await SecureStore.setItemAsync(SAML_HANDOFF_STORAGE_KEY, token);
}

async function exchangeAndSignIn(token: string) {
  const response = await fetch(`${SHUTTLER_API_URL}/saml/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ samlToken: token }),
  });

  if (!response.ok) {
    let serverError: string | undefined;
    try {
      const body = await response.json();
      if (body?.error) {
        serverError = String(body.error);
      } else if (body?.details) {
        serverError = String(body.details);
      }
    } catch {
      // ignore JSON parse failures and preserve generic fallback below
    }

    throw new Error(
      `Failed to exchange SAML handoff token (${response.status}${
        serverError ? `: ${serverError}` : ''
      })`,
    );
  }

  const { firebaseToken } = await response.json();
  if (!firebaseToken) {
    throw new Error('SAML exchange succeeded but firebaseToken was missing in response');
  }

  try {
    console.log("Client Firebase Project:", auth.app.options.projectId);
    await signInWithCustomToken(auth, firebaseToken);
  } catch (error: any) {
    const code = typeof error?.code === 'string' ? error.code : '';
    if (code === 'auth/custom-token-mismatch') {
      throw new Error(
        'Firebase sign-in failed (auth/custom-token-mismatch). The backend is minting custom tokens for a different Firebase project than this app is configured to use.',
      );
    }

    const message =
      typeof error?.message === 'string' && error.message.trim()
        ? error.message
        : 'Unknown Firebase sign-in error';
    throw new Error(`Firebase sign-in failed (${code || 'no-code'}): ${message}`);
  }
}

/**
 * Clear any persisted SAML handoff token. Call this during logout so a stale
 * token cannot be replayed on the next login attempt on the same device.
 */
export async function clearSamlSession() {
  await SecureStore.deleteItemAsync(SAML_HANDOFF_STORAGE_KEY);
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

  const usingCachedToken = !initialToken;
  let tokenToUse = initialToken;
  if (!tokenToUse) {
    tokenToUse = await SecureStore.getItemAsync(SAML_HANDOFF_STORAGE_KEY);
  }

  if (!tokenToUse) {
    return false;
  }

  try {
    await exchangeAndSignIn(tokenToUse);
  } catch (error) {
    // Cached tokens can legitimately expire between launches. If that happens,
    // clear the stale token so users can start a fresh SSO flow.
    if (usingCachedToken && isInvalidOrExpiredTokenError(error)) {
      await SecureStore.deleteItemAsync(SAML_HANDOFF_STORAGE_KEY);
      return false;
    }
    throw error;
  }

  await SecureStore.deleteItemAsync(SAML_HANDOFF_STORAGE_KEY);
  return true;
}
