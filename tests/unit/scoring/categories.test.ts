import { describe, expect, it } from 'vitest';

import { releaseCadenceScore, scoreActivity } from '@/lib/scoring/activity';
import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  countLeadingFailures,
  scoreCi,
} from '@/lib/scoring/ci';
import { README_STUB_BYTES, scoreDocumentation } from '@/lib/scoring/documentation';
import { STALE_ISSUE_DAYS, scoreIssues } from '@/lib/scoring/issues';
import { LONG_LIVED_PR_DAYS, scorePullRequests } from '@/lib/scoring/pull-requests';
import { scoreRepository } from '@/lib/scoring/repository';
import { scoreSecurity } from '@/lib/scoring/security';

import {
  ABSENT,
  NOW,
  allFilesPresent,
  buildHealthySnapshot,
  buildSnapshot,
  daysAgo,
  present,
} from '../../support/snapshot-builder';

describe('scoreDocumentation', () => {
  it('scores 100 with every file present and substantial', () => {
    expect(scoreDocumentation(buildHealthySnapshot()).score).toBe(100);
  });

  it('scores 0 with nothing present — this category is always observable', () => {
    const result = scoreDocumentation(buildSnapshot());
    expect(result.score).toBe(0);
    // Distinct from null: file absence is an observation, not missing data.
    expect(result.score).not.toBeNull();
  });

  it.each([
    ['README', 'readme', 'documentation.readme.missing'],
    ['LICENSE', 'license', 'documentation.license.missing'],
    ['CONTRIBUTING', 'contributing', 'documentation.contributing.missing'],
  ])('emits a finding when %s is absent', (_label, key, findingId) => {
    const result = scoreDocumentation(buildHealthySnapshot({ files: { [key]: ABSENT } }));
    expect(result.findings.map((f) => f.id)).toContain(findingId);
  });

  it('rates a missing LICENSE as high severity', () => {
    const result = scoreDocumentation(
      buildHealthySnapshot({ files: { license: ABSENT } }),
    );
    const finding = result.findings.find((f) => f.id === 'documentation.license.missing');
    expect(finding?.severity).toBe('high');
  });

  describe('README stub boundary', () => {
    it(`treats exactly ${README_STUB_BYTES} bytes as substantial`, () => {
      const result = scoreDocumentation(
        buildHealthySnapshot({
          files: { readme: present({ sizeBytes: README_STUB_BYTES }) },
        }),
      );
      expect(result.findings.map((f) => f.id)).not.toContain('documentation.readme.stub');
    });

    it(`treats one byte below ${README_STUB_BYTES} as a stub`, () => {
      const result = scoreDocumentation(
        buildHealthySnapshot({
          files: { readme: present({ sizeBytes: README_STUB_BYTES - 1 }) },
        }),
      );
      expect(result.findings.map((f) => f.id)).toContain('documentation.readme.stub');
    });

    it('does not guess when the size is unknown', () => {
      const result = scoreDocumentation(
        buildHealthySnapshot({ files: { readme: present({ sizeBytes: null }) } }),
      );
      expect(result.findings.map((f) => f.id)).not.toContain('documentation.readme.stub');
    });
  });

  it('discloses its own limitations', () => {
    const explanation = scoreDocumentation(buildHealthySnapshot()).explanation;
    expect(explanation.limitations.length).toBeGreaterThan(0);
    expect(explanation.components.length).toBeGreaterThan(0);
    expect(explanation.formula).not.toBe('');
  });
});

