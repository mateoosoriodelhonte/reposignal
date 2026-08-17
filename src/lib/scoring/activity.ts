import { ageInDays, parseDate } from '@/lib/normalize/dates';
import type { CategoryScore, Finding } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

import {
  combine,
  component,
  describeFormula,
  deriveConfidence,
  metric,
  scoreDescending,
} from './primitives';
import { CATEGORY_LABELS } from './weights';

/**
 * Repository activity scoring.
 *
 * Two things this module is careful about:
 *
 * 1. **Archived repositories are not neglected repositories.** Archiving is a
 *    deliberate act that says "this is finished". Scoring an archived project
 *    as inactive would punish a maintainer for closing something down
 *    responsibly, so activity components are excluded and the category
 *    reports on the archival instead.
 *
 * 2. **Unavailable commit statistics are not zero commits.** GitHub computes
 *    them asynchronously and answers 202 until they are ready. Treating that
 *    as no activity would make a busy repository look dead.
 */

/** Bands for days since the last push. Lower is better. */
const LAST_PUSH_BANDS = [
  { upTo: 30, score: 100, label: 'Pushed within a month' },
  { upTo: 90, score: 85, label: 'Pushed within 3 months' },
  { upTo: 180, score: 65, label: 'Pushed within 6 months' },
  { upTo: 365, score: 40, label: 'Pushed within a year' },
  { upTo: Infinity, score: 15, label: 'No push in over a year' },
];

/** Bands for days since the most recent release. Lower is better. */
const LAST_RELEASE_BANDS = [
  { upTo: 90, score: 100, label: 'Released within 3 months' },
  { upTo: 180, score: 85, label: 'Released within 6 months' },
  { upTo: 365, score: 65, label: 'Released within a year' },
  { upTo: 730, score: 40, label: 'Released within 2 years' },
  { upTo: Infinity, score: 20, label: 'No release in over 2 years' },
];

/** Releases needed before cadence regularity means anything. */
export const MINIMUM_RELEASES_FOR_CADENCE = 3;

/** Weeks of the trailing year with at least one commit, as a proportion. */
function activeWeekRatio(weeklyCommits: number[] | null): number | null {
  if (weeklyCommits === null || weeklyCommits.length === 0) return null;
  return weeklyCommits.filter((count) => count > 0).length / weeklyCommits.length;
}

/**
 * Regularity of release intervals, as a 0–100 score.
 *
 * Uses the coefficient of variation — standard deviation over mean — so it
 * measures consistency independent of how often a project releases. A project
 * releasing every 6 months predictably scores as well as one releasing weekly.
 *
 * Returns `null` below three releases, since two releases give exactly one
 * interval and one interval has no variation to measure.
 */
export function releaseCadenceScore(publishedDates: Date[]): number | null {
  if (publishedDates.length < MINIMUM_RELEASES_FOR_CADENCE) return null;

  const sorted = [...publishedDates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    intervals.push((current.getTime() - previous.getTime()) / 86_400_000);
  }

  if (intervals.length === 0) return null;

  const mean = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
  if (mean === 0) return null;

  const variance =
    intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
  const coefficientOfVariation = Math.sqrt(variance) / mean;

  // CV of 0 is perfectly regular; 1.5 or above is effectively arbitrary.
  return Math.round(Math.max(0, Math.min(1, 1 - coefficientOfVariation / 1.5)) * 100);
}

