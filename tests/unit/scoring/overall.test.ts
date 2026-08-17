import { describe, expect, it } from 'vitest';

import { analyzeSnapshot } from '@/lib/scoring';
import { scoreOverall, totalDeclaredWeight } from '@/lib/scoring/overall';
import {
  CATEGORY_WEIGHTS,
  MINIMUM_SCORED_CATEGORIES,
  SCORING_VERSION,
} from '@/lib/scoring/weights';
import type { CategoryKey, CategoryScore, Confidence } from '@/types/analysis';

import { NOW, buildHealthySnapshot, buildSnapshot } from '../../support/snapshot-builder';

/** A minimal category score, for exercising combination logic directly. */
function category(
  key: CategoryKey,
  score: number | null,
  confidence: Confidence = 'high',
): CategoryScore {
  return {
    key,
    label: key,
    score,
    confidence,
    metrics: [],
    findings: [],
    explanation: {
      summary: '',
      formula: '',
      components: [],
      limitations: [`${key} could not be scored.`],
    },
  };
}

const ALL_KEYS: CategoryKey[] = [
  'activity',
  'pullRequests',
  'issues',
  'ci',
  'documentation',
  'repository',
  'security',
];

describe('declared weights', () => {
  it('sum to 100', () => {
    expect(totalDeclaredWeight()).toBe(100);
  });

  it('cover every category exactly once', () => {
    expect(Object.keys(CATEGORY_WEIGHTS).sort()).toEqual([...ALL_KEYS].sort());
  });
});

