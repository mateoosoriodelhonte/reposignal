import type { CategoryScore, Finding } from '@/types/analysis';
import type { FilePresence, RepositorySnapshot } from '@/types/snapshot';

import {
  combine,
  component,
  describeFormula,
  deriveConfidence,
  metric,
} from './primitives';
import { CATEGORY_LABELS } from './weights';

/**
 * Documentation scoring.
 *
 * Deliberately presence-based. RepoSignal does not judge the quality of prose —
 * that would require reading and interpreting content, which is neither
 * deterministic nor defensible. The one nuance is size: a 40-byte README that
 * says only the project name is different from a substantial one, and file
 * size distinguishes those without reading either.
 */

/**
 * Below this, a README is a placeholder rather than documentation.
 *
 * 300 bytes is roughly a title, a one-line description, and an install
 * command — enough to identify a project, not enough to explain it.
 */
export const README_STUB_BYTES = 300;

/** A CONTRIBUTING file below this is a stub for the same reason. */
export const CONTRIBUTING_STUB_BYTES = 200;

function presenceScore(file: FilePresence): number {
  return file.present ? 100 : 0;
}

/** Scores a file by presence, then by whether it is substantial. */
function substanceScore(file: FilePresence, stubBytes: number): number {
  if (!file.present) return 0;
  if (file.sizeBytes === null) return 80; // present, size unknown
  return file.sizeBytes >= stubBytes ? 100 : 50;
}

function describePresence(file: FilePresence, stubBytes?: number): string {
  if (!file.present) return 'Absent';
  if (file.sizeBytes === null) return `Present at ${file.path}`;
  const stub =
    stubBytes !== undefined && file.sizeBytes < stubBytes ? ', likely a stub' : '';
  return `Present at ${file.path} (${file.sizeBytes} bytes${stub})`;
}

