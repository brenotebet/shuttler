// src/auth/startSamlLogin.ts
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { SAML_LOGIN_URL } from '../../config';

// For iOS: makes the browser session return cleanly
WebBrowser.maybeCompleteAuthSession?.();

export async function startSamlLogin(): Promise<string | null> {
  if (!SAML_LOGIN_URL) {
    throw new Error('Missing SAML_LOGIN_URL in config/.env');
  }

  // Use a runtime-aware callback URL so this works in Expo Go/dev client and standalone builds.
  const returnTo = Linking.createURL('sso');
  const joiner = SAML_LOGIN_URL.includes('?') ? '&' : '?';
  const loginUrl = `${SAML_LOGIN_URL}${joiner}returnTo=${encodeURIComponent(returnTo)}`;

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

  throw new Error(`School SSO did not complete (result: ${result.type}).`);
}
