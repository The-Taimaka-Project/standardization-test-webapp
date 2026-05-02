/**
 * Dev convenience: read dev_odk.creds, exchange for a token, and prime the
 * dev user's odk_credentials row so the UI is ready to go without typing
 * the ODK password into a modal on every restart.
 *
 * Usage:
 *   npx tsx scripts/load-dev-odk-creds.ts <user-email>
 *
 * The user must already exist in the users table.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { exchangeToken } from '@/lib/odk/client';
import { encrypt } from '@/lib/odk/crypto';

function loadDevCreds() {
  const file = path.resolve('dev_odk.creds');
  if (!fs.existsSync(file)) throw new Error(`${file} not found`);
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

async function main() {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  if (!email) {
    console.error('Usage: tsx scripts/load-dev-odk-creds.ts <user-email>');
    process.exit(1);
  }
  const c = loadDevCreds();
  const baseUrl = c.BASE_URL ?? process.env.ODK_DEFAULT_BASE_URL ?? 'https://taimaka-internal.org:7443';

  const u = (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
  if (!u) throw new Error(`No user with email ${email}. Run scripts/seed-admin.ts first.`);

  const token = await exchangeToken(baseUrl, c.USER, c.PASSWORD);
  const expiresAt = new Date(Date.now() + 23 * 3600_000);
  const encryptedToken = encrypt(token);
  const existing = await db
    .select()
    .from(schema.odkCredentials)
    .where(eq(schema.odkCredentials.userId, u.id));
  if (existing[0]) {
    await db
      .update(schema.odkCredentials)
      .set({ baseUrl, email: c.USER, encryptedToken, tokenExpiresAt: expiresAt, updatedAt: new Date() })
      .where(eq(schema.odkCredentials.userId, u.id));
  } else {
    await db
      .insert(schema.odkCredentials)
      .values({ userId: u.id, baseUrl, email: c.USER, encryptedToken, tokenExpiresAt: expiresAt });
  }
  console.log(`Primed ODK token for ${email} (expires ${expiresAt.toISOString()}).`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
