import { describe, it, expect } from 'vitest';
import {
  classifyTemIntra,
  classifyBias,
  classifyR,
  passesMeasurement,
} from '@/lib/ena/thresholds';

describe('classifyTemIntra (SMART Plus suggested cutoffs)', () => {
  it('MUAC: <2.0 good, <2.7 accept, <3.3 poor, ≥3.3 reject', () => {
    expect(classifyTemIntra(0.5, 'muac')).toBe('good');
    expect(classifyTemIntra(1.99, 'muac')).toBe('good');
    expect(classifyTemIntra(2.0, 'muac')).toBe('acceptable');
    expect(classifyTemIntra(2.69, 'muac')).toBe('acceptable');
    expect(classifyTemIntra(2.7, 'muac')).toBe('poor');
    expect(classifyTemIntra(3.29, 'muac')).toBe('poor');
    expect(classifyTemIntra(3.3, 'muac')).toBe('reject');
  });
  it('Weight: <0.04 good, <0.10 accept, <0.21 poor', () => {
    expect(classifyTemIntra(0.039, 'weight')).toBe('good');
    expect(classifyTemIntra(0.04, 'weight')).toBe('acceptable');
    expect(classifyTemIntra(0.099, 'weight')).toBe('acceptable');
    expect(classifyTemIntra(0.10, 'weight')).toBe('poor');
    expect(classifyTemIntra(0.21, 'weight')).toBe('reject');
  });
  it('Height: <0.4 good, <0.6 accept, <1.0 poor', () => {
    expect(classifyTemIntra(0.39, 'height')).toBe('good');
    expect(classifyTemIntra(0.4, 'height')).toBe('acceptable');
    expect(classifyTemIntra(0.59, 'height')).toBe('acceptable');
    expect(classifyTemIntra(0.6, 'height')).toBe('poor');
    expect(classifyTemIntra(0.99, 'height')).toBe('poor');
    expect(classifyTemIntra(1.0, 'height')).toBe('reject');
  });
});

describe('classifyBias (SMART Plus suggested cutoffs)', () => {
  it('MUAC: <1 good, <2 accept, <3 poor, ≥3 reject', () => {
    expect(classifyBias(0.5, 'muac')).toBe('good');
    expect(classifyBias(-0.5, 'muac')).toBe('good');
    expect(classifyBias(0.99, 'muac')).toBe('good');
    expect(classifyBias(1.0, 'muac')).toBe('acceptable');
    expect(classifyBias(1.99, 'muac')).toBe('acceptable');
    expect(classifyBias(2.0, 'muac')).toBe('poor');
    expect(classifyBias(2.99, 'muac')).toBe('poor');
    expect(classifyBias(3.0, 'muac')).toBe('reject');
  });
  it('Weight uses <0.04 / <0.10 / <0.21', () => {
    expect(classifyBias(0.03, 'weight')).toBe('good');
    expect(classifyBias(0.05, 'weight')).toBe('acceptable');
    expect(classifyBias(0.21, 'weight')).toBe('reject');
  });
  it('Height uses <0.4 / <0.8 / <1.4', () => {
    expect(classifyBias(0.39, 'height')).toBe('good');
    expect(classifyBias(0.7, 'height')).toBe('acceptable');
    expect(classifyBias(1.4, 'height')).toBe('reject');
  });
});

describe('classifyR (SMART Plus suggested cutoffs, descending)', () => {
  it('MUAC: >99 good, >95 accept, >90 poor', () => {
    expect(classifyR(99.5, 'muac')).toBe('good');
    expect(classifyR(99, 'muac')).toBe('acceptable');
    expect(classifyR(95.1, 'muac')).toBe('acceptable');
    expect(classifyR(95, 'muac')).toBe('poor');
    expect(classifyR(91, 'muac')).toBe('poor');
    expect(classifyR(90, 'muac')).toBe('reject');
  });
  it('Weight: >99 good, >95 accept, >90 poor', () => {
    expect(classifyR(99.5, 'weight')).toBe('good');
    expect(classifyR(99, 'weight')).toBe('acceptable');
    expect(classifyR(95.5, 'weight')).toBe('acceptable');
    expect(classifyR(95, 'weight')).toBe('poor');
    expect(classifyR(90, 'weight')).toBe('reject');
  });
  it('Height has the same scale as weight', () => {
    expect(classifyR(99.5, 'height')).toBe('good');
    expect(classifyR(95.1, 'height')).toBe('acceptable');
    expect(classifyR(90.5, 'height')).toBe('poor');
    expect(classifyR(90, 'height')).toBe('reject');
  });
});

describe('passesMeasurement', () => {
  it('passes only when both TEM and bias are good or acceptable', () => {
    expect(passesMeasurement('good', 'good')).toBe(true);
    expect(passesMeasurement('good', 'acceptable')).toBe(true);
    expect(passesMeasurement('acceptable', 'acceptable')).toBe(true);
    expect(passesMeasurement('poor', 'good')).toBe(false);
    expect(passesMeasurement('good', 'poor')).toBe(false);
    expect(passesMeasurement('reject', 'good')).toBe(false);
  });
});
