import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Static security headers. The Content-Security-Policy needs a per-request nonce so Next.js can
// run its own scripts without allowing inline scripts; it is set in `src/proxy.ts`.
const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The repository keeps its own AGENTS.md; do not let `next dev` generate one inside apps/web.
  agentRules: false,
  transpilePackages: ['@argent/shared'],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default withNextIntl(nextConfig);
