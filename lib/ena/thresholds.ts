/**
 * Cut-points for the anthropometric standardization test. These track the
 * SMART Plus suggested cut-off table in `reference/smartplus-report.xlsx`.
 *
 * Units: MUAC mm, weight kg, height cm. The pull layer is responsible for
 * converting MUAC from cm (as captured in ODK) to mm before feeding values
 * into this module.
 *
 * Boundary rule: SMART Plus prints the upper bounds as `<`, with reject as
 * `>=`. e.g. MUAC TEM exactly 2.0 mm is "acceptable" (not "good"), and
 * exactly 3.3 mm is "reject" (not "poor").
 */

export type Measurement = 'muac' | 'weight' | 'height';
export type Classification = 'good' | 'acceptable' | 'poor' | 'reject';

interface AscendingTier { good: number; acceptable: number; poor: number }
interface DescendingTier { good: number; acceptable: number; poor: number }

// Individual intra-observer TEM cut-points.
const TEM_INTRA: Record<Measurement, AscendingTier> = {
  muac: { good: 2.0, acceptable: 2.7, poor: 3.3 },
  weight: { good: 0.04, acceptable: 0.10, poor: 0.21 },
  height: { good: 0.4, acceptable: 0.6, poor: 1.0 },
};

// Bias against supervisor (or median fallback).
const BIAS: Record<Measurement, AscendingTier> = {
  muac: { good: 1.0, acceptable: 2.0, poor: 3.0 },
  weight: { good: 0.04, acceptable: 0.10, poor: 0.21 },
  height: { good: 0.4, acceptable: 0.8, poor: 1.4 },
};

// Coefficient of reliability R, percentage 0-100. Higher is better.
const R: Record<Measurement, DescendingTier> = {
  muac: { good: 99, acceptable: 95, poor: 90 },
  weight: { good: 99, acceptable: 95, poor: 90 },
  height: { good: 99, acceptable: 95, poor: 90 },
};

export function classifyTemIntra(value: number, m: Measurement): Classification {
  return classifyAscending(value, TEM_INTRA[m]);
}

export function classifyBias(absValue: number, m: Measurement): Classification {
  return classifyAscending(Math.abs(absValue), BIAS[m]);
}

export function classifyR(value: number, m: Measurement): Classification {
  return classifyDescending(value, R[m]);
}

function classifyAscending(value: number, t: AscendingTier): Classification {
  if (value < t.good) return 'good';
  if (value < t.acceptable) return 'acceptable';
  if (value < t.poor) return 'poor';
  return 'reject';
}

function classifyDescending(value: number, t: DescendingTier): Classification {
  if (value > t.good) return 'good';
  if (value > t.acceptable) return 'acceptable';
  if (value > t.poor) return 'poor';
  return 'reject';
}

/**
 * Per the user spec: a trainee passes a measurement iff TEM is not poor and
 * not reject AND the chosen bias is not poor and not reject.
 */
export function passesMeasurement(tem: Classification, bias: Classification): boolean {
  const ok = (c: Classification) => c === 'good' || c === 'acceptable';
  return ok(tem) && ok(bias);
}
