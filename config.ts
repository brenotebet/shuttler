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
  EXPO_PUBLIC_SHUTTLER_API_URL: process.env.EXPO_PUBLIC_SHUTTLER_API_URL ?? '',
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

export const GOOGLE_MAPS_API_KEY = getPublicEnvVar('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY');

// Base URL for all Shuttler backend API calls.
// e.g. https://api.shuttler.app
// In development, use http://localhost:3000 (no HTTPS check needed)
export const SHUTTLER_API_URL = getSecureUrlEnvVar('EXPO_PUBLIC_SHUTTLER_API_URL');

// Deep link scheme for this app
export const APP_SCHEME = 'shuttler';
