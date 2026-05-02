'use server';

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db, schema } from '@/lib/db';
import { hashPassword } from './passwords';
import { sendVerificationEmail, sendPasswordResetEmail } from './email';

const ALLOWED_DOMAIN = process.env.SIGNUP_ALLOWED_DOMAIN ?? 'taimaka.org';

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(200),
});

export interface ActionResult {
  ok: boolean;
  error?: string;
  // Sent only in dev mode so the integration test can grab the verification link.
  devLink?: string;
}

function publicUrl(): string {
  return process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

export async function signupAction(formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    email: String(formData.get('email') ?? '').toLowerCase().trim(),
    name: formData.get('name') ? String(formData.get('name')).trim() : undefined,
    password: String(formData.get('password') ?? ''),
  });
  if (!parsed.success) return { ok: false, error: 'Please enter a valid email and a password ≥ 8 characters.' };
  const { email, name, password } = parsed.data;

  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return { ok: false, error: `Only @${ALLOWED_DOMAIN} addresses can sign up.` };
  }

  // Check for existing user.
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (existing[0]) {
    if (existing[0].emailVerifiedAt) {
      return { ok: false, error: 'An account with that email already exists.' };
    }
    // Re-issue verification token: replace the user's password hash with the
    // new one so an unverified user can correct typos by signing up again.
    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(password), name: name ?? existing[0].name })
      .where(eq(schema.users.id, existing[0].id));
    return await issueVerification(existing[0].id, email);
  }

  const passwordHash = await hashPassword(password);
  const inserted = await db
    .insert(schema.users)
    .values({ email, name: name ?? null, passwordHash })
    .returning();
  const user = inserted[0];
  return await issueVerification(user.id, email);
}

async function issueVerification(userId: string, email: string): Promise<ActionResult> {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 3600_000);
  await db.insert(schema.emailVerificationTokens).values({ token, userId, expiresAt });
  const link = `${publicUrl()}/verify?token=${token}`;
  try {
    await sendVerificationEmail(email, link);
  } catch (e) {
    console.error('Resend send failed:', e);
    return {
      ok: false,
      error: 'Could not send the verification email. Try again or contact your admin.',
    };
  }
  return { ok: true, devLink: process.env.NODE_ENV === 'development' ? link : undefined };
}

export async function consumeVerificationTokenAction(token: string): Promise<ActionResult> {
  const rows = await db
    .select()
    .from(schema.emailVerificationTokens)
    .where(eq(schema.emailVerificationTokens.token, token));
  const t = rows[0];
  if (!t) return { ok: false, error: 'Invalid or already-used verification link.' };
  if (t.usedAt) return { ok: false, error: 'This verification link has already been used.' };
  if (t.expiresAt < new Date()) return { ok: false, error: 'This verification link has expired.' };
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, t.userId));
    await tx
      .update(schema.emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.emailVerificationTokens.token, token));
  });
  return { ok: true };
}

export async function requestPasswordResetAction(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  if (!email) return { ok: false, error: 'Enter your email.' };

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
  const u = rows[0];
  // Always answer "ok" so the form doesn't leak which addresses are registered.
  if (!u) return { ok: true };

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 3600_000);
  await db.insert(schema.passwordResetTokens).values({ token, userId: u.id, expiresAt });
  const link = `${publicUrl()}/reset?token=${token}`;
  try {
    await sendPasswordResetEmail(email, link);
  } catch (e) {
    console.error('Resend send failed:', e);
    // Still report ok — don't reveal address validity. Admins can debug from logs.
  }
  return { ok: true, devLink: process.env.NODE_ENV === 'development' ? link : undefined };
}

export async function consumePasswordResetTokenAction(
  token: string,
  newPassword: string,
): Promise<ActionResult> {
  if (newPassword.length < 8) return { ok: false, error: 'Password must be ≥ 8 characters.' };
  const rows = await db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.token, token));
  const t = rows[0];
  if (!t) return { ok: false, error: 'Invalid or already-used reset link.' };
  if (t.usedAt) return { ok: false, error: 'This reset link has already been used.' };
  if (t.expiresAt < new Date()) return { ok: false, error: 'This reset link has expired.' };
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ passwordHash, emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, t.userId));
    await tx
      .update(schema.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(schema.passwordResetTokens.token, token));
  });
  return { ok: true };
}
