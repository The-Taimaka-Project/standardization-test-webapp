'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { fetchActiveOverridesAction, setOverrideAction, clearOverrideAction, markCompleteAction, listCompletionMarksAction } from '@/lib/actions/overrides';
import { pullSubmissionsForInstanceAction, getOdkConfigAction, saveOdkConfigAction, requestEditUrlAction } from '@/lib/actions/odk';
import { addGroupAction } from '@/lib/actions/instances';
import { runGroupReportAction, spawnFollowupAction, type GroupReport } from '@/lib/actions/runReport';
import { normalize, type NormalizedSubmission, type OverrideMap } from '@/lib/odk/normalize';
import type { OdkSubmission } from '@/lib/odk/client';
import type { Measurement } from '@/lib/ena';
import { fmt } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';

interface InstanceLite {
  id: string;
  name: string;
  odkProjectId: number;
  odkFormId: string;
  pullFromDate: string;
  supervisorEnumeratorId: number;
}
interface GroupLite { id: string; groupNumber: number; label: string | null }
interface EnumLite {
  id: string; enumeratorId: number; displayName: string | null;
  measuresMuac: boolean; measuresWeight: boolean; measuresHeight: boolean;
}

const FIELDS_FOR_OVERRIDE = ['muac_measurement', 'weight', 'hl_measurement', 'group'] as const;

const DISCREPANCY_THRESHOLD: Record<Measurement, number> = {
  muac: 0.3, // cm
  weight: 0.2, // kg
  height: 1, // cm
};

