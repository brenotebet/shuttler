export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;

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
export const SAML_IDP_ENTITY_ID = process.env.SAML_IDP_ENTITY_ID;
export const SAML_IDP_SSO_URL = process.env.SAML_IDP_SSO_URL;
export const SAML_IDP_CERT_FINGERPRINT = process.env.SAML_IDP_CERT_FINGERPRINT;
export const SAML_SP_ENTITY_ID = 'com.example.bogeybus';
export const SAML_SP_ACS_URL = 'https://YOUR-BACKEND/saml/acs';
