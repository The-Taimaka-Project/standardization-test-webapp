import Link from 'next/link';
import { signOut } from '@/lib/auth';
import { listInstancesAction } from '@/lib/actions/instances';
import { ThemeToggle } from '@/components/ThemeToggle';
import { InstanceRowActions } from './InstanceRowActions';

export default async function Home() {
  const instances = await listInstancesAction();
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-medium">Standardization Tests</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/instances/new" className="btn btn-primary">+ Start new test</Link>
          <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}>
            <button className="btn">Sign out</button>
          </form>
        </div>
      </header>
      {instances.length === 0 ? (
        <div className="panel p-6 text-sm text-[color:var(--muted)]">
          No tests yet. Click <span className="font-medium">+ Start new test</span> to begin.
        </div>
      ) : (
        <div className="panel">
          <table className="std">
            <thead>
              <tr>
                <th>Name</th>
                <th>ODK</th>
                <th>From</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {instances.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.name}</td>
                  <td className="text-[color:var(--muted)]">project {i.odkProjectId} / {i.odkFormId}</td>
                  <td>{i.pullFromDate}</td>
                  <td className="text-[color:var(--muted)]">{i.createdAt.toLocaleDateString()}</td>
                  <td className="text-right">
                    <InstanceRowActions id={i.id} name={i.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