describe('scoreOverall', () => {
  it('averages every category when all are scored', () => {
    const result = scoreOverall(ALL_KEYS.map((key) => category(key, 80)));
    expect(result.score).toBe(80);
  });

  it('weights categories by their declared weight', () => {
    // security is weighted 10, the rest 15. Scoring only security low should
    // move the total less than scoring an equally-weighted category low.
    const securityLow = scoreOverall(
      ALL_KEYS.map((key) => category(key, key === 'security' ? 0 : 100)),
    );
    const activityLow = scoreOverall(
      ALL_KEYS.map((key) => category(key, key === 'activity' ? 0 : 100)),
    );
    expect(securityLow.score).toBeGreaterThan(activityLow.score ?? 0);
  });

  describe('null handling — the rule the product depends on', () => {
    it('excludes a null category rather than scoring it zero', () => {
      const result = scoreOverall([
        category('activity', 90),
        category('issues', 90),
        category('ci', 90),
        category('documentation', null),
      ]);
      // With a zero it would be ~67. Excluded, it is 90.
      expect(result.score).toBe(90);
    });

    it('never lowers the overall score by adding a null category', () => {
      // The regression this whole design exists to prevent. Stated as a
      // property rather than a single case.
      const withoutNull = scoreOverall([
        category('activity', 70),
        category('issues', 80),
        category('ci', 90),
      ]);

      for (const key of [
        'documentation',
        'repository',
        'security',
        'pullRequests',
      ] as const) {
        const withNull = scoreOverall([
          category('activity', 70),
          category('issues', 80),
          category('ci', 90),
          category(key, null),
        ]);
        expect(withNull.score).toBe(withoutNull.score);
      }
    });

    it('redistributes weight so effective weights still sum to 100', () => {
      const result = scoreOverall([
        category('activity', 80),
        category('issues', 80),
        category('ci', 80),
        category('documentation', null),
        category('security', null),
      ]);

      // Effective weights are rounded to one decimal for display, so three
      // equal categories sum to 99.9 rather than exactly 100. The tolerance
      // allows that rounding but would still catch a redistribution bug.
      const total = result.contributions.reduce((sum, c) => sum + c.effectiveWeight, 0);
      expect(total).toBeGreaterThan(99.5);
      expect(total).toBeLessThanOrEqual(100);
    });

    it('records why each excluded category was excluded', () => {
      const result = scoreOverall([
        category('activity', 80),
        category('issues', 80),
        category('ci', 80),
        category('documentation', null),
      ]);

      expect(result.excluded).toHaveLength(1);
      expect(result.excluded[0]?.key).toBe('documentation');
      expect(result.excluded[0]?.reason).toContain('could not be scored');
    });

    it('reports both declared and effective weight for each contributor', () => {
      const result = scoreOverall([
        category('activity', 80),
        category('issues', 80),
        category('ci', 80),
      ]);

      const activity = result.contributions.find((c) => c.key === 'activity');
      expect(activity?.declaredWeight).toBe(15);
      // Three equally weighted categories share the whole score.
      expect(activity?.effectiveWeight).toBeCloseTo(33.3, 1);
    });
  });

  describe(`minimum of ${MINIMUM_SCORED_CATEGORIES} scored categories`, () => {
    it('returns null with too few categories scored', () => {
      const result = scoreOverall([
        category('activity', 90),
        category('issues', 90),
        category('ci', null),
        category('documentation', null),
      ]);
      expect(result.score).toBeNull();
      expect(result.formula).toMatch(/below the minimum/i);
    });

    it(`returns a number at exactly ${MINIMUM_SCORED_CATEGORIES}`, () => {
      const result = scoreOverall([
        category('activity', 90),
        category('issues', 90),
        category('ci', 90),
        category('documentation', null),
      ]);
      expect(result.score).toBe(90);
    });

    it('returns null when nothing was scored at all', () => {
      expect(scoreOverall(ALL_KEYS.map((key) => category(key, null))).score).toBeNull();
    });

    it('returns null for an empty category list', () => {
      expect(scoreOverall([]).score).toBeNull();
    });
  });

  describe('confidence', () => {
    it('is high when everything is scored confidently', () => {
      expect(scoreOverall(ALL_KEYS.map((key) => category(key, 80))).confidence).toBe(
        'high',
      );
    });

    it('is capped by the least confident contributing category', () => {
      const result = scoreOverall([
        ...ALL_KEYS.filter((k) => k !== 'issues').map((key) => category(key, 80)),
        category('issues', 80, 'low'),
      ]);
      expect(result.confidence).toBe('low');
    });

    it('drops when much of the declared weight could not be scored', () => {
      const result = scoreOverall([
        category('activity', 80),
        category('issues', 80),
        category('ci', 80),
        category('documentation', null),
        category('repository', null),
        category('security', null),
        category('pullRequests', null),
      ]);
      // 45 of 100 declared weight scored.
      expect(result.confidence).toBe('low');
    });
  });

  it('states the arithmetic it used', () => {
    const result = scoreOverall([
      category('activity', 80),
      category('issues', 60),
      category('ci', 100),
    ]);
    expect(result.formula).toContain('80 ×');
    expect(result.formula).toContain('60 ×');
  });

  it('explains that excluded weight was redistributed, not zeroed', () => {
    const result = scoreOverall([
      category('activity', 80),
      category('issues', 80),
      category('ci', 80),
      category('documentation', null),
    ]);
    expect(result.formula).toMatch(/never counted as zero/i);
  });

  it('rounds to a whole number', () => {
    const result = scoreOverall([
      category('activity', 81),
      category('issues', 82),
      category('ci', 84),
    ]);
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

describe('analyzeSnapshot', () => {
  const options = { now: NOW, analysisId: 'test-analysis-id' };

  it('produces a complete result for a healthy repository', () => {
    const result = analyzeSnapshot(buildHealthySnapshot(), options);

    expect(result.scoringVersion).toBe(SCORING_VERSION);
    expect(result.analysisId).toBe('test-analysis-id');
    expect(result.categories).toHaveLength(7);
    expect(result.overall.score).toBeGreaterThan(80);
  });

  it('records the scoring version on every result', () => {
    expect(analyzeSnapshot(buildSnapshot(), options).scoringVersion).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  it('is deterministic', () => {
    const snapshot = buildHealthySnapshot();
    expect(JSON.stringify(analyzeSnapshot(snapshot, options))).toBe(
      JSON.stringify(analyzeSnapshot(snapshot, options)),
    );
  });

  it('sorts findings by severity, most severe first', () => {
    const result = analyzeSnapshot(buildSnapshot(), options);
    const order = { high: 0, medium: 1, low: 2, info: 3 };

    const severities = result.findings.map((f) => order[f.severity]);
    const sorted = [...severities].sort((a, b) => a - b);
    expect(severities).toEqual(sorted);
  });

  it('still scores a repository with issues and pull requests unavailable', () => {
    const result = analyzeSnapshot(
      buildHealthySnapshot({ issues: null, pullRequests: null }),
      options,
    );

    expect(result.overall.score).not.toBeNull();
    expect(result.overall.excluded.map((e) => e.key).sort()).toEqual([
      'issues',
      'pullRequests',
    ]);
  });

  it('is not penalised for data that could not be collected', () => {
    const complete = analyzeSnapshot(buildHealthySnapshot(), options);
    const partial = analyzeSnapshot(
      buildHealthySnapshot({
        issues: null,
        pullRequests: null,
        ci: { workflowCount: null, recentRunConclusions: [], latestCommitStatus: null },
      }),
      options,
    );

    expect(partial.overall.score).toBeGreaterThanOrEqual(complete.overall.score ?? 0);
  });

  it('surfaces collection failures as analysis limitations', () => {
    const result = analyzeSnapshot(
      buildHealthySnapshot({
        collection: {
          requestsMade: 8,
          failures: [{ resource: 'actions/runs', reason: 'forbidden' }],
          rateLimitRemaining: 100,
        },
      }),
      options,
    );

    expect(result.limitations.join(' ')).toContain('actions/runs');
    expect(result.limitations.join(' ')).toMatch(/excluded rather than assumed/i);
  });

  it('notes when the repository is a fork', () => {
    const result = analyzeSnapshot(
      buildHealthySnapshot({ identity: { isFork: true } }),
      options,
    );
    expect(result.limitations.join(' ')).toMatch(/fork/i);
  });

  it('scores an empty repository low but does not crash', () => {
    const result = analyzeSnapshot(
      buildSnapshot({
        issues: null,
        pullRequests: null,
        activity: {
          releases: [],
          tagCount: 0,
          weeklyCommits: null,
          contributorCount: null,
        },
        ci: { workflowCount: 0, recentRunConclusions: [], latestCommitStatus: 'none' },
      }),
      options,
    );

    expect(result.overall.score).toBeLessThan(30);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('serializes to JSON without loss, so results can be cached', () => {
    const result = analyzeSnapshot(buildHealthySnapshot(), options);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
