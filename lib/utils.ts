import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  const factor = 10 ** digits;
  const rounded =
    (Math.sign(n) || 1) * Math.round(Math.abs(n) * factor + 1e-10) / factor;
  return Object.is(rounded, -0) ? (0).toFixed(digits) : rounded.toFixed(digits);
}
