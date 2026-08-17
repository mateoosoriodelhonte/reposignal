/**
 * Analyze a repository from the command line.
 *
 *   npm run analyze -- facebook/react
 *
 * Runs the real pipeline — collect, normalize, score — and prints the result.
 * Useful for checking behaviour against the live API without the UI in the
 * way, and for capturing fixtures.
 *
 * Requires GITHUB_TOKEN in the environment (or .env.local, which Next loads in
 * development but this script does not — export it, or use `gh auth token`).
 */
import { GitHubClient } from '../src/lib/github/client';
import { collectSnapshot } from '../src/lib/github/collector';
import { RequestBudget } from '../src/lib/github/request-budget';
import { analyzeSnapshot } from '../src/lib/scoring';
import { parseRepositoryReference } from '../src/lib/validation/repository-reference';

const input = process.argv[2];

if (input === undefined) {
  console.error('Usage: npm run analyze -- <owner/repository>');
  process.exit(1);
}

const parsed = parseRepositoryReference(input);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

const startedAt = performance.now();
const client = new GitHubClient({ budget: new RequestBudget(60) });

try {
  const now = new Date();
  const snapshot = await collectSnapshot(client, parsed.value, now);
  const result = analyzeSnapshot(snapshot, { now, analysisId: 'cli' });
  const elapsedMs = Math.round(performance.now() - startedAt);

  console.log(`\n${result.repository.fullName}`);
  console.log(
    `Engineering health: ${result.overall.score ?? 'Insufficient data'}${
      result.overall.score === null ? '' : ' / 100'
    } (${result.overall.confidence} confidence)\n`,
  );

  for (const category of result.categories) {
    const score = category.score === null ? 'Insufficient data' : String(category.score);
    console.log(`  ${category.label.padEnd(22)} ${score.padStart(18)}`);
  }

  const bySeverity = result.findings.filter(
    (finding) => finding.severity === 'high' || finding.severity === 'medium',
  );

  if (bySeverity.length > 0) {
    console.log('\nHighest-priority findings:');
    for (const finding of bySeverity) {
      console.log(`  [${finding.severity}] ${finding.title}`);
    }
  }

  if (result.limitations.length > 0) {
    console.log('\nLimitations:');
    for (const limitation of result.limitations) {
      console.log(`  - ${limitation}`);
    }
  }

  console.log(
    `\n${snapshot.collection.requestsMade} GitHub requests in ${elapsedMs}ms · ` +
      `rate limit remaining: ${snapshot.collection.rateLimitRemaining ?? 'unknown'} · ` +
      `scoring version ${result.scoringVersion}\n`,
  );
} catch (error) {
  const kind =
    error !== null && typeof error === 'object' && 'kind' in error
      ? String((error as { kind: unknown }).kind)
      : 'unexpected';
  console.error(`Analysis failed (${kind}).`);
  process.exit(1);
}
