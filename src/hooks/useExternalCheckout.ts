import { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState, Linking } from 'react-native';

export type CheckoutResult = { type: 'success'; url: string } | { type: 'dismissed' };

// Stripe Checkout/Portal must open in the user's actual Safari app, not an
// embedded sheet (WebBrowser.openAuthSessionAsync) — Apple's 3.1.1 review
// treats an in-app browser session as an in-app purchase even though it's
// Safari-backed under the hood. Confirming first makes the external
// hand-off unambiguous. The returned promise resolves once Stripe redirects
// back to `returnUrl` (caught via the app's shuttler:// scheme), or once the
// user returns to the app without completing checkout.
export function useExternalCheckout(returnUrl: string) {
  const resolverRef = useRef<((result: CheckoutResult) => void) | null>(null);

  const resolveOnce = useCallback((result: CheckoutResult) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith(returnUrl)) resolveOnce({ type: 'success', url });
    });
    return () => sub.remove();
  }, [returnUrl, resolveOnce]);

  const openExternalCheckout = useCallback(
    (url: string, message: string) =>
      new Promise<CheckoutResult>((resolve) => {
        Alert.alert(
          'Leaving Shuttler',
          message,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve({ type: 'dismissed' }) },
            {
              text: 'Continue',
              onPress: () => {
                resolverRef.current = resolve;
                // The shuttler:// redirect usually arrives right as the app
                // becomes active again; give it a moment before falling
                // back to "user came back without finishing checkout".
                const appStateSub = AppState.addEventListener('change', (state) => {
                  if (state !== 'active') return;
                  appStateSub.remove();
                  setTimeout(() => resolveOnce({ type: 'dismissed' }), 800);
                });
                Linking.openURL(url);
              },
            },
          ],
          { cancelable: false },
        );
      }),
    [resolveOnce],
  );

  return openExternalCheckout;
}
