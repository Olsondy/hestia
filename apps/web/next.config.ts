import type { NextConfig } from 'next';
// LAN demos (docs/demo/home-h5-demo.md): BETTER_AUTH_URL points at the machine's LAN address, whose hostname must be
// allowed to load dev-only assets; loopback needs nothing.
const devHost = (() => { try { return new URL(process.env.BETTER_AUTH_URL ?? '').hostname; } catch { return ''; } })();
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['pg'],
  ...(devHost && !['localhost', '127.0.0.1'].includes(devHost) ? { allowedDevOrigins: [devHost] } : {}),
};
export default config;
