// src/auth/startSamlLogin.ts
import * as WebBrowser from 'expo-web-browser';
import { QUICKLAUNCH_AUTHORIZATION_ENDPOINT } from '../../config';

// For iOS: makes the browser session return cleanly
WebBrowser.maybeCompleteAuthSession?.();

export async function startSamlLogin() {
  if (!QUICKLAUNCH_AUTHORIZATION_ENDPOINT) {
    throw new Error('Missing QUICKLAUNCH_AUTHORIZATION_ENDPOINT in config/.env');
  }

  // Opens the IdP login page (QuickLaunch). After login, QuickLaunch -> /saml/acs -> redirects back to the app deep link.
  await WebBrowser.openBrowserAsync(QUICKLAUNCH_AUTHORIZATION_ENDPOINT);
}