export function scoreActivity(snapshot: RepositorySnapshot, now: Date): CategoryScore {
  const activity = snapshot.activity;
  const repoUrl = snapshot.identity.htmlUrl;

  const daysSincePush = ageInDays(activity.pushedAt, now);
  const publishedDates = activity.releases
    .map((release) => parseDate(release.publishedAt))
    .filter((date): date is Date => date !== null);

  const latestRelease = publishedDates.reduce<Date | null>(
    (latest, date) => (latest === null || date > latest ? date : latest),
    null,
  );
  const daysSinceRelease =
    latestRelease === null ? null : ageInDays(latestRelease.toISOString(), now);

  const weekRatio = activeWeekRatio(activity.weeklyCommits);
  const cadence = releaseCadenceScore(publishedDates);

  const push = scoreDescending(daysSincePush, LAST_PUSH_BANDS);
  const release = scoreDescending(daysSinceRelease, LAST_RELEASE_BANDS);

  const findings: Finding[] = [];

  // An archived repository is finished, not failing. Activity components are
  // excluded and the category is scored on what remains.
  if (activity.isArchived) {
    findings.push({
      id: 'activity.archived',
      category: 'activity',
      severity: 'info',
      title: 'Repository is archived',
      explanation:
        'The maintainers have archived this repository, marking it read-only and no longer maintained. Recency of activity is not a meaningful signal for an archived project, so it was excluded from this score rather than counted against it.',
      metric: { archived: 'true' },
      recommendation:
        'If you depend on this project, look for a maintained fork or a documented successor.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  const components = activity.isArchived
    ? [
        component(
          'activity.releases',
          'Release history',
          activity.releases.length > 0 ? 100 : 0,
          50,
          `${activity.releases.length} published release${activity.releases.length === 1 ? '' : 's'}`,
          'An archived repository is scored on what it left behind: at least one release scores 100.',
        ),
        component(
          'activity.cadence',
          'Release cadence regularity',
          cadence,
          50,
          cadence === null
            ? `Fewer than ${MINIMUM_RELEASES_FOR_CADENCE} releases — not measurable`
            : `Regularity score ${cadence}`,
          `Coefficient of variation of intervals between releases. Null below ${MINIMUM_RELEASES_FOR_CADENCE} releases.`,
        ),
      ]
    : [
        component(
          'activity.lastPush',
          'Time since last push',
          push.score,
          35,
          daysSincePush === null
            ? 'No push timestamp available'
            : `${daysSincePush} days ago`,
          `Days since the most recent push. ${push.label}.`,
        ),
        component(
          'activity.commitCadence',
          'Weeks with commits',
          weekRatio === null ? null : Math.round(weekRatio * 100),
          25,
          weekRatio === null
            ? 'GitHub has not made commit statistics available'
            : `${Math.round(weekRatio * 100)}% of the last ${activity.weeklyCommits?.length ?? 0} weeks had commits`,
          'Proportion of the trailing year’s weeks containing at least one commit. Unavailable statistics score null and the weight is redistributed.',
        ),
        component(
          'activity.lastRelease',
          'Time since last release',
          release.score,
          25,
          daysSinceRelease === null
            ? 'No published releases'
            : `${daysSinceRelease} days ago`,
          `Days since the most recent published release. ${release.label}.`,
        ),
        component(
          'activity.cadence',
          'Release cadence regularity',
          cadence,
          15,
          cadence === null
            ? `Fewer than ${MINIMUM_RELEASES_FOR_CADENCE} releases — not measurable`
            : `Regularity score ${cadence}`,
          `Coefficient of variation of intervals between releases, so a predictable slow cadence scores as well as a predictable fast one. Null below ${MINIMUM_RELEASES_FOR_CADENCE} releases.`,
        ),
      ];

  const { score, scoredWeight, totalWeight } = combine(components);

  if (!activity.isArchived && daysSincePush !== null && daysSincePush > 365) {
    findings.push({
      id: 'activity.inactive',
      category: 'activity',
      severity: 'high',
      title: 'No commits pushed in over a year',
      explanation: `The most recent push was ${daysSincePush} days ago. The repository is not archived, so it is presented as maintained, but nothing has been committed in over a year.`,
      metric: { daysSinceLastPush: daysSincePush },
      recommendation:
        'If you depend on this project, check whether it is still maintained before relying on future fixes.',
      confidence: 'high',
      evidenceUrl: `${repoUrl}/commits`,
    });
  } else if (!activity.isArchived && daysSincePush !== null && daysSincePush > 180) {
    findings.push({
      id: 'activity.slowing',
      category: 'activity',
      severity: 'medium',
      title: 'No commits pushed in over six months',
      explanation: `The most recent push was ${daysSincePush} days ago. For a stable, finished library this can be entirely normal; for one still under development it is not.`,
      metric: { daysSinceLastPush: daysSincePush },
      recommendation: 'No action implied — this is context for evaluating the project.',
      confidence: 'high',
      evidenceUrl: `${repoUrl}/commits`,
    });
  }

  if (activity.releases.length === 0 && !activity.isArchived) {
    findings.push({
      id: 'activity.releases.none',
      category: 'activity',
      severity: 'low',
      title: 'No published releases',
      explanation:
        'The repository has no published releases, so consumers have no versioned artifact to depend on and no record of what changed between points in time.',
      metric: { releaseCount: 0 },
      recommendation:
        'Publish releases at meaningful points so consumers can pin a version.',
      confidence: 'high',
      evidenceUrl: `${repoUrl}/releases`,
    });
  }

  if (cadence !== null && cadence < 40) {
    findings.push({
      id: 'activity.cadence.irregular',
      category: 'activity',
      severity: 'info',
      title: 'Release cadence is irregular',
      explanation: `Intervals between the ${publishedDates.length} published releases vary widely. Irregular releases make it harder to anticipate when a fix will ship, though many healthy projects release when there is something worth releasing rather than on a schedule.`,
      metric: { cadenceScore: cadence, releasesExamined: publishedDates.length },
      recommendation: 'No action implied.',
      confidence: 'medium',
      evidenceUrl: `${repoUrl}/releases`,
    });
  }

  const limitations = [
    'Activity measures visible timestamps, not effort. A single automated commit and a substantial feature look identical here.',
    'Recent activity is not the same as quality, and inactivity is not the same as abandonment — a small, finished library may correctly go years without a commit.',
  ];

  if (activity.weeklyCommits === null) {
    limitations.push(
      'GitHub had not finished computing commit statistics for this repository, so commit cadence could not be measured. It was excluded from the score rather than treated as zero commits.',
    );
  }

  if (activity.contributorCount === null) {
    limitations.push(
      'GitHub declined to enumerate contributors for this repository, so contributor count is unknown.',
    );
  }

  return {
    key: 'activity',
    label: CATEGORY_LABELS.activity,
    score,
    confidence: deriveConfidence({ scoredWeight, totalWeight }),
    metrics: [
      metric('activity.lastPush.days', 'Days since last push', daysSincePush, {
        unit: 'days',
        unknownReason: 'not_retrieved',
      }),
      metric(
        'activity.commitWeeks.ratio',
        'Weeks with commits',
        weekRatio === null ? null : Math.round(weekRatio * 100),
        {
          unit: '%',
          unknownReason: 'not_retrieved',
        },
      ),
      metric('activity.releases.count', 'Published releases', activity.releases.length),
      metric('activity.lastRelease.days', 'Days since last release', daysSinceRelease, {
        unit: 'days',
        unknownReason: 'not_applicable',
      }),
      metric('activity.cadence.score', 'Release cadence regularity', cadence, {
        unknownReason: 'insufficient_data',
      }),
      metric('activity.contributors.count', 'Contributors', activity.contributorCount, {
        unknownReason: 'not_retrieved',
      }),
      metric('activity.archived', 'Archived', String(activity.isArchived)),
    ],
    findings,
    explanation: {
      summary: activity.isArchived
        ? 'This repository is archived, so recency was excluded and it is scored on the release history it left behind.'
        : 'Measures whether the project is being actively developed: how recently it was pushed to, how consistently it is committed to, and how recently and regularly it releases.',
      formula: describeFormula(components),
      components,
      limitations,
    },
  };
}
