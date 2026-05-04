'use server';

import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { runReport, type EnumeratorInput, type Report, type Measurement } from '@/lib/ena';
import { normalize } from '@/lib/odk/normalize';
import { fetchActiveOverridesAction } from './overrides';
import { pullSubmissionsForInstanceAction } from './odk';

async function requireUserId(): Promise<string> {
  const s = await auth();
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error('Not authenticated');
  return id;
}

export interface GroupReport {
  groupId: string;
  groupNumber: number;
  label: string | null;
  report: Report;
}

export async function runGroupReportAction(args: {
  instanceId: string;
  groupId: string;
}): Promise<{ ok: true; report: GroupReport } | { ok: false; error: string; needsReauth?: boolean }> {
  await requireUserId();
  const inst = (await db
    .select()
    .from(schema.testInstances)
    .where(eq(schema.testInstances.id, args.instanceId)))[0];
  if (!inst) return { ok: false, error: 'Instance not found.' };
  const grp = (await db
    .select()
    .from(schema.testGroups)
    .where(eq(schema.testGroups.id, args.groupId)))[0];
  if (!grp) return { ok: false, error: 'Group not found.' };

  const enumRows = await db
    .select()
    .from(schema.enumerators)
    .where(eq(schema.enumerators.groupId, args.groupId));

  const pull = await pullSubmissionsForInstanceAction(args.instanceId);
  if (!pull.ok) return pull;
  const overrides = await fetchActiveOverridesAction(args.instanceId);

  // Normalize and filter to this group's submissions only.
  const normalized = pull.submissions.map((s) => normalize(s, overrides));
  const groupSubs = normalized.filter((n) => n.group === grp.groupNumber);

  // Build per-enumerator paired data.
  const inputs: EnumeratorInput[] = enumRows.map((er) => {
    const supId = inst.supervisorEnumeratorId;
    const isSupervisor = er.enumeratorId === supId;
    const measures = {
      muac: er.measuresMuac,
      weight: er.measuresWeight,
      height: er.measuresHeight,
    };
    return {
      enumeratorId: er.enumeratorId,
      displayName: er.displayName ?? null,
      isSupervisor,
      measures,
      pairs: buildPairs(
        groupSubs.filter((s) => s.enumeratorId === er.enumeratorId),
        measures,
      ),
    };
  });

  // Make sure the supervisor (if not explicitly in the roster) still
  // contributes data — assume they were tested on all three measurements.
  if (!inputs.some((e) => e.isSupervisor)) {
    const supSubs = groupSubs.filter((s) => s.enumeratorId === inst.supervisorEnumeratorId);
    if (supSubs.length > 0) {
      const measures = { muac: true, weight: true, height: true };
      inputs.push({
        enumeratorId: inst.supervisorEnumeratorId,
        displayName: 'Supervisor',
        isSupervisor: true,
        measures,
        pairs: buildPairs(supSubs, measures),
      });
    }
  }

  const report = runReport({ enumerators: inputs });
  return {
    ok: true,
    report: {
      groupId: grp.id,
      groupNumber: grp.groupNumber,
      label: grp.label ?? null,
      report,
    },
  };
}

function buildPairs(
  subs: ReturnType<typeof normalize>[],
  measures: Record<Measurement, boolean>,
) {
  // For each child, average the value if multiple submissions exist (shouldn't,
  // but the UI also flags duplicates separately). Take the first available
  // value per (round, child).
  const byKey = new Map<string, ReturnType<typeof normalize>>();
  for (const s of subs) {
    const k = `${s.round}|${s.childId}`;
    if (!byKey.has(k)) byKey.set(k, s);
  }
  const r1 = new Map<number, ReturnType<typeof normalize>>();
  const r2 = new Map<number, ReturnType<typeof normalize>>();
  for (const s of byKey.values()) {
    (s.round === 1 ? r1 : r2).set(s.childId, s);
  }
  const childIds = Array.from(new Set([...r1.keys(), ...r2.keys()])).sort((a, b) => a - b);
  const collect = (m: Measurement): { childIds: number[]; round1: number[]; round2: number[] } | undefined => {
    const round1: number[] = [];
    const round2: number[] = [];
    const pairedChildIds: number[] = [];
    for (const c of childIds) {
      const a = r1.get(c);
      const b = r2.get(c);
      if (!a || !b) continue;
      const va = pickValue(a, m);
      const vb = pickValue(b, m);
      if (va == null || vb == null) continue;
      pairedChildIds.push(c);
      round1.push(va);
      round2.push(vb);
    }
    return round1.length > 0 ? { childIds: pairedChildIds, round1, round2 } : undefined;
  };
  return {
    muac: measures.muac ? collect('muac') : undefined,
    weight: measures.weight ? collect('weight') : undefined,
    height: measures.height ? collect('height') : undefined,
  } as EnumeratorInput['pairs'];
}

