/**
 * Top-level "run the test" function. Given paired measurements per
 * (enumerator, measurement), produces per-enumerator results with TEM, bias,
 * classifications, and overall pass/fail.
 *
 * The bias-decision rule (per SMART Manual page 22): if the supervisor's own
 * intra-observer TEM for that measurement is good or acceptable, use bias vs
 * supervisor. Otherwise use bias vs the median of all enumerators' (and
 * supervisor's) means.
 */

import { intraTem, type PairedMeasurements, type IntraTemResult } from './tem';
import { biasVsSupervisor, biasVsMedian } from './bias';
import {
  classifyTemIntra,
  classifyBias,
  classifyR,
  passesMeasurement,
  type Classification,
  type Measurement,
} from './thresholds';

export interface EnumeratorInput {
  enumeratorId: number;
  displayName?: string | null;
  isSupervisor: boolean;
  /**
   * Which measurements this enumerator is configured to do. Drives both:
   *   - data inclusion in the calc (medians, supervisor reference). Data
   *     for measurements where measures[m] is false is ignored even if it
   *     was submitted.
   *   - pass/fail counting (only for non-supervisors).
   */
  measures: Record<Measurement, boolean>;
  /** Pre-paired round-1/round-2 values per measurement. */
  pairs: Partial<Record<Measurement, PairedMeasurements>>;
}

export interface MeasurementResult {
  measurement: Measurement;
  intra: IntraTemResult;
  temClass: Classification;
  rClass: Classification;
  /** signed enumerator mean - reference mean. */
  bias: number;
  biasReference: 'supervisor' | 'median';
  biasClass: Classification;
  passed: boolean;
}

export interface EnumeratorResult {
  enumeratorId: number;
  displayName: string | null;
  isSupervisor: boolean;
  measurements: Partial<Record<Measurement, MeasurementResult>>;
  /** green / orange / red. Counts only measurements the enumerator was configured to do. */
  status: 'pass' | 'partial' | 'fail' | 'na';
  /** Required measurements that were not passed (or had no data). */
  failed: Measurement[];
  /** Required measurements that were passed. */
  passed: Measurement[];
  /** Measurements the enumerator was NOT configured to do — render as "Not Assessed". */
  notAssessed: Measurement[];
}

export interface ReportInput {
  enumerators: EnumeratorInput[];
}

export interface Report {
  enumerators: EnumeratorResult[];
  /** Supervisor's own intra-TEM per measurement; drives the bias-reference choice. */
  supervisorTem: Partial<Record<Measurement, { intra: IntraTemResult; cls: Classification }>>;
}

const ALL_MEASUREMENTS: Measurement[] = ['muac', 'weight', 'height'];

export function runReport(input: ReportInput): Report {
  const supervisor = input.enumerators.find((e) => e.isSupervisor);

  // 1) Compute every enumerator's intra-TEM and overall mean per measurement.
  //    Skip measurements the enumerator isn't configured for — their data
  //    won't feed into the supervisor reference, the median, or the pass/fail.
  const intraByEnum = new Map<number, Partial<Record<Measurement, IntraTemResult>>>();
  for (const e of input.enumerators) {
    const map: Partial<Record<Measurement, IntraTemResult>> = {};
    for (const m of ALL_MEASUREMENTS) {
      if (!e.measures[m]) continue;
      const p = e.pairs[m];
      if (p && p.round1.length > 0) map[m] = intraTem(p);
    }
    intraByEnum.set(e.enumeratorId, map);
  }

  // 2) Supervisor TEM per measurement and its classification — drives bias choice.
  const supervisorTem: Report['supervisorTem'] = {};
  if (supervisor) {
    const m = intraByEnum.get(supervisor.enumeratorId) ?? {};
    for (const meas of ALL_MEASUREMENTS) {
      const r = m[meas];
      if (r && Number.isFinite(r.tem)) {
        supervisorTem[meas] = { intra: r, cls: classifyTemIntra(r.tem, meas) };
      }
    }
  }

  // 3) Per-measurement: list of all enumerator means (incl. supervisor) for median calc.
  const meansPerMeas: Partial<Record<Measurement, { enumeratorId: number; mean: number }[]>> = {};
  for (const meas of ALL_MEASUREMENTS) {
    const list: { enumeratorId: number; mean: number }[] = [];
    for (const e of input.enumerators) {
      const r = intraByEnum.get(e.enumeratorId)?.[meas];
      if (r && Number.isFinite(r.mean)) list.push({ enumeratorId: e.enumeratorId, mean: r.mean });
    }
    meansPerMeas[meas] = list;
  }

  // 4) Build per-enumerator results, skipping supervisor in the pass/fail roster.
  const enumeratorResults: EnumeratorResult[] = [];
  for (const e of input.enumerators) {
    const intra = intraByEnum.get(e.enumeratorId) ?? {};
    const measurements: EnumeratorResult['measurements'] = {};
    const passed: Measurement[] = [];
    const failed: Measurement[] = [];

    for (const meas of ALL_MEASUREMENTS) {
      const r = intra[meas];
      if (!r || !Number.isFinite(r.tem)) continue;

      const temClass = classifyTemIntra(r.tem, meas);
      const rClass = classifyR(r.r, meas);

      const supTem = supervisorTem[meas];
      const useSupervisor =
        !!supTem && (supTem.cls === 'good' || supTem.cls === 'acceptable') && !!supervisor;

      let bias: number;
      let biasReference: 'supervisor' | 'median';
      if (useSupervisor && supervisor) {
        const supMean = intraByEnum.get(supervisor.enumeratorId)?.[meas]?.mean ?? NaN;
        bias = biasVsSupervisor(r.mean, supMean);
        biasReference = 'supervisor';
      } else {
        bias = biasVsMedian(r.mean, meansPerMeas[meas] ?? []);
        biasReference = 'median';
      }
      const biasClass = classifyBias(bias, meas);
      const passedThis = passesMeasurement(temClass, biasClass);

      measurements[meas] = {
        measurement: meas,
        intra: r,
        temClass,
        rClass,
        bias,
        biasReference,
        biasClass,
        passed: passedThis,
      };

      if (e.measures[meas] && !e.isSupervisor) {
        if (passedThis) passed.push(meas);
        else failed.push(meas);
      }
    }

    // Configured measurements with no data at all → counted as failed.
    for (const meas of ALL_MEASUREMENTS) {
      if (
        e.measures[meas] &&
        !e.isSupervisor &&
        !measurements[meas] &&
        !failed.includes(meas) &&
        !passed.includes(meas)
      ) {
        failed.push(meas);
      }
    }

    const notAssessed = ALL_MEASUREMENTS.filter((m) => !e.measures[m]);

    let status: EnumeratorResult['status'];
    if (e.isSupervisor) status = 'na';
    else {
      const requiredCount = ALL_MEASUREMENTS.filter((m) => e.measures[m]).length;
      if (requiredCount === 0) status = 'na';
      else if (passed.length === requiredCount) status = 'pass';
      else if (passed.length === 0) status = 'fail';
      else status = 'partial';
    }

    enumeratorResults.push({
      enumeratorId: e.enumeratorId,
      displayName: e.displayName ?? null,
      isSupervisor: e.isSupervisor,
      measurements,
      status,
      passed,
      failed,
      notAssessed,
    });
  }

  return { enumerators: enumeratorResults, supervisorTem };
}
