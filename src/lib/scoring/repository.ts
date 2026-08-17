import type { CategoryScore, Finding, Metric } from '@/types/analysis';
import type { RepositorySnapshot } from '@/types/snapshot';

import {
  combine,
  component,
  describeFormula,
  deriveConfidence,
  metric,
} from './primitives';
import { CATEGORY_LABELS } from './weights';

/**
 * Repository hygiene scoring.
 *
 * The interesting case in this category is branch protection, which requires
 * elevated permissions on most repositories. RepoSignal cannot read it, and
 * reporting "unknown" as "not protected" would penalize a repository for a
 * permission RepoSignal does not have. So the component scores `null`, its
 * weight is redistributed, and the UI says "unable to verify from public
 * GitHub data" — which is the honest statement.
 */

/** A repository with at least this many topics is discoverable. */
export const TOPIC_TARGET = 3;

export function scoreRepository(snapshot: RepositorySnapshot): CategoryScore {
  const { files, community, activity, identity } = snapshot;
  const repoUrl = identity.htmlUrl;

  const hasLockfile = files.lockfiles.length > 0;
  const hasTags = activity.tagCount !== null ? activity.tagCount > 0 : null;

  const components = [
    component(
      'repository.gitignore',
      '.gitignore',
      files.gitignore.present ? 100 : 0,
      15,
      files.gitignore.present ? 'Present' : 'Absent',
      'Present scores 100, absent scores 0.',
    ),
    component(
      'repository.lockfile',
      'Dependency lockfile',
      hasLockfile ? 100 : 0,
      20,
      hasLockfile ? `Present: ${files.lockfiles.join(', ')}` : 'None detected',
      'Any recognized lockfile scores 100, none scores 0. A lockfile makes builds reproducible.',
    ),
    component(
      'repository.dependencyAutomation',
      'Dependency update automation',
      files.dependencyAutomation.present ? 100 : 0,
      15,
      files.dependencyAutomation.present
        ? `Configured at ${files.dependencyAutomation.path}`
        : 'Not configured',
      'Dependabot or Renovate configuration scores 100, absent scores 0.',
    ),
    component(
      'repository.codeowners',
      'CODEOWNERS',
      files.codeowners.present ? 100 : 0,
      10,
      files.codeowners.present ? 'Present' : 'Absent',
      'Present scores 100, absent scores 0.',
    ),
    component(
      'repository.tags',
      'Release tags',
      hasTags === null ? null : hasTags ? 100 : 0,
      15,
      activity.tagCount === null
        ? 'Could not be read'
        : `${activity.tagCount} tag${activity.tagCount === 1 ? '' : 's'}`,
      'At least one tag scores 100, none scores 0. Unreadable scores null and its weight is redistributed.',
    ),
    component(
      'repository.metadata',
      'Description and topics',
      metadataScore(community.hasDescription, community.topicCount),
      15,
      `${community.hasDescription ? 'Description set' : 'No description'}, ${community.topicCount} topic${community.topicCount === 1 ? '' : 's'}`,
      `A description scores 50, ${TOPIC_TARGET} or more topics scores the other 50.`,
    ),
    component(
      'repository.branchProtection',
      'Default branch protection',
      // null, deliberately: see the module comment.
      community.defaultBranchProtected === null
        ? null
        : community.defaultBranchProtected
          ? 100
          : 0,
      10,
      community.defaultBranchProtected === null
        ? 'Unable to verify from public GitHub data'
        : community.defaultBranchProtected
          ? 'Protected'
          : 'Not protected',
      'Protected scores 100, unprotected scores 0. Requires elevated permissions to read; when unreadable it scores null and its weight is redistributed.',
    ),
  ];

  const { score, scoredWeight, totalWeight } = combine(components);
  const findings: Finding[] = [];

  if (!hasLockfile) {
    findings.push({
      id: 'repository.lockfile.missing',
      category: 'repository',
      severity: 'medium',
      title: 'No dependency lockfile',
      explanation:
        'No lockfile was found at the repository root. Without one, two installs of the same commit can resolve different dependency versions, so a build that works today may not tomorrow.',
      metric: { lockfilesFound: 0 },
      recommendation:
        'Commit the lockfile your package manager generates rather than ignoring it.',
      confidence: 'medium',
      evidenceUrl: repoUrl,
    });
  }

  if (!files.dependencyAutomation.present) {
    findings.push({
      id: 'repository.dependencyAutomation.missing',
      category: 'repository',
      severity: 'low',
      title: 'No automated dependency updates',
      explanation:
        'Neither a Dependabot nor a Renovate configuration was found. Dependency updates, including security patches, have to be noticed and applied by hand.',
      metric: { dependencyAutomation: 'false' },
      recommendation:
        'Add .github/dependabot.yml, or a Renovate configuration, to receive update pull requests automatically.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  if (activity.tagCount === 0) {
    findings.push({
      id: 'repository.tags.none',
      category: 'repository',
      severity: 'low',
      title: 'No release tags',
      explanation:
        'The repository has no tags. Consumers have no way to pin a specific version, and there is no record of what changed between points in time.',
      metric: { tagCount: 0 },
      recommendation: 'Tag releases, following semantic versioning where it applies.',
      confidence: 'high',
      evidenceUrl: `${repoUrl}/tags`,
    });
  }

  if (!community.hasDescription) {
    findings.push({
      id: 'repository.description.missing',
      category: 'repository',
      severity: 'info',
      title: 'No repository description',
      explanation:
        'The repository has no description, so anyone finding it through search or a listing has only the name to go on.',
      metric: { hasDescription: 'false' },
      recommendation: 'Add a one-line description in the repository settings.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  const metrics: Metric[] = [
    metric(
      'repository.gitignore.present',
      '.gitignore present',
      String(files.gitignore.present),
    ),
    metric('repository.lockfiles.count', 'Lockfiles found', files.lockfiles.length),
    metric(
      'repository.lockfiles.names',
      'Lockfiles',
      files.lockfiles.length > 0 ? files.lockfiles.join(', ') : null,
      { unknownReason: 'not_applicable' },
    ),
    metric(
      'repository.dependencyAutomation.present',
      'Dependency automation configured',
      String(files.dependencyAutomation.present),
    ),
    metric(
      'repository.codeowners.present',
      'CODEOWNERS present',
      String(files.codeowners.present),
    ),
    metric('repository.tags.count', 'Release tags', activity.tagCount, {
      unknownReason: 'not_retrieved',
    }),
    metric('repository.topics.count', 'Topics', community.topicCount),
    metric(
      'repository.branchProtection',
      'Default branch protected',
      community.defaultBranchProtected === null
        ? null
        : String(community.defaultBranchProtected),
      { unknownReason: 'requires_elevated_permissions' },
    ),
  ];

  const limitations = [
    'File presence is checked at the repository root and in .github only.',
    'Lockfile detection covers common ecosystems by filename; an unrecognized package manager will read as having none.',
  ];

  if (community.defaultBranchProtected === null) {
    limitations.push(
      'Branch protection: unable to verify from public GitHub data. Reading it requires administrative access to the repository, so it was excluded from the score rather than assumed absent.',
    );
  }

  return {
    key: 'repository',
    label: CATEGORY_LABELS.repository,
    score,
    confidence: deriveConfidence({ scoredWeight, totalWeight }),
    metrics,
    findings,
    explanation: {
      summary:
        'Measures the repository-level practices that make a project reproducible, maintainable, and discoverable.',
      formula: describeFormula(components),
      components,
      limitations,
    },
  };
}

function metadataScore(hasDescription: boolean, topicCount: number): number {
  return (hasDescription ? 50 : 0) + (topicCount >= TOPIC_TARGET ? 50 : 0);
}
