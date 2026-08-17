// Shared setup for Node-environment tests (scoring, normalization, client).
//
// Tests must never reach the real network. The GitHub client reads its token
// from the environment, so a clearly-fake value is injected here to guarantee
// no real credential is ever exercised by the suite.
process.env.GITHUB_TOKEN ??= 'test-token-not-a-real-credential';