function pickValue(s: ReturnType<typeof normalize>, m: Measurement): number | null {
  // The ENA library expects MUAC in mm; everywhere else in the app it's in
  // cm. Convert silently here so the calc thresholds line up with Figure 5.
  if (m === 'muac') return s.muacCm == null ? null : s.muacCm * 10;
  if (m === 'weight') return s.weightKg;
  return s.heightCm;
}

export async function spawnFollowupAction(args: {
  fromInstanceId: string;
  fromGroupId: string;
  failedEnumerators: { enumeratorId: number; failed: Measurement[]; displayName?: string | null }[];
  mode: 'new-test' | 'new-group';
  newName?: string;
}): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  await requireUserId();
  const inst = (await db
    .select()
    .from(schema.testInstances)
    .where(eq(schema.testInstances.id, args.fromInstanceId)))[0];
  if (!inst) return { ok: false, error: 'Source instance not found.' };

  if (args.mode === 'new-group') {
    // Append a new group inside the same instance.
    const existing = await db
      .select()
      .from(schema.testGroups)
      .where(eq(schema.testGroups.instanceId, inst.id));
    const nextNumber = existing.length === 0 ? 1 : Math.max(...existing.map((g) => g.groupNumber)) + 1;
    const [g] = await db
      .insert(schema.testGroups)
      .values({
        instanceId: inst.id,
        groupNumber: nextNumber,
        label: `Group ${nextNumber} (retake)`,
      })
      .returning();
    if (args.failedEnumerators.length > 0) {
      await db.insert(schema.enumerators).values(
        args.failedEnumerators.map((e) => ({
          groupId: g.id,
          enumeratorId: e.enumeratorId,
          displayName: e.displayName ?? null,
          measuresMuac: e.failed.includes('muac'),
          measuresWeight: e.failed.includes('weight'),
          measuresHeight: e.failed.includes('height'),
        })),
      );
    }
    return { ok: true, redirectTo: `/instances/${inst.id}/setup?group=${g.id}` };
  }

  // mode === 'new-test'
  const userId = (await auth())!.user!.id as string;
  const today = new Date().toISOString().slice(0, 10);
  const [newInst] = await db
    .insert(schema.testInstances)
    .values({
      name: args.newName ?? `${inst.name} — retake`,
      odkProjectId: inst.odkProjectId,
      odkFormId: inst.odkFormId,
      pullFromDate: today,
      supervisorEnumeratorId: inst.supervisorEnumeratorId,
      createdBy: userId,
    })
    .returning();
  const [g] = await db
    .insert(schema.testGroups)
    .values({ instanceId: newInst.id, groupNumber: 1, label: 'Group 1' })
    .returning();
  if (args.failedEnumerators.length > 0) {
    await db.insert(schema.enumerators).values(
      args.failedEnumerators.map((e) => ({
        groupId: g.id,
        enumeratorId: e.enumeratorId,
        displayName: e.displayName ?? null,
        measuresMuac: e.failed.includes('muac'),
        measuresWeight: e.failed.includes('weight'),
        measuresHeight: e.failed.includes('height'),
      })),
    );
  }
  return { ok: true, redirectTo: `/instances/${newInst.id}/setup?group=${g.id}` };
}
