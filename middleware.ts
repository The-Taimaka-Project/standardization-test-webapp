import { NextRequest, NextResponse } from 'next/server';

/**
 * Edge-runtime-friendly auth gate. We deliberately do NOT call Auth.js's
 * `auth()` here — that pulls in the DB layer (pg, dotenv) which can't run on
 * the edge. Instead we look for the next-auth session cookie. The actual JWT
 * verification still runs in route handlers / server components via `auth()`,
 * which IS Node-runtime. This is just a fast-path redirect for unauthenticated
 * users; the per-request `auth()` call inside server actions and pages
 * remains the source of truth.
 */
export const config = {
  matcher: ['/((?!api/auth|login|signup|forgot|reset|verify|_next/static|_next/image|favicon.ico).*)'],
};

const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export default function middleware(req: NextRequest) {
  const hasSessionCookie = SESSION_COOKIES.some((c) => req.cookies.get(c));
  if (!hasSessionCookie) {
    const publicOrigin = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL;
    const url = publicOrigin ? new URL('/login', publicOrigin) : new URL('/login', req.url);
    url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
