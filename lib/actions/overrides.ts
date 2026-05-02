'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import type { OverrideMap } from '@/lib/odk/normalize';

async function requireUserId(): Promise<string> {
  const s = await auth();
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error('Not authenticated');
  return id;
}

export async function setOverrideAction(args: {
  instanceId: string;
  submissionUuid: string;
  fieldName: string;
  originalValue: string | null;
  newValue: string;
}) {
  const userId = await requireUserId();
  // Soft-clear any active override for the same (uuid, field) and insert the new one.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.submissionOverrides)
      .set({ clearedAt: new Date() })
      .where(
        and(
          eq(schema.submissionOverrides.submissionUuid, args.submissionUuid),
          eq(schema.submissionOverrides.fieldName, args.fieldName),
          isNull(schema.submissionOverrides.clearedAt),
        ),
      );
    await tx.insert(schema.submissionOverrides).values({
      instanceId: args.instanceId,
      submissionUuid: args.submissionUuid,
      fieldName: args.fieldName,
      originalValue: args.originalValue,
      newValue: args.newValue,
      setByUserId: userId,
    });
  });
  revalidatePath(`/instances/${args.instanceId}`);
}

export async function clearOverrideAction(args: { instanceId: string; submissionUuid: string; fieldName: string }) {
  await requireUserId();
  await db
    .update(schema.submissionOverrides)
    .set({ clearedAt: new Date() })
    .where(
      and(
        eq(schema.submissionOverrides.submissionUuid, args.submissionUuid),
        eq(schema.submissionOverrides.fieldName, args.fieldName),
        isNull(schema.submissionOverrides.clearedAt),
      ),
    );
  revalidatePath(`/instances/${args.instanceId}`);
}

export async function fetchActiveOverridesAction(instanceId: string): Promise<OverrideMap> {
  await requireUserId();
  const rows = await db
    .select()
    .from(schema.submissionOverrides)
    .where(
      and(
        eq(schema.submissionOverrides.instanceId, instanceId),
        isNull(schema.submissionOverrides.clearedAt),
      ),
    );
  const out: OverrideMap = {};
  for (const r of rows) {
    if (!out[r.submissionUuid]) out[r.submissionUuid] = {};
    out[r.submissionUuid][r.fieldName] = r.newValue;
  }
  return out;
}

export async function markCompleteAction(args: {
  groupId: string;
  enumeratorId: number;
  done: boolean;
  instanceId: string;
}) {
  const userId = await requireUserId();
  if (args.done) {
    // Idempotent insert.
    const existing = await db
      .select()
      .from(schema.groupCompletionMarks)
      .where(
        and(
          eq(schema.groupCompletionMarks.groupId, args.groupId),
          eq(schema.groupCompletionMarks.enumeratorId, args.enumeratorId),
        ),
      );
    if (!existing[0]) {
      await db
        .insert(schema.groupCompletionMarks)
        .values({ groupId: args.groupId, enumeratorId: args.enumeratorId, markedCompleteBy: userId });
    }
  } else {
    await db
      .delete(schema.groupCompletionMarks)
      .where(
        and(
          eq(schema.groupCompletionMarks.groupId, args.groupId),
          eq(schema.groupCompletionMarks.enumeratorId, args.enumeratorId),
        ),
      );
  }
  revalidatePath(`/instances/${args.instanceId}`);
}

export async function listCompletionMarksAction(groupId: string): Promise<Set<number>> {
  await requireUserId();
  const rows = await db
    .select({ enumeratorId: schema.groupCompletionMarks.enumeratorId })
    .from(schema.groupCompletionMarks)
    .where(eq(schema.groupCompletionMarks.groupId, groupId));
  return new Set(rows.map((r) => r.enumeratorId));
}
