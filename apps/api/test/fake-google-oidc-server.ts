import { startFakeGoogleOidc } from './fixtures/fake-google-oidc';

/**
 * Runs the fake Google OpenID Connect server for Playwright on 127.0.0.1, a different site from the
 * web app and API on localhost, so the consent page's "Continue" link is a cross-site navigation.
 * Point the API at it with the GOOGLE_* values it prints (issuer = http://127.0.0.1:<port>).
 * FAKE_GOOGLE_REDIRECT_URI registers the API's callback when it is not on http://localhost:4000.
 */
const port = Number(process.env.FAKE_GOOGLE_PORT ?? '4100');
const google = await startFakeGoogleOidc({
  port,
  ...(process.env.GOOGLE_CLIENT_ID ? { clientId: process.env.GOOGLE_CLIENT_ID } : {}),
  ...(process.env.GOOGLE_CLIENT_SECRET ? { clientSecret: process.env.GOOGLE_CLIENT_SECRET } : {}),
  ...(process.env.FAKE_GOOGLE_REDIRECT_URI
    ? { redirectUris: [process.env.FAKE_GOOGLE_REDIRECT_URI] }
    : {}),
});
console.info(`fake Google OIDC listening on ${google.origin}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void google.close().then(() => process.exit(0));
  });
}
