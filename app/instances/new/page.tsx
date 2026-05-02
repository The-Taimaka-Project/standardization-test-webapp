import Link from 'next/link';
import { createInstanceAction } from '@/lib/actions/instances';

export default function NewInstancePage() {
  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-medium">Start a new test</h1>
      <form action={createInstanceAction} className="panel p-6 space-y-4">
        <div>
          <label className="label">Test name</label>
          <input className="input w-full" name="name" required placeholder="OTP Standardization — 2 May 2026" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">ODK project ID</label>
            <input className="input w-full" name="odkProjectId" type="number" required min={1} />
          </div>
          <div>
            <label className="label">ODK form ID</label>
            <input className="input w-full" name="odkFormId" required defaultValue="standardization_test_otp" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Test date</label>
            <input className="input w-full" name="pullFromDate" type="date" required />
            <p className="text-xs text-[color:var(--muted)] mt-1">Only submissions made on this UTC day will be pulled.</p>
          </div>
          <div>
            <label className="label">Supervisor enumerator ID</label>
            <input className="input w-full" name="supervisorEnumeratorId" type="number" defaultValue={0} min={0} />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit">Create</button>
          <Link href="/" className="btn">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
