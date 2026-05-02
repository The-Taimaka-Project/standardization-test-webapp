'use server';

import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/odk/crypto';
import { exchangeToken, fetchSubmissions, OdkAuthError, requestEditUrl, type OdkSubmission } from '@/lib/odk/client';

async function requireUserId(): Promise<string> {
  const s = await auth();
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error('Not authenticated');
  return id;
}

const DEFAULT_BASE = process.env.ODK_DEFAULT_BASE_URL ?? 'https://taimaka-internal.org:7443';

export async function getOdkConfigAction() {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(schema.odkCredentials)
    .where(eq(schema.odkCredentials.userId, userId));
  const r = rows[0];
  if (!r) {
    return {
      hasToken: false as const,
      baseUrl: DEFAULT_BASE,
      email: '',
    };
  }
  const tokenStillValid = r.encryptedToken && r.tokenExpiresAt && r.tokenExpiresAt > new Date();
  return {
    hasToken: !!tokenStillValid,
    baseUrl: r.baseUrl,
    email: r.email,
  };
}

export async function saveOdkConfigAction(formData: FormData) {
  const userId = await requireUserId();
  const baseUrl = String(formData.get('baseUrl') ?? DEFAULT_BASE).trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { ok: false as const, error: 'Email and password are required.' };

  let token: string;
  try {
    token = await exchangeToken(baseUrl, email, password);
  } catch (e) {
    if (e instanceof OdkAuthError) return { ok: false as const, error: e.message };
    return { ok: false as const, error: 'Could not reach ODK Central.' };
  }

  // Treat ODK tokens as ~24h. If they actually live longer, we'll fail
  // gracefully on 401 and re-prompt.
  const expiresAt = new Date(Date.now() + 23 * 3600_000);
  const encryptedToken = encrypt(token);
  const existing = await db
    .select()
    .from(schema.odkCredentials)
    .where(eq(schema.odkCredentials.userId, userId));
  if (existing[0]) {
    await db
      .update(schema.odkCredentials)
      .set({ baseUrl, email, encryptedToken, tokenExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(schema.odkCredentials.userId, userId));
  } else {
    await db
      .insert(schema.odkCredentials)
      .values({ userId, baseUrl, email, encryptedToken, tokenExpiresAt: expiresAt });
  }
  return { ok: true as const };
}

export async function clearOdkTokenAction() {
  const userId = await requireUserId();
  await db
    .update(schema.odkCredentials)
    .set({ encryptedToken: null, tokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(schema.odkCredentials.userId, userId));
}

export async function requestEditUrlAction(args: {
  instanceId: string;
  submissionUuid: string;
}): Promise<{ ok: true; url: string } | { ok: false; error: string; needsReauth?: boolean }> {
  const userId = await requireUserId();
  const inst = (await db
    .select()
    .from(schema.testInstances)
    .where(eq(schema.testInstances.id, args.instanceId)))[0];
  if (!inst) return { ok: false, error: 'Instance not found.' };

  const cred = (await db
    .select()
    .from(schema.odkCredentials)
    .where(eq(schema.odkCredentials.userId, userId)))[0];
  if (!cred?.encryptedToken)
    return { ok: false, error: 'ODK credentials are missing.', needsReauth: true };

  const token = decrypt(cred.encryptedToken);
  try {
    const url = await requestEditUrl(
      { baseUrl: cred.baseUrl, email: cred.email, token },
      inst.odkProjectId,
      inst.odkFormId,
      args.submissionUuid,
    );
    return { ok: true, url };
  } catch (e) {
    if (e instanceof OdkAuthError) {
      return { ok: false, error: e.message, needsReauth: true };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Edit request failed.' };
  }
}

export async function pullSubmissionsForInstanceAction(instanceId: string): Promise<
  | { ok: true; submissions: OdkSubmission[]; rejectedCount: number }
  | { ok: false; error: string; needsReauth?: boolean }
> {
  const userId = await requireUserId();
  const inst = (await db
    .select()
    .from(schema.testInstances)
    .where(eq(schema.testInstances.id, instanceId)))[0];
  if (!inst) return { ok: false, error: 'Instance not found.' };

  const cred = (await db
    .select()
    .from(schema.odkCredentials)
    .where(eq(schema.odkCredentials.userId, userId)))[0];
  if (!cred?.encryptedToken)
    return { ok: false, error: 'ODK credentials are missing.', needsReauth: true };

  const token = decrypt(cred.encryptedToken);
  try {
    const { submissions, rejectedCount } = await fetchSubmissions(
      { baseUrl: cred.baseUrl, email: cred.email, token },
      inst.odkProjectId,
      inst.odkFormId,
      inst.pullFromDate,
    );
    return { ok: true, submissions, rejectedCount };
  } catch (e) {
    if (e instanceof OdkAuthError) {
      return { ok: false, error: e.message, needsReauth: true };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Pull failed.' };
  }
}