describe('scoreRepository', () => {
  it('scores highly with full hygiene', () => {
    const result = scoreRepository(
      buildHealthySnapshot({ community: { defaultBranchProtected: true } }),
    );
    expect(result.score).toBe(100);
  });

  it('excludes unverifiable branch protection rather than scoring it zero', () => {
    // The critical case: reading branch protection needs admin access, so a
    // null must never be read as "not protected".
    const withUnknown = scoreRepository(
      buildHealthySnapshot({ community: { defaultBranchProtected: null } }),
    );
    const withProtection = scoreRepository(
      buildHealthySnapshot({ community: { defaultBranchProtected: true } }),
    );

    expect(withUnknown.score).toBe(withProtection.score);

    const component = withUnknown.explanation.components.find(
      (c) => c.id === 'repository.branchProtection',
    );
    expect(component?.score).toBeNull();
  });

  it('scores an explicitly unprotected branch lower than an unverifiable one', () => {
    const unprotected = scoreRepository(
      buildHealthySnapshot({ community: { defaultBranchProtected: false } }),
    );
    const unknown = scoreRepository(
      buildHealthySnapshot({ community: { defaultBranchProtected: null } }),
    );
    expect(unprotected.score).toBeLessThan(unknown.score ?? 0);
  });

  it('says "unable to verify" in the limitations when protection is unreadable', () => {
    const result = scoreRepository(
      buildHealthySnapshot({ community: { defaultBranchProtected: null } }),
    );
    expect(result.explanation.limitations.join(' ')).toMatch(/unable to verify/i);
  });

  it.each([
    ['npm', 'package-lock.json'],
    ['pnpm', 'pnpm-lock.yaml'],
    ['cargo', 'Cargo.lock'],
    ['poetry', 'poetry.lock'],
  ])('accepts the %s lockfile', (_label, lockfile) => {
    const result = scoreRepository(
      buildHealthySnapshot({ files: { lockfiles: [lockfile] } }),
    );
    expect(result.findings.map((f) => f.id)).not.toContain('repository.lockfile.missing');
  });

  it('reports a missing lockfile', () => {
    const result = scoreRepository(buildHealthySnapshot({ files: { lockfiles: [] } }));
    expect(result.findings.map((f) => f.id)).toContain('repository.lockfile.missing');
  });

  it('keeps the tag component null when the tag count is unreadable', () => {
    const result = scoreRepository(
      buildHealthySnapshot({ activity: { tagCount: null } }),
    );
    const component = result.explanation.components.find(
      (c) => c.id === 'repository.tags',
    );
    expect(component?.score).toBeNull();
  });
});

describe('scoreSecurity', () => {
  it('scores 100 with every observable practice present', () => {
    expect(scoreSecurity(buildHealthySnapshot()).score).toBe(100);
  });

  it('scores 0 with none present', () => {
    expect(scoreSecurity(buildSnapshot()).score).toBe(0);
  });

  it('never claims a repository is secure', () => {
    // The constraint that gives this category its name. A perfect score means
    // four practices were observed, not that the repository is secure.
    const result = scoreSecurity(buildHealthySnapshot());

    const userFacingText = [
      result.label,
      result.explanation.summary,
      ...result.explanation.limitations,
      ...result.explanation.components.flatMap((c) => [c.label, c.observed, c.rule]),
      ...result.findings.flatMap((f) => [f.title, f.explanation, f.recommendation]),
    ].join(' ');

    expect(userFacingText).not.toMatch(/\bis secure\b/i);
    expect(userFacingText).not.toMatch(/\bsecure repository\b/i);
    expect(userFacingText).not.toMatch(/\bno vulnerabilities\b/i);
    expect(result.label).toBe('Security Hygiene');
    expect(result.label).not.toMatch(/security score/i);
  });

  it('states plainly that it measures practices, not posture', () => {
    const limitations =
      scoreSecurity(buildHealthySnapshot()).explanation.limitations.join(' ');
    expect(limitations).toMatch(/practices, not posture/i);
  });

  it.each([
    ['CodeQL', 'github/codeql-action'],
    ['Trivy', 'aquasecurity/trivy-action'],
    ['npm audit', 'npm audit'],
  ])('recognizes %s as scanning', (_label, scanner) => {
    const result = scoreSecurity(
      buildHealthySnapshot({ files: { securityScanningWorkflows: [scanner] } }),
    );
    expect(result.findings.map((f) => f.id)).not.toContain('security.scanning.absent');
  });

  it('reports a missing security policy', () => {
    const result = scoreSecurity(buildHealthySnapshot({ files: { security: ABSENT } }));
    expect(result.findings.map((f) => f.id)).toContain('security.policy.missing');
  });
});

