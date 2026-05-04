import { describe, it, expect } from 'vitest';
import { runReport } from '@/lib/ena/runReport';
import type { EnumeratorInput } from '@/lib/ena/runReport';

function pair(round1: number[], round2: number[], childIds?: number[]) {
  return { round1, round2, childIds };
}

describe('runReport', () => {
  it('runs an end-to-end synthetic test: 1 supervisor, 2 trainees, MUAC only', () => {
    // Children's true MUAC roughly 145..175 mm.
    const truth = [145, 150, 155, 160, 165, 170, 175, 158, 162, 168];
    // Supervisor: very precise (TEM ~0.2 mm), no systematic offset.
    const sup: EnumeratorInput = {
      enumeratorId: 0,
      isSupervisor: true,
      measures: { muac: true, weight: true, height: true },
      pairs: { muac: pair(truth, truth.map((x) => x + 0.2)) },
    };
    // Trainee 1: precise but biased +1.5 mm consistently.
    const t1: EnumeratorInput = {
      enumeratorId: 1,
      isSupervisor: false,
      measures: { muac: true, weight: false, height: false },
      pairs: {
        muac: pair(truth.map((x) => x + 1.5), truth.map((x) => x + 1.7)),
      },
    };
    // Trainee 2: imprecise (TEM ~ 2 mm) and a bit biased.
    const t2: EnumeratorInput = {
      enumeratorId: 2,
      isSupervisor: false,
      measures: { muac: true, weight: false, height: false },
      pairs: {
        muac: pair(truth.map((x) => x + 2), truth.map((x) => x - 2)),
      },
    };

    const r = runReport({ enumerators: [sup, t1, t2] });

    // Supervisor TEM should be classified — that drives bias-reference.
    expect(r.supervisorTem.muac).toBeDefined();
    expect(['good', 'acceptable']).toContain(r.supervisorTem.muac!.cls);
    expect(r.enumerators.find((e) => e.enumeratorId === 0)!.measurements.muac!.biasReference).toBe('median');

    // Each trainee should have used bias-vs-supervisor (since sup TEM is acceptable/good).
    const tr1 = r.enumerators.find((e) => e.enumeratorId === 1)!;
    expect(tr1.measurements.muac!.biasReference).toBe('supervisor');

    // Trainee 1: bias around +1.5 mm → "acceptable" tier (1≤|b|<2).
    expect(tr1.measurements.muac!.biasClass).toBe('acceptable');
    expect(tr1.measurements.muac!.bias).toBeCloseTo(1.5, 6);
    // Trainee 2: d = +2 - (-2) = 4 each, Σd² = 160, TEM = sqrt(160/20) = 2.83
    // → reject under SMART (≥2.1).
    const tr2 = r.enumerators.find((e) => e.enumeratorId === 2)!;
    expect(['poor', 'reject']).toContain(tr2.measurements.muac!.temClass);
    expect(tr2.status).toBe('fail');
    // Trainee 1 passes MUAC.
    expect(tr1.measurements.muac!.passed).toBe(true);
    expect(tr1.status).toBe('pass');
  });

  it('falls back to bias-vs-median when supervisor TEM is poor', () => {
    // Supervisor with horrendous precision → TEM ≥ 2.1 mm → reject → use median.
    const truth = [140, 150, 160, 170, 180, 145, 155, 165, 175, 185];
    const sup: EnumeratorInput = {
      enumeratorId: 0,
      isSupervisor: true,
      measures: { muac: true, weight: true, height: true },
      pairs: {
        muac: pair(truth.map((x) => x + 5), truth.map((x) => x - 5)),
      },
    };
    const tr: EnumeratorInput = {
      enumeratorId: 1,
      isSupervisor: false,
      measures: { muac: true, weight: false, height: false },
      pairs: { muac: pair(truth, truth.map((x) => x + 0.1)) },
    };
    const r = runReport({ enumerators: [sup, tr] });
    expect(r.supervisorTem.muac!.cls).toBe('reject');
    const trRes = r.enumerators.find((e) => e.enumeratorId === 1)!;
    expect(trRes.measurements.muac!.biasReference).toBe('median');
  });

  it('calculates bias as a signed mean difference, allowing high/low misses to cancel', () => {
    const childIds = [1, 2];
    const sup: EnumeratorInput = {
      enumeratorId: 0,
      isSupervisor: true,
      measures: { muac: true, weight: false, height: false },
      pairs: { muac: pair([100, 200], [100, 200], childIds) },
    };
    const tr: EnumeratorInput = {
      enumeratorId: 1,
      isSupervisor: false,
      measures: { muac: true, weight: false, height: false },
      pairs: { muac: pair([105, 195], [105, 195], childIds) },
    };

    const r = runReport({ enumerators: [sup, tr] });
    const trRes = r.enumerators.find((e) => e.enumeratorId === 1)!;

    expect(trRes.measurements.muac!.intra.mean).toBe(150);
    expect(r.supervisorTem.muac!.intra.mean).toBe(150);
    expect(trRes.measurements.muac!.bias).toBe(0);
    expect(trRes.measurements.muac!.biasClass).toBe('good');
  });

  it('marks required measurements without data as failed', () => {
    const sup: EnumeratorInput = {
      enumeratorId: 0,
      isSupervisor: true,
      measures: { muac: true, weight: true, height: true },
      pairs: {},
    };
    const tr: EnumeratorInput = {
      enumeratorId: 1,
      isSupervisor: false,
      measures: { muac: true, weight: true, height: true },
      pairs: {},
    };
    const r = runReport({ enumerators: [sup, tr] });
    const trRes = r.enumerators.find((e) => e.enumeratorId === 1)!;
    expect(trRes.failed).toEqual(expect.arrayContaining(['muac', 'weight', 'height']));
    expect(trRes.status).toBe('fail');
  });
});
