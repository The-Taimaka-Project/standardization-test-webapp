'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signupAction } from '@/lib/auth/signup';

export default function SignupPage() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setPending(true);
    const r = await signupAction(new FormData(e.currentTarget));
    setPending(false);
    if (r.ok) {
      setMsg('Check your inbox for a verification link to finish creating your account.');
      if (r.devLink) console.log('[dev] verification link:', r.devLink);
    } else setErr(r.error ?? 'Something went wrong.');
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="panel p-6 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-medium">Create account</h1>
        <p className="text-sm text-[color:var(--muted)]">
          Restricted to <code>@taimaka.org</code> addresses.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input className="input w-full" name="email" type="email" required />
          </div>
          <div>
            <label className="label">Display name (optional)</label>
            <input className="input w-full" name="name" />
          </div>
          <div>
            <label className="label">Password (≥ 8 chars)</label>
            <input className="input w-full" name="password" type="password" required minLength={8} />
          </div>
          {err && <div className="chip chip-fail">{err}</div>}
          {msg && <div className="chip chip-pass">{msg}</div>}
          <button className="btn btn-primary w-full justify-center" disabled={pending}>
            {pending ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <div className="text-sm text-[color:var(--muted)]">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
