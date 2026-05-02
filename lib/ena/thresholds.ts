/**
 * Cut-points for the anthropometric standardization test, taken verbatim from
 * SMART Manual 2.0, Figure 5 ("Suggested cut-points for acceptability of
 * measurements"). Page 23 of the manual.
 *
 * Units: MUAC mm, weight kg, height cm. The pull layer is responsible for
 * converting MUAC from cm (as captured in ODK) to mm before feeding values
 * into this module.
 *
 * Note: the reference ENA output `reference/standardization_test_group3_results.xlsx`
 * uses different cut-points for MUAC TEM (~2× these) and a stricter R cutoff.
 * That spreadsheet's classifications will NOT round-trip through this code.
 * See AGENTS.md for the full discussion.
 *
 * Boundary rule: "<" in the manual is exclusive. e.g. MUAC TEM exactly 1.0 mm
 * is "acceptable" (not "good"), and exactly 2.1 mm is "reject" (not "poor").
 */

export type Measurement = 'muac' | 'weight' | 'height';
export type Classification = 'good' | 'acceptable' | 'poor' | 'reject';

interface AscendingTier { good: number; acceptable: number; poor: number }
interface DescendingTier { good: number; acceptable: number; poor: number }

// Individual intra-observer TEM cut-points (Figure 5).
const TEM_INTRA: Record<Measurement, AscendingTier> = {
  muac: { good: 1.0, acceptable: 1.3, poor: 2.1 },
  weight: { good: 0.04, acceptable: 0.10, poor: 0.21 },
  height: { good: 0.4, acceptable: 0.6, poor: 1.2 },
};

// Bias against supervisor (or median fallback) (Figure 5).
const BIAS: Record<Measurement, AscendingTier> = {
  muac: { good: 1.0, acceptable: 2.0, poor: 3.0 },
  weight: { good: 0.04, acceptable: 0.10, poor: 0.21 },
  height: { good: 0.4, acceptable: 0.6, poor: 1.4 },
};

// Coefficient of reliability R, percentage 0-100 (Figure 5). Higher is better.
// MUAC has a different "good" cutoff than weight/height per the manual.
const R: Record<Measurement, DescendingTier> = {
  muac: { good: 95, acceptable: 95, poor: 90 },
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
