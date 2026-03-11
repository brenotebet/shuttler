// src/auth/startSamlLogin.ts
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { SHUTTLER_API_URL } from '../../config';

// For iOS: makes the browser session return cleanly
WebBrowser.maybeCompleteAuthSession?.();

export async function startSamlLogin(orgSlug: string): Promise<string | null> {
  if (!SHUTTLER_API_URL) {
    throw new Error('Missing SHUTTLER_API_URL in config/.env');
  }

  const samlLoginUrl = `${SHUTTLER_API_URL}/saml/${orgSlug}/login`;

  // Use a runtime-aware callback URL so this works in Expo Go/dev client and standalone builds.
  const returnTo = Linking.createURL('sso');
  const joiner = samlLoginUrl.includes('?') ? '&' : '?';
  const loginUrl = `${samlLoginUrl}${joiner}returnTo=${encodeURIComponent(returnTo)}`;

  // Use auth-session mode so the browser closes when redirected to the app scheme.
  // preferEphemeralSession: true ensures no IdP session cookies carry over between
  // users on the same device — critical for driver account switching.
  const result = await WebBrowser.openAuthSessionAsync(loginUrl, returnTo, {
    preferEphemeralSession: true,
  });

  if (result.type === 'success') {
    return result.url;
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return null;
  }

  throw new Error(`SSO did not complete (result: ${result.type}).`);
}
