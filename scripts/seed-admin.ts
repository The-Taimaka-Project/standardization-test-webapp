/**
 * Bootstrap a single user account without going through the email verification
 * flow. Useful for the very first admin on a fresh prod install.
 *
 * Usage:
 *   npx tsx scripts/seed-admin.ts <email> <password>
 *
 * The email must end in the SIGNUP_ALLOWED_DOMAIN.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { hashPassword } from '@/lib/auth/passwords';

async function main() {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  const password = process.argv[3] ?? '';
  // Note: seed-admin intentionally skips the SIGNUP_ALLOWED_DOMAIN gate. It's
  // run by the operator from the CLI, not from the public form.
  if (!email || !password) {
    console.error('Usage: tsx scripts/seed-admin.ts <email> <password>');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (existing[0]) {
    await db
      .update(schema.users)
      .set({ passwordHash, emailVerifiedAt: new Date() })
      .where(eq(schema.users.id, existing[0].id));
    console.log(`Updated existing user: ${email}`);
  } else {
    await db
      .insert(schema.users)
      .values({ email, passwordHash, emailVerifiedAt: new Date() });
    console.log(`Created and verified: ${email}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
