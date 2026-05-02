import Link from 'next/link';
import { consumeVerificationTokenAction } from '@/lib/auth/signup';

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) return <Wrap title="Missing token" body="The verification link is missing a token." />;
  const r = await consumeVerificationTokenAction(token);
  if (!r.ok) return <Wrap title="Could not verify" body={r.error ?? 'Unknown error.'} />;
  return (
    <Wrap title="Email verified" body="Your account is ready.">
      <Link href="/login" className="btn btn-primary mt-3">Sign in</Link>
    </Wrap>
  );
}

function Wrap({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="panel p-6 w-full max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-medium">{title}</h1>
        <p className="text-sm text-[color:var(--muted)]">{body}</p>
        {children}
      </div>
    </div>
  );
}
