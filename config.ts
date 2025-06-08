export const GOOGLE_MAPS_API_KEY = 'AIzaSyDwGsJH6urDO1c1LYUqnQeprYNesmNSBFs';

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
