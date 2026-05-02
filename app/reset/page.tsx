'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { consumePasswordResetTokenAction } from '@/lib/auth/signup';

function Inner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!token) return setErr('Reset link is missing a token.');
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    setPending(true);
    const r = await consumePasswordResetTokenAction(token, password);
    setPending(false);
    if (r.ok) setMsg('Password updated. You can sign in now.');
    else setErr(r.error ?? 'Could not reset password.');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="panel p-6 w-full max-w-sm space-y-3">
        <h1 className="text-xl font-medium">Set a new password</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label">New password (≥ 8 chars)</label>
            <input className="input w-full" name="password" type="password" required minLength={8} />
          </div>
          {err && <div className="chip chip-fail">{err}</div>}
          {msg && (
            <div className="chip chip-pass flex items-center justify-between gap-2">
              {msg} <Link href="/login" className="underline">Sign in →</Link>
            </div>
          )}
          <button className="btn btn-primary w-full justify-center" disabled={pending}>
            {pending ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