describe('scoreIssues', () => {
  it('returns null when issues are disabled, never zero', () => {
    const result = scoreIssues(buildSnapshot({ issues: null }));
    expect(result.score).toBeNull();
    expect(result.findings[0]?.id).toBe('issues.disabled');
  });

  it('scores a well-tended backlog highly', () => {
    expect(scoreIssues(buildHealthySnapshot()).score).toBeGreaterThan(85);
  });

  describe(`stale boundary at ${STALE_ISSUE_DAYS} days`, () => {
    it(`counts exactly ${STALE_ISSUE_DAYS} days as stale`, () => {
      const result = scoreIssues(
        buildSnapshot({
          issues: {
            openCount: 1,
            openInactiveDays: [STALE_ISSUE_DAYS],
            openAgeDays: [STALE_ISSUE_DAYS],
          },
        }),
      );
      const staleMetric = result.metrics.find((m) => m.id === 'issues.stale.count');
      expect(staleMetric?.value).toBe(1);
    });

    it(`does not count one day below ${STALE_ISSUE_DAYS}`, () => {
      const result = scoreIssues(
        buildSnapshot({
          issues: {
            openCount: 1,
            openInactiveDays: [STALE_ISSUE_DAYS - 1],
            openAgeDays: [STALE_ISSUE_DAYS - 1],
          },
        }),
      );
      const staleMetric = result.metrics.find((m) => m.id === 'issues.stale.count');
      expect(staleMetric?.value).toBe(0);
    });
  });

  it('raises a high-severity finding when most issues are stale', () => {
    const result = scoreIssues(
      buildSnapshot({
        issues: {
          openCount: 10,
          openInactiveDays: Array.from({ length: 10 }, () => 400),
          openAgeDays: Array.from({ length: 10 }, () => 500),
        },
      }),
    );
    const finding = result.findings.find((f) => f.id === 'issues.stale.backlog');
    expect(finding?.severity).toBe('high');
    expect(finding?.evidenceUrl).toContain('github.com/acme/widget/issues');
  });

  it('lowers confidence when the sample was truncated', () => {
    const complete = scoreIssues(buildHealthySnapshot());
    const truncated = scoreIssues(
      buildSnapshot({ issues: { sample: { examined: 300, truncated: true } } }),
    );
    expect(truncated.confidence).not.toBe('high');
    expect(complete.confidence).toBe('high');
  });

  it('marks findings from a truncated sample as medium confidence at best', () => {
    const result = scoreIssues(
      buildSnapshot({
        issues: {
          openCount: 10,
          openInactiveDays: Array.from({ length: 10 }, () => 400),
          openAgeDays: Array.from({ length: 10 }, () => 500),
          sample: { examined: 300, truncated: true },
        },
      }),
    );
    const finding = result.findings.find((f) => f.id === 'issues.stale.backlog');
    expect(finding?.confidence).toBe('medium');
  });

  it('reports a growing backlog', () => {
    const result = scoreIssues(
      buildSnapshot({ issues: { createdLast90Days: 40, closedLast90Days: 5 } }),
    );
    expect(result.findings.map((f) => f.id)).toContain('issues.backlog.growing');
  });

  it('describes observations rather than attributing intent', () => {
    const result = scoreIssues(
      buildSnapshot({
        issues: {
          openCount: 10,
          openInactiveDays: Array.from({ length: 10 }, () => 400),
          openAgeDays: Array.from({ length: 10 }, () => 500),
        },
      }),
    );
    const text = result.findings.map((f) => `${f.title} ${f.explanation}`).join(' ');
    expect(text).not.toMatch(/ignor(e|ing|ed)/i);
    expect(text).not.toMatch(/neglect/i);
    expect(text).not.toMatch(/lazy|careless/i);
  });

  it('notes an empty backlog without penalising it', () => {
    const result = scoreIssues(
      buildSnapshot({
        issues: {
          openCount: 0,
          openAgeDays: [],
          openInactiveDays: [],
          createdLast90Days: 0,
          closedLast90Days: 5,
        },
      }),
    );
    expect(result.findings.map((f) => f.id)).toContain('issues.backlog.empty');
    expect(result.findings.find((f) => f.id === 'issues.backlog.empty')?.severity).toBe(
      'info',
    );
  });
});

