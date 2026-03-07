// config.ts

const isProductionBuild =
  process.env.NODE_ENV === 'production' ||
  (typeof __DEV__ !== 'undefined' && !__DEV__);

const handleMissingEnvVar = (key: string): string => {
  const message = `Environment variable ${key} is not defined.`;
  if (isProductionBuild) {
    throw new Error(message);
  }
  console.warn(message);
  return '';
};

// Static map so Metro can inline each EXPO_PUBLIC_* value at build time.
// process.env[dynamicKey] is never replaced by Metro's transform — only
// literal accesses like process.env.EXPO_PUBLIC_FOO are inlined.
const _env: Record<string, string> = {
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  EXPO_PUBLIC_QUICKLAUNCH_AUTHORIZATION_ENDPOINT: process.env.EXPO_PUBLIC_QUICKLAUNCH_AUTHORIZATION_ENDPOINT ?? '',
  EXPO_PUBLIC_QUICKLAUNCH_TOKEN_ENDPOINT: process.env.EXPO_PUBLIC_QUICKLAUNCH_TOKEN_ENDPOINT ?? '',
  EXPO_PUBLIC_QUICKLAUNCH_CLIENT_ID: process.env.EXPO_PUBLIC_QUICKLAUNCH_CLIENT_ID ?? '',
  EXPO_PUBLIC_QUICKLAUNCH_TOKEN_EXCHANGE_URL: process.env.EXPO_PUBLIC_QUICKLAUNCH_TOKEN_EXCHANGE_URL ?? '',
  EXPO_PUBLIC_SAML_TOKEN_EXCHANGE_URL: process.env.EXPO_PUBLIC_SAML_TOKEN_EXCHANGE_URL ?? '',
  EXPO_PUBLIC_SAML_LOGIN_URL: process.env.EXPO_PUBLIC_SAML_LOGIN_URL ?? '',
  EXPO_PUBLIC_SAML_IDP_ENTITY_ID: process.env.EXPO_PUBLIC_SAML_IDP_ENTITY_ID ?? '',
  EXPO_PUBLIC_SAML_IDP_SSO_URL: process.env.EXPO_PUBLIC_SAML_IDP_SSO_URL ?? '',
  EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT: process.env.EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT ?? '',
  EXPO_PUBLIC_SAML_SP_ENTITY_ID: process.env.EXPO_PUBLIC_SAML_SP_ENTITY_ID ?? '',
  EXPO_PUBLIC_SAML_SP_ACS_URL: process.env.EXPO_PUBLIC_SAML_SP_ACS_URL ?? '',
  EXPO_PUBLIC_APP_SCHEME: process.env.EXPO_PUBLIC_APP_SCHEME ?? '',
};

const getPublicEnvVar = (key: string): string => {
  const value = (_env[key] ?? '').trim();
  if (!value) {
    return handleMissingEnvVar(key);
  }
  return value;
};

const getSecureUrlEnvVar = (key: string): string => {
  const value = getPublicEnvVar(key);
  if (!value) return value;

  if (!value.startsWith('https://')) {
    const message = `Environment variable ${key} must be a secure HTTPS URL.`;
    if (isProductionBuild) {
      throw new Error(message);
    }
    console.warn(message);
  }

  return value;
};

export const GOOGLE_MAPS_API_KEY = getPublicEnvVar(
  'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY',
);

// -------------------- QuickLaunch (OIDC) --------------------
export const QUICKLAUNCH_AUTHORIZATION_ENDPOINT = getSecureUrlEnvVar(
  'EXPO_PUBLIC_QUICKLAUNCH_AUTHORIZATION_ENDPOINT',
);

export const QUICKLAUNCH_TOKEN_ENDPOINT = getSecureUrlEnvVar(
  'EXPO_PUBLIC_QUICKLAUNCH_TOKEN_ENDPOINT',
);

export const QUICKLAUNCH_CLIENT_ID = getPublicEnvVar(
  'EXPO_PUBLIC_QUICKLAUNCH_CLIENT_ID',
);

// Backend endpoint that exchanges code+PKCE for Firebase custom token
export const QUICKLAUNCH_TOKEN_EXCHANGE_URL = getSecureUrlEnvVar(
  'EXPO_PUBLIC_QUICKLAUNCH_TOKEN_EXCHANGE_URL',
);

// -------------------- School SSO (SAML) --------------------

// Backend endpoint that exchanges SAML handoff token for Firebase custom token
export const SAML_TOKEN_EXCHANGE_URL = getSecureUrlEnvVar(
  'EXPO_PUBLIC_SAML_TOKEN_EXCHANGE_URL',
);

// SP-initiated login URL on the server (start here to begin SSO)
export const SAML_LOGIN_URL = getSecureUrlEnvVar(
  'EXPO_PUBLIC_SAML_LOGIN_URL',
);

// Optional: you may not need these in the mobile app anymore, but keeping them here
// in case you display or log them (do NOT show cert in UI).
export const SAML_IDP_ENTITY_ID = getPublicEnvVar('EXPO_PUBLIC_SAML_IDP_ENTITY_ID');
export const SAML_IDP_SSO_URL = getSecureUrlEnvVar('EXPO_PUBLIC_SAML_IDP_SSO_URL');
export const SAML_IDP_CERT_FINGERPRINT = getPublicEnvVar('EXPO_PUBLIC_SAML_IDP_CERT_FINGERPRINT');

// These are mainly for the SERVER, but you can still keep them in app config if needed
export const SAML_SP_ENTITY_ID = getPublicEnvVar('EXPO_PUBLIC_SAML_SP_ENTITY_ID');
export const SAML_SP_ACS_URL = getSecureUrlEnvVar('EXPO_PUBLIC_SAML_SP_ACS_URL');

// Your app deep link scheme (you told me it is bogeybus)
export const APP_DEEP_LINK_SCHEME = getPublicEnvVar('EXPO_PUBLIC_APP_SCHEME');
