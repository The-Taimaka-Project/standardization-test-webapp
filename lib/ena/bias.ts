/**
 * Bias against supervisor and against the group median.
 *
 * SMART Plus reports bias as a signed mean difference from the selected
 * reference. For supervisor bias, this is equivalent to averaging each
 * child's trainee mean minus supervisor mean:
 *
 *   mean_i(((trainee_r1 + trainee_r2) / 2) - ((supervisor_r1 + supervisor_r2) / 2))
 *
 * The classifier applies absolute-value cut-points later; keeping the signed
 * value here lets the report show whether the enumerator tends to measure
 * low or high.
 */

export interface PerChildPair {
  childId: number;
  round1: number;
  round2: number;
}

export function biasVsSupervisor(
  enumeratorId: number,
  enumeratorPairs: PerChildPair[],
  supervisorId: number,
  supervisorPairs: PerChildPair[],
): number {
  if (enumeratorId === supervisorId) return 0;
  const supByChild = new Map<number, PerChildPair>();
  for (const p of supervisorPairs) supByChild.set(p.childId, p);

  let sum = 0;
  let n = 0;
  for (const p of enumeratorPairs) {
    const ref = supByChild.get(p.childId);
    if (!ref) continue;
    sum += p.round1 - ref.round1 + p.round2 - ref.round2;
    n += 2;
  }
  return n > 0 ? sum / n : NaN;
}

export function biasVsMedian(
  enumeratorPairs: PerChildPair[],
  allPairs: PerChildPair[][],
): number {
  // Per-child reference: median across all round-1 and round-2 values from
  // all enumerators and the supervisor. SMART Plus pools both rounds when it
  // reports the supervisor's median-relative bias.
  const valuesByChild = new Map<number, number[]>();
  for (const pairs of allPairs) {
    for (const p of pairs) {
      const values = valuesByChild.get(p.childId) ?? [];
      values.push(p.round1, p.round2);
      valuesByChild.set(p.childId, values);
    }
  }

  let sum = 0;
  let n = 0;
  for (const p of enumeratorPairs) {
    const med = median(valuesByChild.get(p.childId) ?? []);
    if (!Number.isFinite(med)) continue;
    sum += p.round1 - med + p.round2 - med;
    n += 2;
  }
  return n > 0 ? sum / n : NaN;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
