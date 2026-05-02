/**
 * Drive the signup → verify flow end-to-end against the live DB and Resend.
 * Pass the email as the first arg. The verification link will be printed to
 * stdout (since process.env.NODE_ENV !== 'production' here).
 */
import 'dotenv/config';
import { signupAction, consumeVerificationTokenAction } from '@/lib/auth/signup';

async function main() {
  const email = process.argv[2];
  const password = process.argv[3] ?? 'password123';
  if (!email) {
    console.error('Usage: tsx scripts/smoke-signup.ts <email> [password]');
    process.exit(1);
  }
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  fd.set('name', 'Smoke Test');
  const r = await signupAction(fd);
  console.log('signup result:', r);
  if (!r.ok) process.exit(1);
  if (r.devLink) {
    console.log('verifying via:', r.devLink);
    const token = new URL(r.devLink).searchParams.get('token')!;
    const v = await consumeVerificationTokenAction(token);
    console.log('verify result:', v);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
