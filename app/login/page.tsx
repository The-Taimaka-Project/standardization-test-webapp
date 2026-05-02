'use client';

import { signIn } from 'next-auth/react';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(e.currentTarget);
    const r = await signIn('credentials', {
      email: data.get('email'),
      password: data.get('password'),
      redirect: false,
    });
    setPending(false);
    if (r?.error) {
      setError('Invalid credentials, or your email is not yet verified.');
      return;
    }
    router.push(params.get('next') || '/');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="panel p-6 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-medium">Standardization Webapp</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input className="input w-full" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input w-full" name="password" type="password" required autoComplete="current-password" />
          </div>
          {error && <div className="chip chip-fail">{error}</div>}
          <button className="btn btn-primary w-full justify-center" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="text-sm text-[color:var(--muted)] flex justify-between">
          <Link href="/signup">Create account</Link>
          <Link href="/forgot">Forgot password</Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
