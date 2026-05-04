/**
 * Technical Error of Measurement (intra-observer) and the Coefficient of
 * Reliability R, per SMART Manual 2.0.
 *
 *   TEM = sqrt( Σ d² / 2N )
 *   %TEM = TEM / mean × 100
 *   R    = ( 1 - TEM² / s² ) × 100
 *
 * where d = round1 − round2 for each of N children, and s² is the sample
 * variance of all 2N raw measurements (between-subject variance, denominator
 * 2N − 1).
 */

export interface PairedMeasurements {
  /** length === N. round1[i] and round2[i] are the same child. */
  round1: number[];
  round2: number[];
  /** Optional child/station id for each pair. Falls back to the pair index. */
  childIds?: number[];
}

export interface IntraTemResult {
  n: number;
  mean: number;
  sd: number;
  /** largest absolute |d| in the set. Useful for the discrepancy column. */
  max: number;
  tem: number;
  temPct: number;
  r: number;
}

export function intraTem(p: PairedMeasurements): IntraTemResult {
  if (p.round1.length !== p.round2.length) {
    throw new Error(`paired arrays differ in length: ${p.round1.length} vs ${p.round2.length}`);
  }
  if (p.childIds && p.childIds.length !== p.round1.length) {
    throw new Error(`child ids differ in length: ${p.childIds.length} vs ${p.round1.length}`);
  }
  const n = p.round1.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN, max: NaN, tem: NaN, temPct: NaN, r: NaN };

  let sumD2 = 0;
  let max = 0;
  const all: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = p.round1[i];
    const b = p.round2[i];
    const d = a - b;
    sumD2 += d * d;
    const ad = Math.abs(d);
    if (ad > max) max = ad;
    all.push(a, b);
  }

  const tem = Math.sqrt(sumD2 / (2 * n));
  const mean = all.reduce((s, x) => s + x, 0) / all.length;
  // sample variance, denominator 2n - 1
  let ssq = 0;
  for (const x of all) ssq += (x - mean) ** 2;
  const variance = ssq / (all.length - 1);
  const sd = Math.sqrt(variance);
  const temPct = mean !== 0 ? (tem / mean) * 100 : NaN;
  const r = variance > 0 ? (1 - (tem * tem) / variance) * 100 : NaN;

  return { n, mean, sd, max, tem, temPct, r };
}
