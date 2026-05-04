# Anthropometric Standardization Test Webapp

This project is a web app for running anthropometric standardization tests for field teams. It was built for Taimaka's internal workflow, where measurements are collected in ODK Central, corrected in a web UI, and then evaluated using SMART/SMART Plus-style calculations.

Most organizations will not have the same ODK setup. The reusable part of this repository is the calculation logic: intra-observer TEM, coefficient of reliability, signed bias, classification thresholds, and pass/fail rules for MUAC, weight, and height standardization tests.

The calculation code lives in [`lib/ena`](./lib/ena):

- [`tem.ts`](./lib/ena/tem.ts): intra-observer TEM, mean, SD, max difference, relative TEM, R value.
- [`bias.ts`](./lib/ena/bias.ts): signed bias vs supervisor or median.
- [`thresholds.ts`](./lib/ena/thresholds.ts): SMART Plus cutoffs and pass/fail classification.
- [`runReport.ts`](./lib/ena/runReport.ts): assembles per-enumerator results across measurements.

## Standardization Test Data Shape

The calculations assume each observer measures the same set of children twice.

For each observer and measurement, provide paired arrays:

```ts
{
  round1: [159, 165, 136, ...],
  round2: [160, 163, 137, ...],
  childIds: [1, 2, 3, ...] // optional but recommended
}
```

Units used by the calculation library:

- MUAC: millimeters
- Weight: kilograms
- Height: centimeters

If your source system captures MUAC in centimeters, convert to millimeters before calling the report code.

## TEM

Intra-observer TEM measures precision: how closely an observer repeats their own measurements.

For `N` children:

```text
d_i = round1_i - round2_i
TEM = sqrt(sum(d_i^2) / (2N))
```

The library also computes:

```text
mean = mean of all 2N measurements
SD = sample standard deviation of all 2N measurements
relative TEM = TEM / mean * 100
R = (1 - TEM^2 / SD^2) * 100
max difference = max(abs(round1_i - round2_i))
```

See [`intraTem`](./lib/ena/tem.ts).

## Bias

Bias measures accuracy: whether an observer tends to measure high or low compared with a reference.

This project currently follows the SMART Plus output behavior: bias is signed. A negative value means the observer tends to measure lower than the reference; a positive value means higher.

### Bias vs Supervisor

When the supervisor's own TEM for a measurement is good or acceptable, trainees are compared to the supervisor.

For each child:

```text
T_i = (trainee_round1_i + trainee_round2_i) / 2
S_i = (supervisor_round1_i + supervisor_round2_i) / 2
bias = mean(T_i - S_i)
```

This is equivalent to:

```text
bias = mean(all trainee measurements) - mean(all supervisor measurements)
```

when both observers measured the same children twice.

### Bias vs Median

If the supervisor's own TEM is poor or reject, the fallback reference is the group median.

For each child, the library pools all round-1 and round-2 values from all included observers and the supervisor, then takes the median for that child:

```text
M_i = median(all measurements for child i)
bias = mean((observer_round1_i - M_i), (observer_round2_i - M_i))
```

Supervisor rows are also displayed relative to the median, matching SMART Plus report behavior.

See [`biasVsSupervisor`](./lib/ena/bias.ts) and [`biasVsMedian`](./lib/ena/bias.ts).

## Cutoffs

Classification uses the absolute value of bias, even though the reported bias is signed.

Current cutoffs match the SMART Plus suggested threshold table.

### Individual TEM

| Measurement | Good | Acceptable | Poor | Reject |
| --- | ---: | ---: | ---: | ---: |
| MUAC | `<2.0 mm` | `<2.7 mm` | `<3.3 mm` | `>=3.3 mm` |
| Weight | `<0.04 kg` | `<0.10 kg` | `<0.21 kg` | `>=0.21 kg` |
| Height | `<0.4 cm` | `<0.6 cm` | `<1.0 cm` | `>=1.0 cm` |

### Absolute Bias

| Measurement | Good | Acceptable | Poor | Reject |
| --- | ---: | ---: | ---: | ---: |
| MUAC | `<1 mm` | `<2 mm` | `<3 mm` | `>=3 mm` |
| Weight | `<0.04 kg` | `<0.10 kg` | `<0.21 kg` | `>=0.21 kg` |
| Height | `<0.4 cm` | `<0.8 cm` | `<1.4 cm` | `>=1.4 cm` |

### R Value

| Good | Acceptable | Poor | Reject |
| ---: | ---: | ---: | ---: |
| `>99` | `>95` | `>90` | `<=90` |

Boundary behavior is intentional: the upper bounds are strict `<`, and reject starts at `>=`.

See [`thresholds.ts`](./lib/ena/thresholds.ts).

## Pass/Fail Rule

For each required measurement, a trainee passes only if both:

- TEM class is good or acceptable.
- Bias class is good or acceptable.

R value is reported, but it is not part of the pass/fail rule in this implementation.

## Minimal Usage Example

```ts
import { runReport } from './lib/ena/runReport';

const report = runReport({
  enumerators: [
    {
      enumeratorId: 0,
      displayName: 'Supervisor',
      isSupervisor: true,
      measures: { muac: true, weight: true, height: true },
      pairs: {
        muac: {
          childIds: [1, 2, 3],
          round1: [159, 165, 136],
          round2: [160, 163, 137],
        },
      },
    },
    {
      enumeratorId: 1,
      displayName: 'Enumerator 1',
      isSupervisor: false,
      measures: { muac: true, weight: false, height: false },
      pairs: {
        muac: {
          childIds: [1, 2, 3],
          round1: [156, 161, 137],
          round2: [156, 164, 138],
        },
      },
    },
  ],
});

console.log(report.enumerators[1].measurements.muac);
```

## ODK Workflow

The app can pull submissions from ODK Central, normalize them, surface duplicates/discrepancies, apply local overrides, and run the report. That workflow is useful for Taimaka, but not required to reuse the calculation code.

The ODK form and reference workbooks are in [`reference`](./reference). If you want to reproduce the original workflow, start with:

- [`lib/odk`](./lib/odk): ODK client and normalization.
- [`lib/actions/runReport.ts`](./lib/actions/runReport.ts): converts normalized submissions into the calculation input.
- [`app/instances`](./app/instances): UI for correction and report generation.

## Development

```bash
npm install
npm test
npx tsc --noEmit
npm run dev
```

The app itself is built with Next.js, TypeScript, React, Postgres, Drizzle ORM, Auth.js, and Vitest.