describe('scorePullRequests', () => {
  it('returns null when there have never been pull requests', () => {
    const result = scorePullRequests(buildSnapshot({ pullRequests: null }));
    expect(result.score).toBeNull();
    expect(result.findings[0]?.id).toBe('pullRequests.none');
  });

  it('scores a fast-merging project highly', () => {
    expect(scorePullRequests(buildHealthySnapshot()).score).toBeGreaterThan(85);
  });

  it('uses the median so one ancient merge cannot distort the result', () => {
    // The mean of [1,1,2,2,3,1500] is 251 days; the median is 2.
    const result = scorePullRequests(
      buildSnapshot({ pullRequests: { mergedDurationDays: [1, 1, 2, 2, 3, 1500] } }),
    );
    const metric = result.metrics.find((m) => m.id === 'pullRequests.medianMergeDays');
    expect(metric?.value).toBe(2);
  });

  describe(`long-lived boundary at ${LONG_LIVED_PR_DAYS} days`, () => {
    it(`counts exactly ${LONG_LIVED_PR_DAYS} days as long-lived`, () => {
      const result = scorePullRequests(
        buildSnapshot({ pullRequests: { openAgeDays: [LONG_LIVED_PR_DAYS] } }),
      );
      const metric = result.metrics.find((m) => m.id === 'pullRequests.longLived.count');
      expect(metric?.value).toBe(1);
    });

    it(`does not count one day below ${LONG_LIVED_PR_DAYS}`, () => {
      const result = scorePullRequests(
        buildSnapshot({ pullRequests: { openAgeDays: [LONG_LIVED_PR_DAYS - 1] } }),
      );
      const metric = result.metrics.find((m) => m.id === 'pullRequests.longLived.count');
      expect(metric?.value).toBe(0);
    });
  });

  it('labels sampled metrics as approximate', () => {
    const result = scorePullRequests(buildHealthySnapshot());
    const metric = result.metrics.find((m) => m.id === 'pullRequests.medianMergeDays');
    expect(metric?.label).toMatch(/approximate/i);
  });

  it('keeps merge speed null when nothing has been merged', () => {
    const result = scorePullRequests(
      buildSnapshot({
        pullRequests: {
          mergedDurationDays: [],
          recentlyMergedCount: 0,
          recentlyClosedUnmergedCount: 0,
        },
      }),
    );
    const component = result.explanation.components.find(
      (c) => c.id === 'pullRequests.mergeDuration',
    );
    expect(component?.score).toBeNull();
  });

  it('does not attribute intent to closed pull requests', () => {
    const result = scorePullRequests(
      buildSnapshot({
        pullRequests: { recentlyMergedCount: 2, recentlyClosedUnmergedCount: 20 },
      }),
    );
    const finding = result.findings.find((f) => f.id === 'pullRequests.lowMergeRate');
    expect(finding?.explanation).toMatch(
      /not about whether those decisions were correct/i,
    );
  });
});

describe('scoreCi', () => {
  it('scores a passing pipeline highly', () => {
    expect(scoreCi(buildHealthySnapshot()).score).toBeGreaterThan(90);
  });

  it('returns null when CI information could not be read', () => {
    // The most important assertion in this category: unavailable is not failed.
    const result = scoreCi(
      buildSnapshot({
        ci: {
          workflowCount: null,
          recentRunConclusions: [],
          latestCommitStatus: null,
        },
      }),
    );
    expect(result.score).toBeNull();
    expect(result.findings[0]?.id).toBe('ci.unavailable');
  });

  it('scores zero — not null — when CI is genuinely absent', () => {
    // Readable and empty is an observation, so it is scored. This is the
    // distinction between "no CI" and "we could not tell".
    const result = scoreCi(
      buildSnapshot({
        ci: {
          workflowCount: 0,
          recentRunConclusions: [],
          latestCommitStatus: 'none',
        },
      }),
    );
    expect(result.score).toBe(0);
    expect(result.findings.map((f) => f.id)).toContain('ci.notConfigured');
  });

  it('excludes cancelled and skipped runs instead of counting them as failures', () => {
    const allSuccess = scoreCi(
      buildSnapshot({
        ci: { recentRunConclusions: ['success', 'success', 'success', 'success'] },
      }),
    );
    const withNoise = scoreCi(
      buildSnapshot({
        ci: {
          recentRunConclusions: [
            'success',
            'cancelled',
            'success',
            'skipped',
            'success',
            'cancelled',
            'success',
          ],
        },
      }),
    );
    expect(withNoise.score).toBe(allSuccess.score);
  });

  it('reports consecutive failures at the threshold', () => {
    const conclusions = [
      ...Array.from({ length: CONSECUTIVE_FAILURE_THRESHOLD }, () => 'failure' as const),
      'success' as const,
    ];
    const result = scoreCi(buildSnapshot({ ci: { recentRunConclusions: conclusions } }));
    const finding = result.findings.find((f) => f.id === 'ci.consecutiveFailures');
    expect(finding?.severity).toBe('high');
  });

  it('does not report one failure below the threshold', () => {
    const conclusions = [
      ...Array.from(
        { length: CONSECUTIVE_FAILURE_THRESHOLD - 1 },
        () => 'failure' as const,
      ),
      'success' as const,
    ];
    const result = scoreCi(buildSnapshot({ ci: { recentRunConclusions: conclusions } }));
    expect(result.findings.map((f) => f.id)).not.toContain('ci.consecutiveFailures');
  });

  it('treats no commit status as unscorable rather than failing', () => {
    const result = scoreCi(buildSnapshot({ ci: { latestCommitStatus: 'none' } }));
    const component = result.explanation.components.find(
      (c) => c.id === 'ci.latestStatus',
    );
    expect(component?.score).toBeNull();
  });
});

