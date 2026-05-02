import { describe, it, expect } from 'vitest';
import { intraTem } from '@/lib/ena/tem';

describe('intraTem', () => {
  it('matches the worked example: identical pairs give TEM 0', () => {
    const r = intraTem({
      round1: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      round2: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    });
    expect(r.n).toBe(10);
    expect(r.mean).toBeCloseTo(14.5, 6);
    expect(r.tem).toBeCloseTo(0, 6);
    expect(r.max).toBeCloseTo(0, 6);
    // R = 1 - 0/var = 100%
    expect(r.r).toBeCloseTo(100, 4);
  });

  it('TEM = sqrt(Σd²/2N) holds on a constructed example', () => {
    // d = [1,1,1,1,1,1,1,1,1,1] → Σd² = 10 → TEM = sqrt(10/20) = 0.7071
    const r = intraTem({
      round1: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      round2: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    });
    expect(r.tem).toBeCloseTo(Math.sqrt(0.5), 6);
    expect(r.max).toBe(1);
  });

  it('handles a known sample: MUAC values around 158 mm with small jitter', () => {
    // Mimic the MUAC magnitudes seen in the reference ENA file.
    // Round-trip the formula and confirm internal consistency.
    const round1 = [150, 155, 160, 165, 170, 145, 175, 180, 158, 162];
    const round2 = [151, 154, 161, 164, 171, 146, 174, 181, 159, 161];
    const r = intraTem({ round1, round2 });
    // Verify TEM by hand: Σd² = 1+1+1+1+1+1+1+1+1+1 = 10; 2N = 20
    expect(r.tem).toBeCloseTo(Math.sqrt(10 / 20), 6);
    // %TEM is small (<1%) — sanity check for that magnitude.
    expect(r.temPct).toBeLessThan(1);
    // R should be very high (close to 100) given the small TEM relative to spread.
    expect(r.r).toBeGreaterThan(99);
  });
});
