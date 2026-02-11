// src/auth/startSamlLogin.ts
import * as WebBrowser from 'expo-web-browser';
import { APP_DEEP_LINK_SCHEME, SAML_LOGIN_URL } from '../../config';

// For iOS: makes the browser session return cleanly
WebBrowser.maybeCompleteAuthSession?.();

export async function startSamlLogin() {
  if (!SAML_LOGIN_URL) {
    throw new Error('Missing SAML_LOGIN_URL in config/.env');
  }

  const returnTo = `${APP_DEEP_LINK_SCHEME}://sso`;
  const joiner = SAML_LOGIN_URL.includes('?') ? '&' : '?';
  const loginUrl = `${SAML_LOGIN_URL}${joiner}returnTo=${encodeURIComponent(returnTo)}`;

  // Opens the IdP login page. After login, IdP -> /saml/acs -> redirects back to app deep link.
  await WebBrowser.openBrowserAsync(loginUrl);
}