export function scoreDocumentation(snapshot: RepositorySnapshot): CategoryScore {
  const files = snapshot.files;
  const repoUrl = snapshot.identity.htmlUrl;

  const components = [
    component(
      'documentation.readme',
      'README',
      substanceScore(files.readme, README_STUB_BYTES),
      30,
      describePresence(files.readme, README_STUB_BYTES),
      `Present and ≥ ${README_STUB_BYTES} bytes scores 100; present but smaller scores 50; absent scores 0.`,
    ),
    component(
      'documentation.license',
      'LICENSE',
      presenceScore(files.license),
      20,
      describePresence(files.license),
      'Present scores 100, absent scores 0. Without one, the code is not legally reusable.',
    ),
    component(
      'documentation.contributing',
      'CONTRIBUTING',
      substanceScore(files.contributing, CONTRIBUTING_STUB_BYTES),
      15,
      describePresence(files.contributing, CONTRIBUTING_STUB_BYTES),
      `Present and ≥ ${CONTRIBUTING_STUB_BYTES} bytes scores 100; present but smaller scores 50; absent scores 0.`,
    ),
    component(
      'documentation.codeOfConduct',
      'Code of conduct',
      presenceScore(files.codeOfConduct),
      10,
      describePresence(files.codeOfConduct),
      'Present scores 100, absent scores 0.',
    ),
    component(
      'documentation.issueTemplates',
      'Issue templates',
      presenceScore(files.issueTemplates),
      10,
      describePresence(files.issueTemplates),
      'Present scores 100, absent scores 0.',
    ),
    component(
      'documentation.pullRequestTemplate',
      'Pull request template',
      presenceScore(files.pullRequestTemplate),
      5,
      describePresence(files.pullRequestTemplate),
      'Present scores 100, absent scores 0.',
    ),
    component(
      'documentation.docsDirectory',
      'Documentation directory',
      presenceScore(files.docsDirectory),
      10,
      describePresence(files.docsDirectory),
      'Present scores 100, absent scores 0. Extended documentation beyond the README.',
    ),
  ];

  const { score, scoredWeight, totalWeight } = combine(components);
  const findings: Finding[] = [];

  if (!files.readme.present) {
    findings.push({
      id: 'documentation.readme.missing',
      category: 'documentation',
      severity: 'high',
      title: 'No README',
      explanation:
        'The repository has no README at its root or in .github. A README is the first thing a visitor reads, and without one a project cannot explain what it does or how to use it.',
      metric: { readmePresent: 'false' },
      recommendation:
        'Add a README covering what the project does, who it is for, and how to install and run it.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  } else if (
    files.readme.sizeBytes !== null &&
    files.readme.sizeBytes < README_STUB_BYTES
  ) {
    findings.push({
      id: 'documentation.readme.stub',
      category: 'documentation',
      severity: 'medium',
      title: 'README is very short',
      explanation: `The README is ${files.readme.sizeBytes} bytes, below the ${README_STUB_BYTES}-byte threshold RepoSignal uses to distinguish a placeholder from documentation. This measures length only, not quality.`,
      metric: {
        readmeBytes: files.readme.sizeBytes,
        thresholdBytes: README_STUB_BYTES,
      },
      recommendation:
        'Expand the README to cover purpose, installation, and basic usage.',
      confidence: 'high',
      ...(files.readme.htmlUrl === null ? {} : { evidenceUrl: files.readme.htmlUrl }),
    });
  }

  if (!files.license.present) {
    findings.push({
      id: 'documentation.license.missing',
      category: 'documentation',
      severity: 'high',
      title: 'No LICENSE file',
      explanation:
        'No license file was found. Without an explicit license, default copyright applies and others have no legal right to use, modify, or distribute the code — regardless of it being publicly visible.',
      metric: { licensePresent: 'false' },
      recommendation:
        'Add a LICENSE file. https://choosealicense.com walks through the options.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  if (!files.contributing.present) {
    findings.push({
      id: 'documentation.contributing.missing',
      category: 'documentation',
      severity: 'low',
      title: 'No contributing guide',
      explanation:
        'No CONTRIBUTING file was found. Contributors have to infer the workflow, branch conventions, and testing expectations from the commit history.',
      metric: { contributingPresent: 'false' },
      recommendation:
        'Add CONTRIBUTING.md describing how to set up the project, run tests, and open a pull request.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  if (!files.issueTemplates.present && !files.pullRequestTemplate.present) {
    findings.push({
      id: 'documentation.templates.missing',
      category: 'documentation',
      severity: 'low',
      title: 'No issue or pull request templates',
      explanation:
        'Neither issue templates nor a pull request template were found in .github. Templates make reports and contributions arrive with the context needed to act on them.',
      metric: { issueTemplates: 'false', pullRequestTemplate: 'false' },
      recommendation:
        'Add templates under .github/ISSUE_TEMPLATE and .github/pull_request_template.md.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  return {
    key: 'documentation',
    label: CATEGORY_LABELS.documentation,
    score,
    confidence: deriveConfidence({ scoredWeight, totalWeight }),
    metrics: [
      metric(
        'documentation.readme.present',
        'README present',
        String(files.readme.present),
      ),
      metric('documentation.readme.bytes', 'README size', files.readme.sizeBytes, {
        unit: 'bytes',
        unknownReason: 'not_retrieved',
      }),
      metric(
        'documentation.license.present',
        'LICENSE present',
        String(files.license.present),
      ),
      metric(
        'documentation.contributing.present',
        'CONTRIBUTING present',
        String(files.contributing.present),
      ),
      metric(
        'documentation.codeOfConduct.present',
        'Code of conduct present',
        String(files.codeOfConduct.present),
      ),
      metric(
        'documentation.issueTemplates.present',
        'Issue templates present',
        String(files.issueTemplates.present),
      ),
      metric(
        'documentation.pullRequestTemplate.present',
        'Pull request template present',
        String(files.pullRequestTemplate.present),
      ),
      metric(
        'documentation.docsDirectory.present',
        'Documentation directory present',
        String(files.docsDirectory.present),
      ),
    ],
    findings,
    explanation: {
      summary:
        'Measures whether the files a newcomer needs are present, and whether the README and contributing guide are substantial enough to be useful.',
      formula: describeFormula(components),
      components,
      limitations: [
        'Presence and size only. RepoSignal does not read documentation content, so it cannot tell a thorough README from a long but unhelpful one.',
        'Only the repository root and .github are examined. Documentation kept elsewhere, or in an external site not linked from a docs directory, is not detected.',
        'Files are matched by conventional name. A README under an unconventional filename will be reported as absent.',
      ],
    },
  };
}