describe('countLeadingFailures', () => {
  it('counts an unbroken run of failures from the newest', () => {
    expect(countLeadingFailures(['failure', 'failure', 'success', 'failure'])).toBe(2);
  });

  it('returns zero when the newest run passed', () => {
    expect(countLeadingFailures(['success', 'failure', 'failure'])).toBe(0);
  });

  it('steps over cancelled and skipped runs without breaking the streak', () => {
    expect(countLeadingFailures(['failure', 'cancelled', 'failure', 'success'])).toBe(2);
  });

  it('handles an empty list', () => {
    expect(countLeadingFailures([])).toBe(0);
  });
});

describe('scoreActivity', () => {
  it('scores an actively developed repository highly', () => {
    expect(scoreActivity(buildHealthySnapshot(), NOW).score).toBeGreaterThan(85);
  });

  it('does not penalise an archived repository for inactivity', () => {
    // Archiving is a deliberate act meaning "finished", not a failure to
    // maintain. Scoring it as neglect would punish responsible shutdown.
    const archived = scoreActivity(
      buildHealthySnapshot({
        activity: { isArchived: true, pushedAt: daysAgo(1200) },
      }),
      NOW,
    );
    const abandoned = scoreActivity(
      buildHealthySnapshot({
        activity: { isArchived: false, pushedAt: daysAgo(1200) },
      }),
      NOW,
    );

    expect(archived.score).toBeGreaterThan(abandoned.score ?? 0);
    expect(archived.findings.map((f) => f.id)).toContain('activity.archived');
    expect(archived.findings.find((f) => f.id === 'activity.archived')?.severity).toBe(
      'info',
    );
  });

  it('excludes unavailable commit statistics rather than scoring them zero', () => {
    const unknown = scoreActivity(
      buildHealthySnapshot({ activity: { weeklyCommits: null } }),
      NOW,
    );
    const component = unknown.explanation.components.find(
      (c) => c.id === 'activity.commitCadence',
    );

    expect(component?.score).toBeNull();
    expect(unknown.explanation.limitations.join(' ')).toMatch(
      /not.*computing commit statistics|had not finished computing/i,
    );
  });

  it('does not let unavailable statistics lower the score below a known-good one', () => {
    const withStats = scoreActivity(buildHealthySnapshot(), NOW);
    const withoutStats = scoreActivity(
      buildHealthySnapshot({ activity: { weeklyCommits: null } }),
      NOW,
    );
    expect(withoutStats.score).toBeGreaterThanOrEqual(withStats.score ?? 0);
  });

  it('reports a repository with no push in over a year', () => {
    const result = scoreActivity(
      buildHealthySnapshot({ activity: { pushedAt: daysAgo(400) } }),
      NOW,
    );
    const finding = result.findings.find((f) => f.id === 'activity.inactive');
    expect(finding?.severity).toBe('high');
  });

  it('reports slowing activity between six months and a year', () => {
    const result = scoreActivity(
      buildHealthySnapshot({ activity: { pushedAt: daysAgo(200) } }),
      NOW,
    );
    expect(result.findings.map((f) => f.id)).toContain('activity.slowing');
    expect(result.findings.map((f) => f.id)).not.toContain('activity.inactive');
  });

  it('reports having no releases', () => {
    const result = scoreActivity(
      buildHealthySnapshot({ activity: { releases: [], tagCount: 0 } }),
      NOW,
    );
    expect(result.findings.map((f) => f.id)).toContain('activity.releases.none');
  });

  it('keeps contributor count null when GitHub declines to enumerate them', () => {
    const result = scoreActivity(
      buildHealthySnapshot({ activity: { contributorCount: null } }),
      NOW,
    );
    const metric = result.metrics.find((m) => m.id === 'activity.contributors.count');
    expect(metric?.value).toBeNull();
    expect(metric?.unknownReason).toBe('not_retrieved');
  });
});

