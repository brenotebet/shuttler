const getPublicEnvVar = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    console.warn(`Environment variable ${key} is not defined.`);
    return '';
  }

  return value;
};

export const GOOGLE_MAPS_API_KEY = getPublicEnvVar('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY');

// QuickLaunch OIDC configuration. Replace the placeholder values with your
// institution specific endpoints and client information.
export const QUICKLAUNCH_AUTHORIZATION_ENDPOINT =
  'https://YOUR-QUICKLAUNCH-DOMAIN/oidc/authorize';
export const QUICKLAUNCH_TOKEN_ENDPOINT =
  'https://YOUR-QUICKLAUNCH-DOMAIN/oidc/token';
export const QUICKLAUNCH_CLIENT_ID = 'YOUR-CLIENT-ID';

// Endpoint on your backend that exchanges a QuickLaunch token for a Firebase
// custom token.
export const QUICKLAUNCH_TOKEN_EXCHANGE_URL =
  'https://YOUR-BACKEND/quicklaunch/exchange';

// SAML handoff configuration for the school app SSO flow.
// The exchange URL should validate the SAML assertion or one-time token and
// return a Firebase custom token.
export const SAML_TOKEN_EXCHANGE_URL = 'https://YOUR-BACKEND/saml/exchange';
export const SAML_IDP_ENTITY_ID = process.env.EXPO_PUBLIC_SAML_IDP_ENTITY_ID;
export const SAML_IDP_SSO_URL = process.env.EXPO_PUBLIC_SAML_IDP_SSO_URL;
export const SAML_IDP_CERT_FINGERPRINT = process.env.EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT;
export const SAML_SP_ENTITY_ID = 'com.example.bogeybus';
export const SAML_SP_ACS_URL = 'https://YOUR-BACKEND/saml/acs';
