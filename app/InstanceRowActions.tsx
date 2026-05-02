'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteInstanceAction } from '@/lib/actions/instances';

export function InstanceRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="inline-flex items-center gap-2">
      <Link href={`/instances/${id}`} className="btn">Open</Link>
      <button
        className="btn"
        onClick={() => setConfirming(true)}
        disabled={pending}
        title="Delete this test"
      >
        Delete
      </button>
      {confirming && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10">
          <div className="panel p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-medium">Delete this test?</h2>
            <p className="text-sm text-[color:var(--muted)]">
              <span className="font-medium text-[color:var(--text)]">{name}</span> will be permanently
              deleted from the database, along with its groups, enumerator roster, override history,
              and completion marks. <span className="font-medium text-[color:var(--text)]">This cannot
              be undone.</span> ODK Central is not touched — submissions remain there.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteInstanceAction(id);
                    setConfirming(false);
                    router.refresh();
                  })
                }
              >
                {pending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
