/**
 * Bias against supervisor and against the group median.
 *
 *   bias_vs_supervisor = mean(enumerator's 20) - mean(supervisor's 20)
 *   bias_vs_median     = mean(enumerator's 20) - median(per-enumerator means
 *                                                       across all enumerators
 *                                                       AND the supervisor)
 *
 * For thresholding the absolute value is what classifies (per Figure 5
 * ranges), but we keep the signed value here so the UI can show direction.
 */

export interface PerEnumeratorMean {
  enumeratorId: number;
  /** mean of all 2N measurements taken by this enumerator (round 1 + round 2). */
  mean: number;
}

export function biasVsSupervisor(enumeratorMean: number, supervisorMean: number): number {
  return enumeratorMean - supervisorMean;
}

export function biasVsMedian(enumeratorMean: number, allMeans: PerEnumeratorMean[]): number {
  const med = median(allMeans.map((m) => m.mean));
  return enumeratorMean - med;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
