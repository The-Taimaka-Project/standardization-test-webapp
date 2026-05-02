/**
 * Convert a raw ODK submission into the canonical shape we use everywhere
 * else in the app. Applies any user overrides on top of the raw values.
 *
 * Units after normalization:
 *   - MUAC in cm (matches the ODK form). The ENA library expects mm, so
 *     the runReport pipeline multiplies by 10 there. Everywhere else in
 *     the app — UI, discrepancy thresholds, overrides — uses cm.
 *   - Weight in kg.
 *   - Height in cm. Length and height share one column; we keep the
 *     direction_of_measure tag for display only.
 */

import type { OdkSubmission } from './client';

export interface NormalizedSubmission {
  uuid: string;
  enumeratorId: number;
  round: 1 | 2;
  group: number;
  childId: number;
  age: number | null;
  muacCm: number | null;
  weightKg: number | null;
  heightCm: number | null;
  direction: 'height' | 'length' | null;
  submissionDate: string | null;
  raw: OdkSubmission;
}

export interface OverrideMap {
  /** keyed by submissionUuid → field → overridden value (string form, just like the column it overrides). */
  [uuid: string]: { [field: string]: string };
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
};

export function normalize(s: OdkSubmission, overrides?: OverrideMap): NormalizedSubmission {
  const o = overrides?.[s.__id] ?? {};
  const get = <K extends keyof OdkSubmission>(key: K): unknown =>
    Object.prototype.hasOwnProperty.call(o, key) ? o[key as string] : (s as Record<string, unknown>)[key as string];

  const round = int(get('round'));
  const group = int(get('group'));
  const muacCm = num(get('muac_measurement'));

  // Prefer the form's calculated `weight`, falling back to compute from the
  // pieces if for some reason it's missing.
  let weightKg = num(get('weight'));
  if (weightKg == null) {
    const standRaw = String(get('child_stand') ?? '').toLowerCase();
    if (standRaw === 'true') {
      weightKg = num(get('ptonly_weight'));
    } else if (standRaw === 'false') {
      const cg = num(get('cg_weight'));
      const pt = num(get('pt_weight'));
      if (cg != null && pt != null) weightKg = +(pt - cg).toFixed(2);
    }
  }

  const heightCm = num(get('hl_measurement')) ?? num(get('hl'));
  const dirRaw = String(get('direction_of_measure') ?? '').toLowerCase();
  const direction = dirRaw === 'height' ? 'height' : dirRaw === 'length' ? 'length' : null;

  return {
    uuid: s.__id,
    enumeratorId: int(get('enumerator_id')) ?? -1,
    round: (round === 1 || round === 2 ? round : 1) as 1 | 2,
    group: group ?? 1,
    childId: int(get('child_id')) ?? -1,
    age: int(get('age')),
    muacCm,
    weightKg,
    heightCm,
    direction,
    submissionDate: s.__system?.submissionDate ?? null,
    raw: s,
  };
}
