'use client';

import { useState } from 'react';
import Link from 'next/link';
import { requestPasswordResetAction } from '@/lib/auth/signup';

export default function ForgotPage() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const r = await requestPasswordResetAction(new FormData(e.currentTarget));
    setPending(false);
    setMsg('If an account exists, you will receive a reset link by email.');
    if (r.devLink) console.log('[dev] reset link:', r.devLink);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="panel p-6 w-full max-w-sm space-y-3">
        <h1 className="text-xl font-medium">Reset password</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input className="input w-full" name="email" type="email" required />
          </div>
          {msg && <div className="chip chip-pass">{msg}</div>}
          <button className="btn btn-primary w-full justify-center" disabled={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <div className="text-sm text-[color:var(--muted)]">
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
