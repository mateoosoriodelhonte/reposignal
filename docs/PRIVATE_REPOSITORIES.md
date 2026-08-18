# Analyzing private repositories

RepoSignal can analyze private repositories through a **GitHub App**. This
page explains the security model and the one-time setup.

Sign-in is entirely optional. With no App configured, RepoSignal runs as a
public-only analyzer and never shows a sign-in link.

## Why a GitHub App and not "Sign in with GitHub"

A classic OAuth App would need the `repo` scope. That scope grants **read and
write** access to every repository the user can reach — including ones they
never intended to analyze, and including the ability to push.

RepoSignal needs to _read metadata_ on repositories the user explicitly
chooses. Asking for write access to someone's entire account in order to render
a read-only report would contradict everything else this project does about
least privilege.

A GitHub App gives:

|                          | OAuth App (`repo`) | GitHub App                  |
| ------------------------ | ------------------ | --------------------------- |
| Repositories reachable   | All of them        | Only those the user selects |
| Write access             | Yes                | No                          |
| Revocable per repository | No                 | Yes                         |
| Credential lifetime      | Until revoked      | One hour                    |

## What RepoSignal can and cannot do with your grant

**Can:** read repository metadata, contents listings, issues, pull requests,
Actions runs, and commit statuses — for the repositories you selected.

**Cannot:** write anything, read a repository you did not select, clone or
execute your code, or keep working after you revoke the installation.

## How credentials are handled

- **The session cookie contains no GitHub token.** It holds an installation id,
  a display name, and an expiry, encrypted with AES-256-GCM. A stolen cookie is
  not a stolen credential.
- **Installation tokens are minted per use** from the App private key, live in
  memory, expire in an hour, and are never written to the database or a log.
- **Authorization is checked against GitHub, not the session.** Before every
  private analysis, RepoSignal asks GitHub which repositories the installation
  grants. Typing the path of a repository you did not grant produces the same
  not-found result a stranger gets.
- **Private analyses are never cached.** The shared analysis cache is keyed on
  repository identity alone, so a cached private result would be readable by
  anyone who named the repository. Private analyses skip the cache in both
  directions, which is asserted by test.
- **`state` is verified in constant time** on the callback, so a sign-in
  someone else initiated cannot bind your browser to their installation.

## Setup

This is a one-time operator task. It cannot be automated — GitHub Apps must be
created through the web UI.

### 1. Create the App

Go to [github.com/settings/apps/new](https://github.com/settings/apps/new).

- **Name:** anything, for example `RepoSignal (yourname)`
- **Homepage URL:** your deployment, e.g. `https://reposignal-lovat.vercel.app`
- **Callback URL:** `https://your-deployment/auth/callback`
- **Request user authorization (OAuth) during installation:** ✅ enabled
- **Webhook:** ❌ uncheck "Active" — RepoSignal does not use webhooks

### 2. Set permissions

Under **Repository permissions**, grant **read-only** on:

| Permission      | Why                                                                                 |
| --------------- | ----------------------------------------------------------------------------------- |
| Metadata        | Repository details, topics, description (mandatory)                                 |
| Contents        | Detect README, LICENSE, lockfiles, workflow files                                   |
| Issues          | Issue Health                                                                        |
| Pull requests   | Pull Request Health                                                                 |
| Actions         | CI Health                                                                           |
| Commit statuses | CI Health                                                                           |
| Administration  | _Optional._ Only for branch protection, which is otherwise reported as unverifiable |

Leave every other permission at **No access**. Grant nothing under
**Account permissions**.

### 3. Generate a private key

On the App's settings page, click **Generate a private key**. A `.pem` file
downloads. Treat it like a password — anyone holding it can act as your App.

### 4. Configure RepoSignal

```bash
GITHUB_APP_ID=123456
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
SESSION_SECRET=...
```

Newlines in the key may be written literally as `\n` — environment variables
handle multi-line values badly, so RepoSignal restores them.

Generate the session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**All five or none.** A partial configuration is rejected at startup rather
than silently half-enabling sign-in.

On Vercel:

```bash
vercel env add GITHUB_APP_ID production
vercel env add GITHUB_APP_CLIENT_ID production
vercel env add GITHUB_APP_CLIENT_SECRET production
vercel env add GITHUB_APP_PRIVATE_KEY production
vercel env add SESSION_SECRET production
vercel deploy --prod
```

### 5. Install it

Visit your deployment and click **Analyze private repositories**. GitHub asks
which repositories to grant. Pick them, and you are returned to a list of what
RepoSignal can see.

## Revoking access

From [github.com/settings/installations](https://github.com/settings/installations),
either remove individual repositories or uninstall the App entirely. This takes
effect on the next analysis, because authorization is re-checked against GitHub
rather than trusted from the session.

Signing out of RepoSignal clears the session cookie only; it does not uninstall
the App. The UI says so.

## Verification status

The implementation is covered by unit and integration tests: JWT signing is
verified cryptographically against a generated public key, session sealing is
tested for tampering and expiry, and the flow is driven end to end with a
mocked GitHub including forged installation ids and mismatched `state`.

**It has not been exercised against a real GitHub App**, because creating one
requires the web UI. The first person to complete the setup above is doing the
live verification. If something is wrong, it will be in the handshake with the
real GitHub, not in the logic below it.
