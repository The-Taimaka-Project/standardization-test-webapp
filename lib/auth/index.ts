import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { verifyPassword } from './passwords';

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  trustHost: true,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').toLowerCase().trim();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
        const u = rows[0];
        if (!u) return null;
        if (!u.emailVerifiedAt) return null;
        const ok = await verifyPassword(password, u.passwordHash);
        if (!ok) return null;
        return { id: u.id, email: u.email, name: u.name ?? null };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = (user as { id?: string }).id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) (session.user as { id?: string }).id = String(token.uid);
      return session;
    },
  },
});
