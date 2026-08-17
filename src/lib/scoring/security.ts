import type { CategoryScore, Finding } from '@/types/analysis';
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
 * Security hygiene scoring.
 *
 * The name is the point. This category observes **practices**, not posture.
 * RepoSignal does not scan for vulnerabilities, look for secrets, resolve
 * dependency CVEs, or read code. A repository scoring 100 here has adopted
 * four visible practices; it has not been assessed as secure, and nothing in
 * this module may claim otherwise.
 *
 * That constraint is enforced by a test asserting no user-facing string here
 * says a repository is secure.
 */

export function scoreSecurity(snapshot: RepositorySnapshot): CategoryScore {
  const { files, identity } = snapshot;
  const repoUrl = identity.htmlUrl;

  const hasLockfile = files.lockfiles.length > 0;
  const scanners = files.securityScanningWorkflows;
  const hasScanning = scanners.length > 0;

  const components = [
    component(
      'security.policy',
      'Security policy',
      files.security.present ? 100 : 0,
      30,
      files.security.present ? `Present at ${files.security.path}` : 'Absent',
      'A SECURITY.md scores 100, absent scores 0. It tells a reporter where to send a vulnerability privately.',
    ),
    component(
      'security.dependencyAutomation',
      'Dependency update automation',
      files.dependencyAutomation.present ? 100 : 0,
      25,
      files.dependencyAutomation.present
        ? `Configured at ${files.dependencyAutomation.path}`
        : 'Not configured',
      'Dependabot or Renovate configuration scores 100, absent scores 0.',
    ),
    component(
      'security.scanning',
      'Security scanning in CI',
      hasScanning ? 100 : 0,
      25,
      hasScanning ? `Detected: ${scanners.join(', ')}` : 'None detected',
      'A recognized scanning step in a workflow file scores 100, none scores 0.',
    ),
    component(
      'security.lockfile',
      'Committed lockfile',
      hasLockfile ? 100 : 0,
      20,
      hasLockfile ? `Present: ${files.lockfiles.join(', ')}` : 'None detected',
      'Any recognized lockfile scores 100, none scores 0. Pinned dependencies make what is installed auditable.',
    ),
  ];

  const { score, scoredWeight, totalWeight } = combine(components);
  const findings: Finding[] = [];

  if (!files.security.present) {
    findings.push({
      id: 'security.policy.missing',
      category: 'security',
      severity: 'medium',
      title: 'No security policy',
      explanation:
        'No SECURITY.md was found. Someone who discovers a vulnerability has no documented private channel, which makes public disclosure in an issue the path of least resistance.',
      metric: { securityPolicyPresent: 'false' },
      recommendation:
        'Add SECURITY.md describing how to report a vulnerability privately and what response to expect.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  if (!hasScanning) {
    findings.push({
      id: 'security.scanning.absent',
      category: 'security',
      severity: 'low',
      title: 'No security scanning detected in CI',
      explanation:
        'No recognized security scanning step was found in the repository workflow files RepoSignal examined. This reflects what is declared in those files, not whether scanning happens by some other means.',
      metric: { scannersDetected: 0 },
      recommendation:
        'Consider adding a scanning step such as CodeQL or a dependency review action to CI.',
      confidence: 'medium',
      evidenceUrl: `${repoUrl}/actions`,
    });
  }

  if (!files.dependencyAutomation.present) {
    findings.push({
      id: 'security.dependencyAutomation.missing',
      category: 'security',
      severity: 'medium',
      title: 'Dependency updates are not automated',
      explanation:
        'Neither a Dependabot nor a Renovate configuration was found. Security patches in dependencies have to be noticed and applied manually, which typically means later.',
      metric: { dependencyAutomation: 'false' },
      recommendation:
        'Add .github/dependabot.yml, or a Renovate configuration, to receive dependency update pull requests automatically.',
      confidence: 'high',
      evidenceUrl: repoUrl,
    });
  }

  return {
    key: 'security',
    label: CATEGORY_LABELS.security,
    score,
    confidence: deriveConfidence({ scoredWeight, totalWeight }),
    metrics: [
      metric(
        'security.policy.present',
        'SECURITY.md present',
        String(files.security.present),
      ),
      metric(
        'security.dependencyAutomation.present',
        'Dependency automation configured',
        String(files.dependencyAutomation.present),
      ),
      metric('security.scanning.count', 'Scanning tools detected', scanners.length),
      metric(
        'security.scanning.tools',
        'Scanning tools',
        scanners.length > 0 ? scanners.join(', ') : null,
        { unknownReason: 'not_applicable' },
      ),
      metric('security.lockfile.present', 'Lockfile committed', String(hasLockfile)),
    ],
    findings,
    explanation: {
      summary:
        'Measures observable security practices: a documented reporting channel, automated dependency updates, scanning declared in CI, and a committed lockfile.',
      formula: describeFormula(components),
      components,
      limitations: [
        'This category measures practices, not posture. A high score means these practices were observed — it does not mean the repository is free of vulnerabilities, and RepoSignal makes no such claim.',
        'No scanning is performed. RepoSignal does not analyze code, resolve dependency versions against advisory databases, or look for secrets.',
        'Scanning detection is text matching against a bounded sample of workflow files. Scanning configured elsewhere, or in a workflow beyond the sample, is not detected.',
        'GitHub features such as private vulnerability reporting and secret scanning alerts are not readable from public data and are not assessed.',
      ],
    },
  };
}
