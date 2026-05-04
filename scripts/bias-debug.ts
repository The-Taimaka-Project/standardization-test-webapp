/**
 * Validate the bias formulas in `lib/ena/bias.ts` against ENA's reported
 * MUAC bias columns for the May 3 test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { biasVsSupervisor, biasVsMedian, type PerChildPair } from '@/lib/ena/bias';

type Measure = 'weight' | 'hl' | 'muac';

interface PerEnum { enumIdx: number; data: Map<number, Record<Measure, [number, number]>> }

function parseCsv(): PerEnum[] {
  const text = fs.readFileSync(path.resolve('reference', '05-03-26-input.csv'), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0].split(',');
  let maxIdx = 0;
  for (const h of header) {
    const m = /^(weight|hl|muac)_(1|2)_(\d+)$/.exec(h);
    if (m) maxIdx = Math.max(maxIdx, +m[3]);
  }
  const result: PerEnum[] = [];
  for (let idx = 0; idx <= maxIdx; idx++) result.push({ enumIdx: idx, data: new Map() });
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(',');
    const childId = +cells[0];
    for (let c = 1; c < cells.length; c++) {
      const m = /^(weight|hl|muac)_(1|2)_(\d+)$/.exec(header[c]);
      if (!m) continue;
      const measure = m[1] as Measure;
      const round = +m[2];
      const idx = +m[3];
      const v = cells[c];
      const num = v === 'NA' || v === '' ? NaN : parseFloat(v);
      const enumRec = result[idx];
      let row = enumRec.data.get(childId);
      if (!row) {
        row = { weight: [NaN, NaN], hl: [NaN, NaN], muac: [NaN, NaN] };
        enumRec.data.set(childId, row);
      }
      row[measure][round - 1] = num;
    }
  }
  return result;
}

function pairsFor(e: PerEnum, m: Measure): PerChildPair[] {
  const out: PerChildPair[] = [];
  for (const [childId, rec] of e.data) {
    const [r1, r2] = rec[m];
    if (!Number.isFinite(r1) || !Number.isFinite(r2)) continue;
    out.push({ childId, round1: r1, round2: r2 });
  }
  return out.sort((a, b) => a.childId - b.childId);
}

const ENA: Record<number, { bias_sup: number; bias_med: number }> = {
   0: { bias_sup: 0.00, bias_med: 1.05 },
   1: { bias_sup: 2.25, bias_med: 1.30 },
   2: { bias_sup: 1.33, bias_med: 1.18 },
   3: { bias_sup: 2.08, bias_med: 1.72 },
   4: { bias_sup: 2.21, bias_med: 1.52 },
   5: { bias_sup: 2.27, bias_med: 1.65 },
   6: { bias_sup: 1.48, bias_med: 0.77 },
   7: { bias_sup: 1.85, bias_med: 1.33 },
   8: { bias_sup: 2.33, bias_med: 1.53 },
   9: { bias_sup: 1.48, bias_med: 0.95 },
  10: { bias_sup: 1.60, bias_med: 1.20 },
  11: { bias_sup: 2.51, bias_med: 2.12 },
  12: { bias_sup: 1.65, bias_med: 1.36 },
  13: { bias_sup: 2.02, bias_med: 1.04 },
  14: { bias_sup: 3.55, bias_med: 3.00 },
  15: { bias_sup: 1.66, bias_med: 1.25 },
  16: { bias_sup: 2.77, bias_med: 2.08 },
  17: { bias_sup: 2.48, bias_med: 2.06 },
  18: { bias_sup: 3.45, bias_med: 3.06 },
  19: { bias_sup: 2.74, bias_med: 1.76 },
  20: { bias_sup: 2.07, bias_med: 1.43 },
};

const enums = parseCsv();
const measure: Measure = 'muac';
const sup = enums[0];
const supPairs = pairsFor(sup, measure);
const allPairs: PerChildPair[][] = enums
  .filter((e) => pairsFor(e, measure).length > 0)
  .map((e) => pairsFor(e, measure));

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Alternative bias_med candidates ------------------------------
function bMedA(en: PerChildPair[], all: PerChildPair[][]) {
  return biasVsMedian(en, all); // current: per-(round, child) median
}
function bMedB(en: PerChildPair[], all: PerChildPair[][]) {
  // median per child across all 2N values (rounds combined)
  const byChild = new Map<number, number[]>();
  for (const pairs of all) for (const p of pairs) {
    const v = byChild.get(p.childId) ?? []; v.push(p.round1, p.round2); byChild.set(p.childId, v);
  }
  let s = 0, n = 0;
  for (const p of en) {
    const med = median(byChild.get(p.childId) ?? []);
    if (!Number.isFinite(med)) continue;
    s += Math.abs(p.round1 - med) + Math.abs(p.round2 - med);
    n += 2;
  }
  return n > 0 ? s / n : NaN;
}
function bMedC(en: PerChildPair[], all: PerChildPair[][]) {
  // median per child of per-enumerator child-means
  const byChild = new Map<number, number[]>();
  for (const pairs of all) for (const p of pairs) {
    const v = byChild.get(p.childId) ?? []; v.push((p.round1 + p.round2) / 2); byChild.set(p.childId, v);
  }
  let s = 0, n = 0;
  for (const p of en) {
    const med = median(byChild.get(p.childId) ?? []);
    if (!Number.isFinite(med)) continue;
    s += Math.abs(p.round1 - med) + Math.abs(p.round2 - med);
    n += 2;
  }
  return n > 0 ? s / n : NaN;
}
function bMedD(en: PerChildPair[], all: PerChildPair[][]) {
  // mean over children of |enum_child_mean - median_of_child_means|
  const byChild = new Map<number, number[]>();
  for (const pairs of all) for (const p of pairs) {
    const v = byChild.get(p.childId) ?? []; v.push((p.round1 + p.round2) / 2); byChild.set(p.childId, v);
  }
  const diffs: number[] = [];
  for (const p of en) {
    const med = median(byChild.get(p.childId) ?? []);
    if (!Number.isFinite(med)) continue;
    diffs.push(Math.abs((p.round1 + p.round2) / 2 - med));
  }
  return diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : NaN;
}
// Leave-one-out: exclude the focal enumerator from the per-(round, child) median.
function bMedE(en: PerChildPair[], all: PerChildPair[][]) {
  const r1Map = new Map<number, number[]>();
  const r2Map = new Map<number, number[]>();
  for (const pairs of all) {
    for (const p of pairs) {
      const r1 = r1Map.get(p.childId) ?? []; r1.push(p.round1); r1Map.set(p.childId, r1);
      const r2 = r2Map.get(p.childId) ?? []; r2.push(p.round2); r2Map.set(p.childId, r2);
    }
  }
  // Build a quick lookup of the focal enumerator's values to exclude.
  const enR1 = new Map<number, number>(); const enR2 = new Map<number, number>();
  for (const p of en) { enR1.set(p.childId, p.round1); enR2.set(p.childId, p.round2); }

  let s = 0, n = 0;
  for (const p of en) {
    const r1All = r1Map.get(p.childId) ?? [];
    const r2All = r2Map.get(p.childId) ?? [];
    const focalR1 = enR1.get(p.childId);
    const focalR2 = enR2.get(p.childId);
    // Remove ONE instance of the focal value (the focal enumerator's contribution).
    const r1Rest = removeOne(r1All, focalR1);
    const r2Rest = removeOne(r2All, focalR2);
    const m1 = median(r1Rest);
    const m2 = median(r2Rest);
    if (Number.isFinite(m1)) { s += Math.abs(p.round1 - m1); n++; }
    if (Number.isFinite(m2)) { s += Math.abs(p.round2 - m2); n++; }
  }
  return n > 0 ? s / n : NaN;
}
function removeOne(xs: number[], v: number | undefined): number[] {
  if (v == null) return xs;
  const out = [...xs];
  const idx = out.indexOf(v);
  if (idx >= 0) out.splice(idx, 1);
  return out;
}

let sumSupErr = 0, nSup = 0;
const medErrors = { A: 0, B: 0, C: 0, D: 0, E: 0 };
let nMed = 0;
console.log(`enum | ENA bSup | ours bSup | err  | ENA bMed |  medA  |  medB  |  medC  |  medD  |  medE`);
for (const e of enums) {
  const ps = pairsFor(e, measure);
  if (ps.length === 0) continue;
  const ena = ENA[e.enumIdx];
  if (!ena) continue;
  const oursSup = biasVsSupervisor(e.enumIdx, ps, 0, supPairs);
  const errSup = Math.abs(oursSup - ena.bias_sup);
  const a = bMedA(ps, allPairs);
  const b = bMedB(ps, allPairs);
  const c = bMedC(ps, allPairs);
  const d = bMedD(ps, allPairs);
  const eMed = bMedE(ps, allPairs);
  console.log(
    [
      String(e.enumIdx).padStart(4),
      ena.bias_sup.toFixed(2),
      oursSup.toFixed(2),
      errSup.toFixed(2),
      ena.bias_med.toFixed(2),
      a.toFixed(2),
      b.toFixed(2),
      c.toFixed(2),
      d.toFixed(2),
      eMed.toFixed(2),
    ].join(' | '),
  );
  if (e.enumIdx !== 0) { sumSupErr += errSup; nSup++; }
  medErrors.A += Math.abs(a - ena.bias_med);
  medErrors.B += Math.abs(b - ena.bias_med);
  medErrors.C += Math.abs(c - ena.bias_med);
  medErrors.D += Math.abs(d - ena.bias_med);
  medErrors.E += Math.abs(eMed - ena.bias_med);
  nMed++;
}
console.log(`\nbias_sup mean abs error: ${(sumSupErr / nSup).toFixed(3)}`);
console.log('bias_med mean abs error per candidate:');
for (const [k, v] of Object.entries(medErrors).sort((x, y) => x[1] - y[1])) {
  console.log(`  ${k}: ${(v / nMed).toFixed(3)}`);
}
