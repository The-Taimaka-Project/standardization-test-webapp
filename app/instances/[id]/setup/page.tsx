import { redirect } from 'next/navigation';
import { getInstanceAction, listGroupsAction } from '@/lib/actions/instances';
import { SetupEditor } from './editor';
import { ThemeToggle } from '@/components/ThemeToggle';

export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const inst = await getInstanceAction(id);
  if (!inst) redirect('/');
  const groups = await listGroupsAction(id);
  const activeGroup = (sp.group && groups.find((g) => g.id === sp.group)) || groups[0];
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">{inst.name}</h1>
          <p className="text-sm text-[color:var(--muted)]">Setup — configure groups and enumerators</p>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />
        </div>
      </header>
      <SetupEditor
        instanceId={id}
        groups={groups.map((g) => ({ id: g.id, groupNumber: g.groupNumber, label: g.label }))}
        initialActiveGroupId={activeGroup?.id ?? null}
        supervisorEnumeratorId={inst.supervisorEnumeratorId}
      />
    </div>
  );
}
