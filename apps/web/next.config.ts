import type { NextConfig } from 'next';
// LAN demos (docs/demo/home-h5-demo.md): BETTER_AUTH_URL points at the machine's LAN address, whose hostname must be
// allowed to load dev-only assets; loopback needs nothing. `*.localhost` serves local multi-enterprise checks (ADR-0017).
const devHost = (() => { try { return new URL(process.env.BETTER_AUTH_URL ?? '').hostname; } catch { return ''; } })();
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['pg'],
  allowedDevOrigins: ['*.localhost', ...(devHost && !['localhost', '127.0.0.1'].includes(devHost) ? [devHost] : [])],
};
export default config;
