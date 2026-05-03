'use server';

import { z } from 'zod';
import { eq, and, asc, desc, isNull, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { normalize } from '@/lib/odk/normalize';
import { pullSubmissionsForInstanceAction } from './odk';

async function requireUserId(): Promise<string> {
  const s = await auth();
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error('Not authenticated');
  return id;
}

const newInstanceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  odkProjectId: z.coerce.number().int().positive(),
  odkFormId: z.string().trim().min(1),
  pullFromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supervisorEnumeratorId: z.coerce.number().int().nonnegative().default(0),
});

export async function createInstanceAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = newInstanceSchema.safeParse({
    name: formData.get('name'),
    odkProjectId: formData.get('odkProjectId'),
    odkFormId: formData.get('odkFormId'),
    pullFromDate: formData.get('pullFromDate'),
    supervisorEnumeratorId: formData.get('supervisorEnumeratorId') ?? 0,
  });
  if (!parsed.success) {
    throw new Error('Check the form fields and try again.');
  }
  const v = parsed.data;
  const [inst] = await db
    .insert(schema.testInstances)
    .values({
      name: v.name,
      odkProjectId: v.odkProjectId,
      odkFormId: v.odkFormId,
      pullFromDate: v.pullFromDate,
      supervisorEnumeratorId: v.supervisorEnumeratorId,
      createdBy: userId,
    })
    .returning();
  // Default to one group.
  await db
    .insert(schema.testGroups)
    .values({ instanceId: inst.id, groupNumber: 1, label: 'Group 1' });
  revalidatePath('/');
  redirect(`/instances/${inst.id}/setup`);
}

export async function listInstancesAction() {
  await requireUserId();
  return db
    .select()
    .from(schema.testInstances)
    .where(isNull(schema.testInstances.archivedAt))
    .orderBy(desc(schema.testInstances.createdAt));
}

export async function deleteInstanceAction(id: string): Promise<void> {
  await requireUserId();
  // Hard delete. The schema cascades from test_instances → test_groups →
  // (enumerators, group_completion_marks), and from test_instances →
  // submission_overrides directly, so this single statement clears all rows
  // owned by the instance. ODK Central is not touched.
  await db.delete(schema.testInstances).where(eq(schema.testInstances.id, id));
  revalidatePath('/');
}

export async function getInstanceAction(id: string) {
  await requireUserId();
  const rows = await db.select().from(schema.testInstances).where(eq(schema.testInstances.id, id));
  return rows[0] ?? null;
}

export async function listGroupsAction(instanceId: string) {
  await requireUserId();
  return db
    .select()
    .from(schema.testGroups)
    .where(eq(schema.testGroups.instanceId, instanceId))
    .orderBy(asc(schema.testGroups.groupNumber));
}

export async function addGroupAction(instanceId: string, label?: string, groupNumber?: number) {
  await requireUserId();
  const existing = await db
    .select()
    .from(schema.testGroups)
    .where(eq(schema.testGroups.instanceId, instanceId));
  const taken = new Set(existing.map((g) => g.groupNumber));
  let n: number;
  if (groupNumber != null) {
    if (taken.has(groupNumber)) {
      throw new Error(`Group ${groupNumber} already exists for this test.`);
    }
    n = groupNumber;
  } else {
    n = existing.length === 0 ? 1 : Math.max(...existing.map((g) => g.groupNumber)) + 1;
  }
  const [g] = await db
    .insert(schema.testGroups)
    .values({
      instanceId,
      groupNumber: n,
      label: label ?? `Group ${n}`,
    })
    .returning();
  revalidatePath(`/instances/${instanceId}`);
  revalidatePath(`/instances/${instanceId}/setup`);
  return g;
}