export function InstanceClient({
  instance,
  groups,
  activeGroupId,
  enumerators,
}: {
  instance: InstanceLite;
  groups: GroupLite[];
  activeGroupId: string;
  enumerators: EnumLite[];
}) {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<OdkSubmission[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [completion, setCompletion] = useState<Set<number>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  // Hoisted so both the inline button and the confirm-and-run modal can call it.
  const runReport = () => {
    startTransition(async () => {
      const r = await runGroupReportAction({ instanceId: instance.id, groupId: activeGroupId });
      if (!r.ok) {
        setPullError(r.error);
        if (r.needsReauth) setNeedsOdkLogin(true);
        return;
      }
      setReport(r.report);
    });
  };
  const [needsOdkLogin, setNeedsOdkLogin] = useState(false);
  const [odkBaseUrl, setOdkBaseUrl] = useState('');
  const [odkEmail, setOdkEmail] = useState('');
  const [hasOdkToken, setHasOdkToken] = useState(false);
  const [report, setReport] = useState<GroupReport | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingRunEnumerators, setPendingRunEnumerators] = useState<
    | { enumeratorId: number; displayName: string | null; unresolved: number }[]
    | null
  >(null);

  const refresh = useCallback(async () => {
    setPulling(true);
    setPullError(null);
    const ov = await fetchActiveOverridesAction(instance.id);
    setOverrides(ov);
    const r = await pullSubmissionsForInstanceAction(instance.id);
    if (!r.ok) {
      setPullError(r.error);
      if (r.needsReauth) setNeedsOdkLogin(true);
    } else {
      setSubmissions(r.submissions);
      setRejectedCount(r.rejectedCount);
    }
    setPulling(false);
  }, [instance.id]);

  useEffect(() => {
    void refresh();
    void listCompletionMarksAction(activeGroupId).then(setCompletion);
    void getOdkConfigAction().then((c) => {
      setOdkBaseUrl(c.baseUrl);
      setOdkEmail(c.email);
      setHasOdkToken(c.hasToken);
      if (!c.hasToken) setNeedsOdkLogin(true);
    });
  }, [refresh, activeGroupId]);

  const activeGroup = groups.find((g) => g.id === activeGroupId)!;
  const normalized = useMemo(
    () => submissions.map((s) => normalize(s, overrides)),
    [submissions, overrides],
  );
  // Set of enumerator IDs that are part of this group's configured roster
  // (plus the supervisor ID, which is implicitly always part of the test).
  // We only consider submissions from these IDs — stray data from a
  // mistyped enumerator_id shouldn't block "Run tests".
  const rosterIds = useMemo(() => {
    const ids = new Set<number>(enumerators.map((e) => e.enumeratorId));
    ids.add(instance.supervisorEnumeratorId);
    return ids;
  }, [enumerators, instance.supervisorEnumeratorId]);

  const groupSubs = useMemo(
    () => normalized.filter((n) => n.group === activeGroup.groupNumber && rosterIds.has(n.enumeratorId)),
    [normalized, activeGroup.groupNumber, rosterIds],
  );

  // Diagnostics about submissions that exist in the ODK pull but don't fit
  // the current setup. We surface these so the user knows there's data they
  // probably want to clean up in ODK (or add to the test config).
  const anomalies = useMemo(() => {
    // (1) Submissions in the active group whose enumerator_id isn't in the
    //     roster.
    const unknownEnumCounts = new Map<number, number>();
    for (const n of normalized) {
      if (n.group !== activeGroup.groupNumber) continue;
      if (rosterIds.has(n.enumeratorId)) continue;
      unknownEnumCounts.set(n.enumeratorId, (unknownEnumCounts.get(n.enumeratorId) ?? 0) + 1);
    }
    // (2) Submissions referencing a group_number that isn't configured for
    //     this test instance.
    const knownGroups = new Set<number>(groups.map((g) => g.groupNumber));
    const unknownGroupCounts = new Map<number, number>();
    for (const n of normalized) {
      if (knownGroups.has(n.group)) continue;
      unknownGroupCounts.set(n.group, (unknownGroupCounts.get(n.group) ?? 0) + 1);
    }
    // (3) Submissions in the active group whose round isn't 1 or 2.
    const oddRoundCounts = new Map<number, number>();
    for (const n of normalized) {
      if (n.group !== activeGroup.groupNumber) continue;
      if (n.round === 1 || n.round === 2) continue;
      oddRoundCounts.set(n.round, (oddRoundCounts.get(n.round) ?? 0) + 1);
    }
    return {
      unknownEnumerators: Array.from(unknownEnumCounts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([enumeratorId, count]) => ({ enumeratorId, count })),
      unknownGroups: Array.from(unknownGroupCounts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([groupNumber, count]) => ({ groupNumber, count })),
      oddRounds: Array.from(oddRoundCounts.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([round, count]) => ({ round, count })),
    };
  }, [normalized, activeGroup.groupNumber, rosterIds, groups]);

  const hasAnomalies =
    anomalies.unknownEnumerators.length > 0 ||
    anomalies.unknownGroups.length > 0 ||
    anomalies.oddRounds.length > 0 ||
    rejectedCount > 0;

  const strayCount = anomalies.unknownEnumerators.reduce((s, x) => s + x.count, 0);

  // Extra submissions beyond the first for each (enumerator, round, child)
  // tuple — i.e., the count the per-row "N dup" chips also use. Dedupe by
  // submission uuid first so the count is robust to the pull ever returning
  // the same instance twice.
  const duplicateCount = useMemo(() => {
    const byUuid = new Map<string, NormalizedSubmission>();
    for (const s of groupSubs) byUuid.set(s.uuid, s);
    const counts = new Map<string, number>();
    for (const s of byUuid.values()) {
      const k = `${s.enumeratorId}|${s.round}|${s.childId}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let n = 0;
    const flagged: { enumeratorId: number; round: number; childId: number; count: number }[] = [];
    for (const [k, v] of counts) {
      if (v > 1) {
        n += v - 1;
        const [eid, r, cid] = k.split('|');
        flagged.push({ enumeratorId: +eid, round: +r, childId: +cid, count: v });
      }
    }
    if (flagged.length > 0 && typeof window !== 'undefined') {
      // Logged in the browser console so we can see exactly which tuples
      // are being flagged when the pill count looks off.
      console.log('[duplicates] extras=%d flagged=%o', n, flagged);
    }
    return n;
  }, [groupSubs]);

  // Per-enumerator stats for the active group: how many unresolved
  // discrepancies they have right now, how many they've resolved via overrides,
  // and how many extra-submission duplicates exist. Computed once here so the
  // row component, the run-confirmation dialog, and any other consumer agree.
  const enumStats = useMemo(() => {
    const out = new Map<number, { unresolved: number; resolved: number; duplicates: number }>();
    for (const enumerator of enumerators) {
      const subs = groupSubs.filter((s) => s.enumeratorId === enumerator.enumeratorId);
      const r1 = subs.filter((s) => s.round === 1);
      const r2 = subs.filter((s) => s.round === 2);
      const current = computeDiscrepancies(r1, r2);
      const rawSubs = subs.map((s) => normalize(s.raw));
      const rawR1 = rawSubs.filter((s) => s.round === 1);
      const rawR2 = rawSubs.filter((s) => s.round === 2);
      const raw = computeDiscrepancies(rawR1, rawR2);
      const curKeys = new Set(current.map((d) => `${d.childId}|${d.measurement}`));
      const rawKeys = new Set(raw.map((d) => `${d.childId}|${d.measurement}`));
      let resolved = 0;
      for (const k of rawKeys) if (!curKeys.has(k)) resolved++;
      const counts = new Map<string, number>();
      for (const s of subs) {
        const k = `${s.round}|${s.childId}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let duplicates = 0;
      for (const v of counts.values()) if (v > 1) duplicates += v - 1;
      out.set(enumerator.enumeratorId, { unresolved: curKeys.size, resolved, duplicates });
    }
    return out;
  }, [enumerators, groupSubs]);

  const supervisorRoster = enumerators.find((e) => e.enumeratorId === instance.supervisorEnumeratorId);
  const roster: EnumLite[] = useMemo(() => {
    const base = [...enumerators];
    if (!supervisorRoster) {
      base.unshift({
        id: 'sup',
        enumeratorId: instance.supervisorEnumeratorId,
        displayName: 'Supervisor',
        measuresMuac: true, measuresWeight: true, measuresHeight: true,
      });
    }
    return base.sort((a, b) => {
      if (a.enumeratorId === instance.supervisorEnumeratorId) return -1;
      if (b.enumeratorId === instance.supervisorEnumeratorId) return 1;
      return a.enumeratorId - b.enumeratorId;
    });
  }, [enumerators, instance.supervisorEnumeratorId, supervisorRoster]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-[color:var(--muted)]">← All tests</Link>
          <h1 className="text-xl font-medium mt-1">{instance.name}</h1>
          <p className="text-sm text-[color:var(--muted)]">
            ODK project {instance.odkProjectId} / {instance.odkFormId} — pull from {instance.pullFromDate}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href={`/instances/${instance.id}/setup`} className="btn">Setup</Link>
          <button className="btn" onClick={() => setNeedsOdkLogin(true)}>{hasOdkToken ? 'Change ODK login' : 'ODK login'}</button>
          <button className="btn btn-primary" onClick={() => void refresh()} disabled={pulling}>
            {pulling ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="flex items-center gap-2">
        {groups.map((g) => (
          <Link
            key={g.id}
            href={`/instances/${instance.id}?group=${g.id}`}
            className={`btn ${g.id === activeGroupId ? 'btn-primary' : ''}`}
          >
            {g.label ?? `Group ${g.groupNumber}`}
          </Link>
        ))}
      </div>

      {pullError && <div className="chip chip-fail">{pullError}</div>}

      {hasAnomalies && (
        <AnomaliesPanel
          anomalies={anomalies}
          rejectedCount={rejectedCount}
          activeGroupNumber={activeGroup.groupNumber}
          instanceId={instance.id}
          onAddGroup={async (groupNumber) => {
            await addGroupAction(instance.id, `Group ${groupNumber}`, groupNumber);
            router.refresh();
          }}
        />
      )}

      <div className="panel">
        <table className="std">
          <thead>
            <tr>
              <th />
              <th>Enumerator</th>
              <th>Round 1</th>
              <th>Round 2</th>
              <th>Discrepancies</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roster.map((e) => (
              <EnumeratorRow
                key={e.id}
                enumerator={e}
                instance={instance}
                groupSubs={groupSubs.filter((s) => s.enumeratorId === e.enumeratorId)}
                overrides={overrides}
                isComplete={completion.has(e.enumeratorId)}
                onChangeComplete={async (done) => {
                  await markCompleteAction({ groupId: activeGroupId, enumeratorId: e.enumeratorId, done, instanceId: instance.id });
                  const next = new Set(completion);
                  if (done) next.add(e.enumeratorId); else next.delete(e.enumeratorId);
                  setCompletion(next);
                }}
                onChangeOverride={async () => {
                  const ov = await fetchActiveOverridesAction(instance.id);
                  setOverrides(ov);
                }}
                isSupervisor={e.enumeratorId === instance.supervisorEnumeratorId}
              />
            ))}
          </tbody>
        </table>
        <div className="p-4 border-t border-[color:var(--border)] flex items-center justify-between gap-3">
          <p className="text-sm text-[color:var(--muted)]">
            {groupSubs.length} submission(s) for {activeGroup.label ?? `Group ${activeGroup.groupNumber}`}
            {strayCount > 0 && (
              <span className="ml-2 chip chip-warn" title="See the heads-up panel above for details.">
                {strayCount} from unknown enumerator{strayCount === 1 ? '' : 's'}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3">
            {duplicateCount > 0 && (
              <span className="chip chip-fail">
                resolve {duplicateCount} duplicate{duplicateCount === 1 ? '' : 's'} before running
              </span>
            )}
            <button
              className="btn btn-primary"
              disabled={pending || pulling || duplicateCount > 0}
              title={
                duplicateCount > 0
                  ? 'Resolve duplicate submissions first.'
                  : pulling
                    ? 'Refreshing…'
                    : undefined
              }
              onClick={() => {
                // Block if any enumerator has unresolved discrepancies but
                // hasn't been marked "corrections done." User can override.
                const offenders: { enumeratorId: number; displayName: string | null; unresolved: number }[] = [];
                for (const e of enumerators) {
                  const stat = enumStats.get(e.enumeratorId);
                  if (!stat) continue;
                  if (stat.unresolved > 0 && !completion.has(e.enumeratorId)) {
                    offenders.push({
                      enumeratorId: e.enumeratorId,
                      displayName: e.displayName,
                      unresolved: stat.unresolved,
                    });
                  }
                }
                if (offenders.length > 0) {
                  setPendingRunEnumerators(offenders);
                  return;
                }
                runReport();
              }}
            >
              {pending ? 'Running…' : 'Run tests'}
            </button>
          </div>
        </div>
      </div>

      {report && (
        <ResultsCard
          report={report}
          instanceId={instance.id}
          activeGroupId={activeGroupId}
          enumerators={enumerators}
          onSpawned={(redirectTo) => router.push(redirectTo)}
        />
      )}

      {pendingRunEnumerators && (
        <ConfirmRunModal
          offenders={pendingRunEnumerators}
          onCancel={() => setPendingRunEnumerators(null)}
          onConfirm={() => {
            setPendingRunEnumerators(null);
            runReport();
          }}
        />
      )}

      {needsOdkLogin && (
        <OdkLoginModal
          baseUrl={odkBaseUrl}
          email={odkEmail}
          onClose={() => setNeedsOdkLogin(false)}
          onSaved={() => {
            setHasOdkToken(true);
            setNeedsOdkLogin(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function AnomaliesPanel({
  anomalies,
  rejectedCount,
  activeGroupNumber,
  instanceId,
  onAddGroup,
}: {
  anomalies: {
    unknownEnumerators: { enumeratorId: number; count: number }[];
    unknownGroups: { groupNumber: number; count: number }[];
    oddRounds: { round: number; count: number }[];
  };
  rejectedCount: number;
  activeGroupNumber: number;
  instanceId: string;
  onAddGroup: (groupNumber: number) => Promise<void>;
}) {
  void instanceId;
  return (
    <div className="panel p-4 space-y-3" style={{ borderColor: 'var(--override)' }}>
      <div className="flex items-center gap-2">
        <span className="chip chip-warn">heads up</span>
        <span className="text-sm text-[color:var(--muted)]">
          The ODK pull contains data that doesn't fit your current setup. Each item below is something
          you'll likely want to fix in ODK (using the edit links below) or in the test setup.
        </span>
      </div>

      {rejectedCount > 0 && (
        <div className="text-sm">
          <span className="font-medium">{rejectedCount}</span>{' '}
          submission{rejectedCount === 1 ? '' : 's'} on this date {rejectedCount === 1 ? 'is' : 'are'} marked
          <span className="font-medium"> rejected</span> in ODK Central and excluded from this view.
          {' '}
          <span className="text-xs text-[color:var(--muted)]">
            Restore the review state in ODK Central if any were rejected by mistake.
          </span>
        </div>
      )}

      {anomalies.unknownEnumerators.length > 0 && (
        <div className="text-sm space-y-1">
          <div className="font-medium">
            Submissions in Group {activeGroupNumber} from enumerator IDs that aren't in the roster:
          </div>
          <ul className="ml-5 list-disc space-y-0.5">
            {anomalies.unknownEnumerators.map((u) => (
              <li key={u.enumeratorId}>
                <span className="font-medium">ID {u.enumeratorId}</span> — {u.count} submission{u.count === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
          <div className="text-xs text-[color:var(--muted)]">
            These are excluded from duplicate counting and the ENA report. Add the ID to your roster in
            Setup, or open the submission in ODK and fix the enumerator ID.
          </div>
        </div>
      )}

      {anomalies.unknownGroups.length > 0 && (
        <div className="text-sm space-y-1">
          <div className="font-medium">Submissions reference groups that aren't configured here:</div>
          <ul className="ml-5 list-disc space-y-1">
            {anomalies.unknownGroups.map((u) => (
              <li key={u.groupNumber} className="flex items-center gap-2">
                <span>
                  <span className="font-medium">Group {u.groupNumber}</span> — {u.count} submission{u.count === 1 ? '' : 's'}
                </span>
                <button className="btn" onClick={() => void onAddGroup(u.groupNumber)}>
                  + Add Group {u.groupNumber} to this test
                </button>
              </li>
            ))}
          </ul>
          <div className="text-xs text-[color:var(--muted)]">
            Either add the missing group above, or correct the group field in ODK.
          </div>
        </div>
      )}

      {anomalies.oddRounds.length > 0 && (
        <div className="text-sm space-y-1">
          <div className="font-medium">
            Submissions in Group {activeGroupNumber} reference rounds other than 1 or 2:
          </div>
          <ul className="ml-5 list-disc space-y-0.5">
            {anomalies.oddRounds.map((u) => (
              <li key={u.round}>
                <span className="font-medium">Round {u.round}</span> — {u.count} submission{u.count === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
          <div className="text-xs text-[color:var(--muted)]">Fix the round field in ODK before running tests.</div>
        </div>
      )}
    </div>
  );
}

function EnumeratorRow({
  enumerator: e, instance, groupSubs, overrides,
  isComplete, onChangeComplete, onChangeOverride, isSupervisor,
}: {
  enumerator: EnumLite;
  instance: InstanceLite;
  groupSubs: NormalizedSubmission[];
  overrides: OverrideMap;
  isComplete: boolean;
  onChangeComplete: (done: boolean) => Promise<void>;
  onChangeOverride: () => Promise<void>;
  isSupervisor: boolean;
}) {
  const [open, setOpen] = useState(false);
  const r1 = groupSubs.filter((s) => s.round === 1);
  const r2 = groupSubs.filter((s) => s.round === 2);
  const childIds = (subs: NormalizedSubmission[]) => new Set(subs.map((s) => s.childId));
  const r1Children = childIds(r1);
  const r2Children = childIds(r2);
  const missingR1 = [1,2,3,4,5,6,7,8,9,10].filter((c) => !r1Children.has(c));
  const missingR2 = [1,2,3,4,5,6,7,8,9,10].filter((c) => !r2Children.has(c));
  const dupes: { round: number; child: number }[] = [];
  for (const round of [1, 2] as const) {
    const subs = round === 1 ? r1 : r2;
    const seen = new Set<number>();
    for (const s of subs) {
      if (seen.has(s.childId)) dupes.push({ round, child: s.childId });
      seen.add(s.childId);
    }
  }
  const discrepancies = computeDiscrepancies(r1, r2);
  // Recompute discrepancies against the *raw* submissions (no overrides
  // applied) so we can show how many were originally flagged and how many
  // the user has since resolved.
  const rawSubs = groupSubs.map((s) => normalize(s.raw));
  const rawR1 = rawSubs.filter((s) => s.round === 1);
  const rawR2 = rawSubs.filter((s) => s.round === 2);
  const rawDiscrepancies = computeDiscrepancies(rawR1, rawR2);
  const currentKeys = new Set(discrepancies.map((d) => `${d.childId}|${d.measurement}`));
  const rawKeys = new Set(rawDiscrepancies.map((d) => `${d.childId}|${d.measurement}`));
  let resolvedCount = 0;
  for (const k of rawKeys) if (!currentKeys.has(k)) resolvedCount++;
  const unresolvedCount = discrepancies.length;
  const hasData = groupSubs.length > 0;

  return (
    <>
      <tr className={open ? 'row-pass' : ''}>
        <td>
          <button className="btn" onClick={() => setOpen(!open)}>{open ? '−' : '+'}</button>
        </td>
        <td>
          <div className="font-medium">
            {e.displayName || (isSupervisor ? 'Supervisor' : `Enumerator ${e.enumeratorId}`)}
          </div>
          <div className="text-xs text-[color:var(--muted)]">
            ID {e.enumeratorId}
            {!isSupervisor && (
              <>
                {' · '}
                {[
                  e.measuresMuac && 'MUAC',
                  e.measuresWeight && 'weight',
                  e.measuresHeight && 'height',
                ].filter(Boolean).join(', ')}
              </>
            )}
          </div>
        </td>
        <td>
          <Completeness count={r1Children.size} dupes={dupes.filter((d) => d.round === 1).length} missing={missingR1} />
        </td>
        <td>
          <Completeness count={r2Children.size} dupes={dupes.filter((d) => d.round === 2).length} missing={missingR2} />
        </td>
        <td>
          {!hasData ? (
            <span className="text-[color:var(--muted)] text-xs">—</span>
          ) : unresolvedCount === 0 && resolvedCount === 0 ? (
            <span className="text-[color:var(--muted)] text-xs">none</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {unresolvedCount > 0 && (
                <span className="chip chip-warn">{unresolvedCount} flagged</span>
              )}
              {resolvedCount > 0 && (
                <span className="chip chip-pass">{resolvedCount} resolved</span>
              )}
            </div>
          )}
        </td>
        <td>
          {!isSupervisor && (
            (() => {
              // The checkbox is only an action item while something is still
              // unresolved. Resolved discrepancies don't need to be marked
              // — they're already corrected.
              const hasIssue = dupes.length > 0 || unresolvedCount > 0;
              if (!hasIssue) {
                return <span className="text-xs text-[color:var(--muted)]">no action required</span>;
              }
              return (
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={isComplete} onChange={(e) => onChangeComplete(e.target.checked)} />
                  corrections done
                </label>
              );
            })()
          )}
        </td>
        <td />
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={6}>
            <SubmissionsDetail
              instance={instance}
              subs={groupSubs}
              overrides={overrides}
              discrepancies={discrepancies}
              onChangeOverride={onChangeOverride}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function Completeness({ count, dupes, missing }: { count: number; dupes: number; missing: number[] }) {
  return (
    <div className="space-y-1">
      <span className={`chip ${count >= 10 ? 'chip-pass' : count > 0 ? 'chip-warn' : ''}`}>{count}/10</span>
      {dupes > 0 && <span className="chip chip-fail ml-1">{dupes} dup</span>}
      {missing.length > 0 && missing.length < 10 && (
        <div className="text-xs text-[color:var(--muted)]">missing children: {missing.join(', ')}</div>
      )}
    </div>
  );
}

function computeDiscrepancies(r1: NormalizedSubmission[], r2: NormalizedSubmission[]) {
  const r1Map = new Map(r1.map((s) => [s.childId, s]));
  const flags: { childId: number; measurement: Measurement; v1: number; v2: number; diff: number }[] = [];
  for (const b of r2) {
    const a = r1Map.get(b.childId);
    if (!a) continue;
    const measures: [Measurement, number | null, number | null][] = [
      ['muac', a.muacCm, b.muacCm],
      ['weight', a.weightKg, b.weightKg],
      ['height', a.heightCm, b.heightCm],
    ];
    for (const [m, va, vb] of measures) {
      if (va == null || vb == null) continue;
      const d = Math.abs(va - vb);
      if (d > DISCREPANCY_THRESHOLD[m]) {
        flags.push({ childId: b.childId, measurement: m, v1: va, v2: vb, diff: d });
      }
    }
  }
  return flags;
}

function SubmissionsDetail({
  instance, subs, overrides, discrepancies, onChangeOverride,
}: {
  instance: InstanceLite;
  subs: NormalizedSubmission[];
  overrides: OverrideMap;
  discrepancies: { childId: number; measurement: Measurement; v1: number; v2: number; diff: number }[];
  onChangeOverride: () => Promise<void>;
}) {
  // Group by child: child 1 R1 then R2, child 2 R1 then R2, …
  const sorted = [...subs].sort(
    (a, b) =>
      (a.childId - b.childId) ||
      (a.round - b.round) ||
      ((a.submissionDate ?? '') < (b.submissionDate ?? '') ? -1 : 1),
  );

  // Mark rows whose (round, childId) appears more than once.
  const counts = new Map<string, number>();
  for (const s of sorted) {
    const k = `${s.round}|${s.childId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const dupKeys = new Set<string>();
  for (const [k, n] of counts) if (n > 1) dupKeys.add(k);

  // For each child, which measurements are discrepant between R1 and R2?
  // Both rows of a discrepant pair tint yellow; the offending cell tints
  // brighter so the user can pick out the exact value to investigate.
  const discrepantCells = new Map<number, Set<Measurement>>();
  for (const d of discrepancies) {
    if (!discrepantCells.has(d.childId)) discrepantCells.set(d.childId, new Set());
    discrepantCells.get(d.childId)!.add(d.measurement);
  }
  return (
    <div className="space-y-3 p-3">
      {discrepancies.length > 0 && (
        <div className="space-y-1">
          {discrepancies.map((d, i) => (
            <div key={i} className="chip chip-warn">
              child {d.childId} {d.measurement}: r1 {fmt(d.v1, 2)} vs r2 {fmt(d.v2, 2)} (Δ {fmt(d.diff, 2)})
            </div>
          ))}
        </div>
      )}
      <table className="std">
        <thead>
          <tr>
            <th>Round</th>
            <th>Child</th>
            <th>MUAC (mm)</th>
            <th>Weight (kg)</th>
            <th>Height (cm)</th>
            <th>Group</th>
            <th>Edit / UUID</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <SubmissionRow
              key={s.uuid}
              s={s}
              instance={instance}
              overrides={overrides}
              onChangeOverride={onChangeOverride}
              isDuplicate={dupKeys.has(`${s.round}|${s.childId}`)}
              discrepantMeasurements={discrepantCells.get(s.childId) ?? null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubmissionRow({
  s, instance, overrides, onChangeOverride, isDuplicate, discrepantMeasurements,
}: {
  s: NormalizedSubmission;
  instance: InstanceLite;
  overrides: OverrideMap;
  onChangeOverride: () => Promise<void>;
  isDuplicate: boolean;
  discrepantMeasurements: Set<Measurement> | null;
}) {
  const ov = overrides[s.uuid] ?? {};
  const hasDiscrepancy = !!discrepantMeasurements && discrepantMeasurements.size > 0;
  // Duplicates are the more pressing data issue, so they win the row tint.
  const rowClass = isDuplicate ? 'row-fail' : hasDiscrepancy ? 'row-partial' : '';
  const cellClass = (m: Measurement) =>
    discrepantMeasurements?.has(m) && !isDuplicate ? 'cell-discrepancy' : '';
  return (
    <tr className={rowClass}>
      <td>{s.round}</td>
      <td>
        {s.childId}
        {isDuplicate && <span className="chip chip-fail ml-2">duplicate</span>}
        {!isDuplicate && hasDiscrepancy && <span className="chip chip-warn ml-2">discrepancy</span>}
      </td>
      <td className={cellClass('muac')}>
        <OverrideField
          instanceId={instance.id} uuid={s.uuid} fieldName="muac_measurement"
          original={s.raw.muac_measurement != null ? String(s.raw.muac_measurement) : null}
          isOverridden={'muac_measurement' in ov}
          displayMm={s.muacCm}
          unitHint="cm"
          onChange={onChangeOverride}
        />
      </td>
      <td className={cellClass('weight')}>
        <OverrideField
          instanceId={instance.id} uuid={s.uuid} fieldName="weight"
          original={s.raw.weight != null ? String(s.raw.weight) : null}
          isOverridden={'weight' in ov}
          displayMm={s.weightKg}
          unitHint="kg"
          onChange={onChangeOverride}
        />
      </td>
      <td className={cellClass('height')}>
        <OverrideField
          instanceId={instance.id} uuid={s.uuid} fieldName="hl_measurement"
          original={s.raw.hl_measurement != null ? String(s.raw.hl_measurement) : null}
          isOverridden={'hl_measurement' in ov}
          displayMm={s.heightCm}
          unitHint={`cm (${s.direction ?? '?'})`}
          onChange={onChangeOverride}
        />
      </td>
      <td>
        <OverrideField
          instanceId={instance.id} uuid={s.uuid} fieldName="group"
          original={s.raw.group != null ? String(s.raw.group) : null}
          isOverridden={'group' in ov}
          displayMm={s.group}
          unitHint="grp"
          onChange={onChangeOverride}
        />
      </td>
      <td className="space-x-2 text-xs">
        <button
          className="btn"
          onClick={async () => {
            const r = await requestEditUrlAction({ instanceId: instance.id, submissionUuid: s.uuid });
            if (!r.ok) {
              alert(r.error);
              return;
            }
            window.open(r.url, '_blank', 'noopener,noreferrer');
          }}
        >edit</button>
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(s.uuid);
          }}
        >copy uuid</button>
      </td>
    </tr>
  );
}

function OverrideField({
  instanceId, uuid, fieldName, original, isOverridden, displayMm, unitHint, onChange,
}: {
  instanceId: string;
  uuid: string;
  fieldName: string;
  original: string | null;
  isOverridden: boolean;
  displayMm: number | null;
  unitHint: string;
  onChange: () => Promise<void>;
}) {
  const [val, setVal] = useState<string>(displayMm == null ? '' : String(displayMm));
  useEffect(() => { setVal(displayMm == null ? '' : String(displayMm)); }, [displayMm]);
  return (
    <div className="flex items-center gap-1">
      <input
        className={`input w-24 ${isOverridden ? 'override' : ''}`}
        title={isOverridden && original != null ? `Original value: ${original}` : undefined}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={async () => {
          if (val === '' || (!isOverridden && val === (displayMm == null ? '' : String(displayMm)))) return;
          await setOverrideAction({
            instanceId,
            submissionUuid: uuid,
            fieldName,
            originalValue: original,
            newValue: val,
          });
          await onChange();
        }}
      />
      <span className="text-xs text-[color:var(--muted)]">{unitHint}</span>
      {isOverridden && (
        <button
          className="btn"
          onClick={async () => {
            await clearOverrideAction({ instanceId, submissionUuid: uuid, fieldName });
            await onChange();
          }}
        >×</button>
      )}
    </div>
  );
}

function ResultsCard({
  report, instanceId, activeGroupId, enumerators, onSpawned,
}: {
  report: GroupReport;
  instanceId: string;
  activeGroupId: string;
  enumerators: EnumLite[];
  onSpawned: (path: string) => void;
}) {
  const failedEnumerators = report.report.enumerators
    .filter((e) => !e.isSupervisor && (e.status === 'fail' || e.status === 'partial'))
    .map((e) => ({
      enumeratorId: e.enumeratorId,
      displayName: e.displayName,
      failed: e.failed,
    }));
  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Results — {report.label ?? `Group ${report.groupNumber}`}</h2>
        <div className="flex gap-2">
          <button
            className="btn"
            disabled={failedEnumerators.length === 0}
            onClick={async () => {
              const r = await spawnFollowupAction({
                fromInstanceId: instanceId,
                fromGroupId: activeGroupId,
                failedEnumerators,
                mode: 'new-group',
              });
              if (r.ok) onSpawned(r.redirectTo);
            }}
          >+ New group with failed</button>
          <button
            className="btn"
            disabled={failedEnumerators.length === 0}
            onClick={async () => {
              const newName = prompt('Name for the new test?');
              const r = await spawnFollowupAction({
                fromInstanceId: instanceId,
                fromGroupId: activeGroupId,
                failedEnumerators,
                mode: 'new-test',
                newName: newName ?? undefined,
              });
              if (r.ok) onSpawned(r.redirectTo);
            }}
          >+ New test with failed</button>
        </div>
      </div>
      <table className="std">
        <thead>
          <tr>
            <th>Enumerator</th>
            <th>MUAC</th>
            <th>Weight</th>
            <th>Height</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {report.report.enumerators.map((e) => (
            <tr
              key={e.enumeratorId}
              className={
                e.status === 'pass' ? 'row-pass' :
                e.status === 'partial' ? 'row-partial' :
                e.status === 'fail' ? 'row-fail' : ''
              }
            >
              <td>
                <div className="font-medium">{e.displayName ?? `Enumerator ${e.enumeratorId}`}</div>
                <div className="text-xs text-[color:var(--muted)]">ID {e.enumeratorId}</div>
              </td>
              {(['muac','weight','height'] as Measurement[]).map((m) => {
                const r = e.measurements[m];
                if (!r) return <td key={m}>—</td>;
                return (
                  <td key={m}>
                    <div className={`chip chip-${r.passed ? 'pass' : 'fail'}`}>
                      {r.passed ? 'pass' : 'fail'}
                    </div>
                    <div className="text-xs text-[color:var(--muted)] mt-1">
                      TEM {fmt(r.intra.tem, 2)} ({r.temClass}), bias {fmt(r.bias, 2)} vs {r.biasReference} ({r.biasClass})
                    </div>
                  </td>
                );
              })}
              <td>
                <span className={`chip chip-${e.status === 'pass' ? 'pass' : e.status === 'partial' ? 'warn' : e.status === 'fail' ? 'fail' : ''}`}>
                  {e.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmRunModal({
  offenders,
  onCancel,
  onConfirm,
}: {
  offenders: { enumeratorId: number; displayName: string | null; unresolved: number }[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10">
      <div className="panel p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-medium">Run with unresolved discrepancies?</h2>
        <p className="text-sm text-[color:var(--muted)]">
          The following enumerators have unresolved discrepancies but have not been marked
          <span className="font-medium"> corrections done</span>. Running now will use whatever
          values are currently in ODK (or your overrides).
        </p>
        <ul className="text-sm space-y-1 max-h-64 overflow-y-auto">
          {offenders.map((o) => (
            <li key={o.enumeratorId} className="flex items-center justify-between">
              <span>
                {o.displayName ?? `Enumerator ${o.enumeratorId}`}
                <span className="text-[color:var(--muted)] ml-2">ID {o.enumeratorId}</span>
              </span>
              <span className="chip chip-warn">{o.unresolved} unresolved</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>Run anyway</button>
        </div>
      </div>
    </div>
  );
}

function OdkLoginModal({
  baseUrl, email, onClose, onSaved,
}: {
  baseUrl: string;
  email: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-10">
      <div className="panel p-6 w-full max-w-md">
        <h2 className="text-lg font-medium mb-4">ODK Central login</h2>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setPending(true);
            const r = await saveOdkConfigAction(new FormData(e.currentTarget));
            setPending(false);
            if (!r.ok) setError(r.error);
            else onSaved();
          }}
        >
          <div>
            <label className="label">Base URL</label>
            <input className="input w-full" name="baseUrl" defaultValue={baseUrl} required />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input w-full" name="email" type="email" defaultValue={email} required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input w-full" name="password" type="password" required />
            <p className="text-xs text-[color:var(--muted)] mt-1">Password is exchanged for a session token and not stored.</p>
          </div>
          {error && <div className="chip chip-fail">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
