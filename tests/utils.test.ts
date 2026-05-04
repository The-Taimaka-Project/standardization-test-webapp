import { describe, expect, it } from 'vitest';
import { fmt } from '@/lib/utils';

describe('fmt', () => {
  it('rounds half values consistently despite floating-point representation', () => {
    expect(fmt(-0.004999999999999005, 2)).toBe('-0.01');
    expect(fmt(0.004999999999999005, 2)).toBe('0.01');
  });

  it('does not display negative zero for values that round to zero', () => {
    expect(fmt(-0.001, 2)).toBe('0.00');
  });
});
