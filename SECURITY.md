# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/mateoosoriodelhonte/reposignal/security/advisories/new)
rather than opening a public issue.

Include the affected version or commit, reproduction steps, and the impact you
believe it has. You can expect an initial response within seven days.

Please do not run automated scanners against any deployed instance.

## Security model

RepoSignal reads public GitHub data and renders a report. Understanding what it
does _not_ do is most of the security model.

### It never executes analyzed code

RepoSignal does not clone repositories, download archives, install
dependencies, or execute anything from an analyzed repository. It reads metadata
and file listings through the GitHub REST API. Where file contents are read —
workflow files, to detect security scanning steps — they are parsed as text and
never evaluated.

### Only GitHub is ever contacted

User input is parsed into a validated `owner/repository` pair before any
request. Request URLs are constructed from those validated components against a
hardcoded `api.github.com` base. A URL supplied by a user is never fetched, and
a redirect to a non-GitHub host is not followed. This is the SSRF boundary and
it is covered by tests.

### Credentials stay on the server

The GitHub token is read from the server environment, is never exposed to the
client bundle, and is never written to logs. It requires no scopes: RepoSignal
reads only public data, and an unscoped token exists solely to raise the rate
limit.

### Repository content is untrusted input

Repository descriptions, titles, topics, and file paths are attacker-controlled
for any repository a user chooses to analyze. They are rendered as text through
React's default escaping. `dangerouslySetInnerHTML` is not used anywhere in this
codebase. External links carry `rel="noopener noreferrer"`.

### Other measures

- Security headers, including a Content Security Policy, are set in
  `next.config.ts`
- Analysis endpoints are rate limited per client
- Database access goes through Prisma's parameterized queries
- Errors are mapped to safe messages; stack traces are never returned in a
  response
- Dependencies are monitored by Dependabot and `npm audit` runs in CI

## Supported versions

While the project is pre-1.0, only the latest release receives security fixes.