describe('releaseCadenceScore', () => {
  const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  it('returns null below three releases, where there is no variation to measure', () => {
    expect(releaseCadenceScore([])).toBeNull();
    expect(releaseCadenceScore([at(10)])).toBeNull();
    expect(releaseCadenceScore([at(10), at(40)])).toBeNull();
  });

  it('scores perfectly regular intervals at 100', () => {
    expect(releaseCadenceScore([at(90), at(60), at(30)])).toBe(100);
  });

  it('scores irregular intervals lower than regular ones', () => {
    const regular = releaseCadenceScore([at(90), at(60), at(30)]);
    const irregular = releaseCadenceScore([at(900), at(880), at(30)]);
    expect(irregular).toBeLessThan(regular ?? 0);
  });

  it('rates a slow but predictable cadence as well as a fast one', () => {
    // The point of using a coefficient of variation: consistency is measured
    // independently of frequency.
    const slow = releaseCadenceScore([at(1080), at(720), at(360)]);
    const fast = releaseCadenceScore([at(21), at(14), at(7)]);
    expect(slow).toBe(fast);
  });

  it('is not affected by the order dates are supplied in', () => {
    expect(releaseCadenceScore([at(30), at(90), at(60)])).toBe(
      releaseCadenceScore([at(90), at(60), at(30)]),
    );
  });
});

describe('purity', () => {
  it('produces identical results for identical inputs', () => {
    const snapshot = buildHealthySnapshot();
    expect(JSON.stringify(scoreActivity(snapshot, NOW))).toBe(
      JSON.stringify(scoreActivity(snapshot, NOW)),
    );
    expect(JSON.stringify(scoreIssues(snapshot))).toBe(
      JSON.stringify(scoreIssues(snapshot)),
    );
  });

  it('does not mutate the snapshot it is given', () => {
    const snapshot = buildHealthySnapshot();
    const before = JSON.stringify(snapshot);

    scoreActivity(snapshot, NOW);
    scoreIssues(snapshot);
    scorePullRequests(snapshot);
    scoreCi(snapshot);
    scoreDocumentation(snapshot);
    scoreRepository(snapshot);
    scoreSecurity(snapshot);

    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe('every category', () => {
  const snapshot = buildHealthySnapshot();
  const results = [
    scoreActivity(snapshot, NOW),
    scorePullRequests(snapshot),
    scoreIssues(snapshot),
    scoreCi(snapshot),
    scoreDocumentation(snapshot),
    scoreRepository(snapshot),
    scoreSecurity(snapshot),
  ];

  it.each(results.map((r) => [r.key, r]))(
    '%s discloses a full explanation',
    (_key, result) => {
      expect(result.explanation.summary).not.toBe('');
      expect(result.explanation.formula).not.toBe('');
      expect(result.explanation.limitations.length).toBeGreaterThan(0);
    },
  );

  it.each(results.map((r) => [r.key, r]))(
    '%s keeps its score within 0–100',
    (_key, result) => {
      if (result.score !== null) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }
    },
  );

  it.each(results.map((r) => [r.key, r]))(
    '%s gives every metric a stable id',
    (_key, result) => {
      for (const m of result.metrics) {
        expect(m.id).toMatch(/^[a-z][a-zA-Z]*(\.[a-zA-Z0-9]+)+$/);
      }
    },
  );

  it('gives every finding an id, recommendation, and confidence', () => {
    const bare = buildSnapshot({ issues: null, pullRequests: null });
    const all = [
      scoreActivity(bare, NOW),
      scorePullRequests(bare),
      scoreIssues(bare),
      scoreCi(bare),
      scoreDocumentation(bare),
      scoreRepository(bare),
      scoreSecurity(bare),
    ].flatMap((r) => r.findings);

    expect(all.length).toBeGreaterThan(0);
    for (const finding of all) {
      expect(finding.id).toMatch(/^[a-zA-Z]+(\.[a-zA-Z0-9]+)+$/);
      expect(finding.recommendation).not.toBe('');
      expect(finding.explanation).not.toBe('');
      expect(['low', 'medium', 'high']).toContain(finding.confidence);
    }
  });

  it('keeps finding ids unique within a single analysis', () => {
    const ids = results.flatMap((r) => r.findings).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('allFilesPresent helper', () => {
  it('describes a fully documented repository', () => {
    const files = allFilesPresent();
    expect(files.readme.present).toBe(true);
    expect(files.lockfiles.length).toBeGreaterThan(0);
  });
});
