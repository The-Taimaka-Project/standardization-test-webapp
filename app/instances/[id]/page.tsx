import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getInstanceAction, listGroupsAction, listEnumeratorsAction } from '@/lib/actions/instances';
import { InstanceClient } from './client';

export default async function InstancePage({
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
  if (!activeGroup) redirect(`/instances/${id}/setup`);
  const enumerators = await listEnumeratorsAction(activeGroup.id);
  return (
    <InstanceClient
      instance={{
        id: inst.id,
        name: inst.name,
        odkProjectId: inst.odkProjectId,
        odkFormId: inst.odkFormId,
        pullFromDate: inst.pullFromDate,
        supervisorEnumeratorId: inst.supervisorEnumeratorId,
      }}
      groups={groups.map((g) => ({ id: g.id, groupNumber: g.groupNumber, label: g.label }))}
      activeGroupId={activeGroup.id}
      enumerators={enumerators.map((e) => ({
        id: e.id,
        enumeratorId: e.enumeratorId,
        displayName: e.displayName,
        measuresMuac: e.measuresMuac,
        measuresWeight: e.measuresWeight,
        measuresHeight: e.measuresHeight,
      }))}
    />
  );
}
