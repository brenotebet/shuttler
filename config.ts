const isProductionBuild =
  process.env.NODE_ENV === 'production' || (typeof __DEV__ !== 'undefined' && !__DEV__);

const handleMissingEnvVar = (key: string): string => {
  const message = `Environment variable ${key} is not defined.`;
  if (isProductionBuild) {
    throw new Error(message);
  }
  console.warn(message);
  return '';
};

const getPublicEnvVar = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    return handleMissingEnvVar(key);
  }

  return value;
};

const getSecureUrlEnvVar = (key: string): string => {
  const value = getPublicEnvVar(key);
  if (!value) {
    return value;
  }

  if (!value.startsWith('https://')) {
    const message = `Environment variable ${key} must be a secure HTTPS URL.`;
    if (isProductionBuild) {
      throw new Error(message);
    }
    console.warn(message);
  }

  return value;
};

export const GOOGLE_MAPS_API_KEY = getPublicEnvVar('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY');

// QuickLaunch OIDC configuration. These must point at your institution-specific
// endpoints and client information.
export const QUICKLAUNCH_AUTHORIZATION_ENDPOINT = getSecureUrlEnvVar(
  'EXPO_PUBLIC_QUICKLAUNCH_AUTHORIZATION_ENDPOINT',
);
export const QUICKLAUNCH_TOKEN_ENDPOINT = getSecureUrlEnvVar(
  'EXPO_PUBLIC_QUICKLAUNCH_TOKEN_ENDPOINT',
);
export const QUICKLAUNCH_CLIENT_ID = getPublicEnvVar('EXPO_PUBLIC_QUICKLAUNCH_CLIENT_ID');

// Endpoint on your backend that validates QuickLaunch auth codes, verifies the
// PKCE verifier, and mints Firebase custom tokens.
export const QUICKLAUNCH_TOKEN_EXCHANGE_URL = getSecureUrlEnvVar(
  'EXPO_PUBLIC_QUICKLAUNCH_TOKEN_EXCHANGE_URL',
);

// SAML handoff configuration for the school app SSO flow.
// The exchange URL should validate the SAML assertion or one-time token and
// return a Firebase custom token.
export const SAML_TOKEN_EXCHANGE_URL = 'https://YOUR-BACKEND/saml/exchange';
export const SAML_IDP_ENTITY_ID = process.env.EXPO_PUBLIC_SAML_IDP_ENTITY_ID;
export const SAML_IDP_SSO_URL = process.env.EXPO_PUBLIC_SAML_IDP_SSO_URL;
export const SAML_IDP_CERT_FINGERPRINT = process.env.EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT;
export const SAML_SP_ENTITY_ID = 'com.example.bogeybus';
export const SAML_SP_ACS_URL = 'https://YOUR-BACKEND/saml/acs';