export async function deleteGroupAction(groupId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUserId();
  const group = (await db
    .select()
    .from(schema.testGroups)
    .where(eq(schema.testGroups.id, groupId)))[0];
  if (!group) return { ok: false, error: 'Group not found.' };

  const groups = await db
    .select()
    .from(schema.testGroups)
    .where(eq(schema.testGroups.instanceId, group.instanceId));
  if (groups.length <= 1) {
    return { ok: false, error: 'A test must have at least one group.' };
  }

  const pull = await pullSubmissionsForInstanceAction(group.instanceId);
  if (!pull.ok) {
    return {
      ok: false,
      error: `Could not delete group because corrections could not be matched to submissions: ${pull.error}`,
    };
  }
  const groupSubmissionUuids = Array.from(new Set(
    pull.submissions
      .map((s) => normalize(s))
      .filter((s) => s.group === group.groupNumber)
      .map((s) => s.uuid),
  ));

  await db.transaction(async (tx) => {
    if (groupSubmissionUuids.length > 0) {
      await tx
        .delete(schema.submissionOverrides)
        .where(
          and(
            eq(schema.submissionOverrides.instanceId, group.instanceId),
            inArray(schema.submissionOverrides.submissionUuid, groupSubmissionUuids),
          ),
        );
    }
    await tx.delete(schema.testGroups).where(eq(schema.testGroups.id, groupId));
  });
  revalidatePath(`/instances/${group.instanceId}`);
  revalidatePath(`/instances/${group.instanceId}/setup`);
  return { ok: true };
}

export async function listEnumeratorsAction(groupId: string) {
  await requireUserId();
  return db
    .select()
    .from(schema.enumerators)
    .where(eq(schema.enumerators.groupId, groupId))
    .orderBy(asc(schema.enumerators.enumeratorId));
}

const enumPayload = z.object({
  groupId: z.string().uuid(),
  enumeratorId: z.coerce.number().int().nonnegative(),
  displayName: z.string().trim().nullable().optional(),
  measuresMuac: z.coerce.boolean().default(true),
  measuresWeight: z.coerce.boolean().default(true),
  measuresHeight: z.coerce.boolean().default(true),
});

export async function upsertEnumeratorAction(payload: z.infer<typeof enumPayload>) {
  await requireUserId();
  const v = enumPayload.parse(payload);
  // Try update first; insert if not present.
  const existing = await db
    .select()
    .from(schema.enumerators)
    .where(
      and(
        eq(schema.enumerators.groupId, v.groupId),
        eq(schema.enumerators.enumeratorId, v.enumeratorId),
      ),
    );
  if (existing[0]) {
    await db
      .update(schema.enumerators)
      .set({
        displayName: v.displayName ?? null,
        measuresMuac: v.measuresMuac,
        measuresWeight: v.measuresWeight,
        measuresHeight: v.measuresHeight,
      })
      .where(eq(schema.enumerators.id, existing[0].id));
  } else {
    await db.insert(schema.enumerators).values({
      groupId: v.groupId,
      enumeratorId: v.enumeratorId,
      displayName: v.displayName ?? null,
      measuresMuac: v.measuresMuac,
      measuresWeight: v.measuresWeight,
      measuresHeight: v.measuresHeight,
    });
  }
  revalidatePath(`/instances`);
}

export async function deleteEnumeratorAction(id: string) {
  await requireUserId();
  await db.delete(schema.enumerators).where(eq(schema.enumerators.id, id));
}

export async function bulkSetEnumeratorsAction(
  groupId: string,
  list: { enumeratorId: number; displayName?: string | null; measuresMuac?: boolean; measuresWeight?: boolean; measuresHeight?: boolean }[],
) {
  await requireUserId();
  await db.transaction(async (tx) => {
    await tx.delete(schema.enumerators).where(eq(schema.enumerators.groupId, groupId));
    if (list.length > 0) {
      await tx.insert(schema.enumerators).values(
        list.map((e) => ({
          groupId,
          enumeratorId: e.enumeratorId,
          displayName: e.displayName ?? null,
          measuresMuac: e.measuresMuac ?? true,
          measuresWeight: e.measuresWeight ?? true,
          measuresHeight: e.measuresHeight ?? true,
        })),
      );
    }
  });
  revalidatePath(`/instances`);
}
