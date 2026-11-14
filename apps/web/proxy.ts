import { NextResponse, type NextRequest } from 'next/server';

// Platform console host (ADR-0018). /admin and /api/admin exist only on HESTIA_ADMIN_HOST: anywhere else they get the
// same 404 as any missing path, so an enterprise domain does not reveal the console. On the admin host only the
// console, sign-in and static assets are served. Kept free of database modules: Proxy runs before the app.
const hostOf = (raw: string | null | undefined) => raw?.split(',').at(-1)?.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '') || null;
const consolePath = /^\/(?:api\/)?admin(?:\/|$)/;
const adminHostPaths = /^\/(?:admin(?:\/|$)|api\/admin\/|api\/auth\/|fonts\/|vendor\/)/;

export function proxy(request: NextRequest) {
  const admin = hostOf(process.env.HESTIA_ADMIN_HOST), header = process.env.HESTIA_HOST_HEADER?.trim();
  const host = hostOf(header ? request.headers.get(header) : request.headers.get('host'));
  const { pathname } = request.nextUrl, onAdmin = !!admin && host === admin;
  if (consolePath.test(pathname) && !onAdmin) return NextResponse.rewrite(new URL('/_hestia/not-found', request.url));
  if (onAdmin && !adminHostPaths.test(pathname)) return NextResponse.redirect(new URL('/admin', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/|favicon\\.ico).*)'] };
