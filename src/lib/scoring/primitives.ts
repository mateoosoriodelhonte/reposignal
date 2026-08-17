import type { Confidence, Metric, ScoreComponent, UnknownReason } from '@/types/analysis';
import type { SampleReport } from '@/types/snapshot';

/**
 * Shared building blocks for the scoring modules.
 *
 * The important one is `combine`, which implements the null-preservation rule
 * every category depends on: a component that could not be evaluated is
 * dropped and its weight is redistributed, rather than being scored as zero.
 */

/** A threshold band: values at or below `upTo` score `score`. */
export interface Band {
  upTo: number;
  score: number;
  label: string;
}

/**
 * Scores a value against ordered bands, ascending by `upTo`.
 *
 * Lower is better — used for ages, staleness, and days since an event. The
 * final band should use `Infinity` so every value is covered.
 */
export function scoreDescending(
  value: number | null,
  bands: Band[],
): { score: number | null; label: string } {
  if (value === null) return { score: null, label: 'Unknown' };

  for (const band of bands) {
    if (value <= band.upTo) return { score: band.score, label: band.label };
  }

  const last = bands[bands.length - 1];
  return { score: last?.score ?? 0, label: last?.label ?? 'Unknown' };
}

/**
 * Scores a value against ordered bands where higher is better.
 *
 * Bands are given descending by `atLeast`.
 */
export function scoreAscending(
  value: number | null,
  bands: Array<{ atLeast: number; score: number; label: string }>,
): { score: number | null; label: string } {
  if (value === null) return { score: null, label: 'Unknown' };

  for (const band of bands) {
    if (value >= band.atLeast) return { score: band.score, label: band.label };
  }

  const last = bands[bands.length - 1];
  return { score: last?.score ?? 0, label: last?.label ?? 'Unknown' };
}

/**
 * Combines weighted components into a category score.
 *
 * **This is where the null-preservation rule lives.** Components that could
 * not be evaluated are excluded and their weight is redistributed across the
 * remainder, so a repository is never penalized for data RepoSignal could not
 * observe. Scoring an unobservable component as zero is the single easiest way
 * to make the whole product dishonest.
 *
 * Returns `null` when nothing was scorable, or when the scorable components
 * carry less than `minimumWeightRatio` of the declared weight — a score built
 * from a fifth of its intended evidence is not worth presenting as a number.
 */
export function combine(
  components: ScoreComponent[],
  options: { minimumWeightRatio?: number } = {},
): { score: number | null; scoredWeight: number; totalWeight: number } {
  const minimumRatio = options.minimumWeightRatio ?? 0.5;

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const scored = components.filter(
    (component): component is ScoreComponent & { score: number } =>
      component.score !== null,
  );
  const scoredWeight = scored.reduce((sum, c) => sum + c.weight, 0);

  if (scoredWeight === 0 || totalWeight === 0) {
    return { score: null, scoredWeight, totalWeight };
  }

  if (scoredWeight / totalWeight < minimumRatio) {
    return { score: null, scoredWeight, totalWeight };
  }

  // Renormalize over the scored components only.
  const weighted = scored.reduce((sum, c) => sum + c.score * c.weight, 0);
  return {
    score: Math.round(weighted / scoredWeight),
    scoredWeight,
    totalWeight,
  };
}

/**
 * Confidence for a category.
 *
 * Two things lower it, and they are independent: how much of the intended
 * evidence was observable at all, and whether what was observed came from a
 * truncated sample. A finding derived from a partial view is `medium` at best,
 * however complete the rest of the category is.
 */
export function deriveConfidence(input: {
  scoredWeight: number;
  totalWeight: number;
  samples?: Array<SampleReport | null | undefined>;
}): Confidence {
  const ratio = input.totalWeight === 0 ? 0 : input.scoredWeight / input.totalWeight;
  const truncated = (input.samples ?? []).some((sample) => sample?.truncated === true);

  if (ratio >= 0.9 && !truncated) return 'high';
  if (ratio >= 0.6) return truncated ? 'medium' : 'high';
  if (ratio >= 0.4) return 'medium';
  return 'low';
}

/** Builds an observed metric. */
export function metric(
  id: string,
  label: string,
  value: number | string | null,
  options: { unit?: string; unknownReason?: UnknownReason; source?: string } = {},
): Metric {
  return {
    id,
    label,
    value,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(value === null && options.unknownReason !== undefined
      ? { unknownReason: options.unknownReason }
      : {}),
    ...(options.source === undefined ? {} : { source: options.source }),
  };
}

/** Builds a weighted score component. */
export function component(
  id: string,
  label: string,
  score: number | null,
  weight: number,
  observed: string,
  rule: string,
): ScoreComponent {
  return { id, label, score, weight, observed, rule };
}

/**
 * Renders the arithmetic behind a category score as a readable string.
 *
 * This is shown verbatim in the UI's methodology disclosure, which is the
 * point: a user who disagrees with a score can see exactly which term produced
 * it rather than being asked to trust the total.
 */
export function describeFormula(components: ScoreComponent[]): string {
  const scored = components.filter((c) => c.score !== null);
  if (scored.length === 0) return 'No component could be evaluated.';

  const scoredWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  const terms = scored
    .map((c) => `${c.score} × ${(c.weight / scoredWeight).toFixed(2)}`)
    .join(' + ');

  const excluded = components.filter((c) => c.score === null);
  const note =
    excluded.length === 0
      ? ''
      : ` Excluded as unobservable, with weight redistributed: ${excluded
          .map((c) => c.label)
          .join(', ')}.`;

  return `${terms}${note}`;
}
