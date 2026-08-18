import type { Logger } from '@/lib/logging/logger';

import { GitHubAppError, type GitHubAppConfig, signAppJwt } from './github-app';

/**
 * Installation access tokens.
 *
 * These are what actually read a private repository. They are scoped to the
 * repositories the user selected, expire after an hour, and are held in memory
 * only — never persisted, never logged, never sent to a client.
 *
 * The cache exists because minting one costs a round trip and a signature, and
 * a single analysis makes ~22 requests. It refreshes on a margin before expiry
 * rather than reacting to a 401, so a token never expires mid-analysis.
 */

const API_BASE = 'https://api.github.com';

/** Refresh this long before actual expiry. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export interface InstallationToken {
  token: string;
  expiresAt: Date;
}

export interface InstallationRepository {
  githubId: number;
  fullName: string;
  isPrivate: boolean;
}

interface CacheEntry {
  token: string;
  expiresAt: Date;
}

export class InstallationTokenProvider {
  #cache = new Map<number, CacheEntry>();

  constructor(
    private readonly config: GitHubAppConfig,
    private readonly options: {
      fetchImpl?: typeof fetch;
      now?: () => Date;
      logger?: Logger;
    } = {},
  ) {}

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }

  #fetch(): typeof fetch {
    return this.options.fetchImpl ?? globalThis.fetch;
  }

  /** Drops a cached token, used when GitHub reports the installation is gone. */
  invalidate(installationId: number): void {
    this.#cache.delete(installationId);
  }

  /**
   * Returns a usable token for an installation, minting one if needed.
   *
   * Throws `installation_unavailable` when GitHub refuses — which is the normal
   * signal that the user revoked access. Callers translate that into "sign in
   * again" rather than a generic failure.
   */
  async getToken(installationId: number): Promise<InstallationToken> {
    const now = this.#now();
    const cached = this.#cache.get(installationId);

    if (cached && cached.expiresAt.getTime() - REFRESH_MARGIN_MS > now.getTime()) {
      return { token: cached.token, expiresAt: cached.expiresAt };
    }

    const jwt = signAppJwt(this.config, now);

    const response = await this.#fetch()(
      `${API_BASE}/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'RepoSignal (+https://github.com/mateoosoriodelhonte/reposignal)',
        },
      },
    );

    if (!response.ok) {
      this.#cache.delete(installationId);
      this.options.logger?.warn('installation_token_failed', {
        installationId,
        status: response.status,
      });
      throw new GitHubAppError(
        'That GitHub App installation is no longer available.',
        'installation_unavailable',
      );
    }

    const body = (await response.json()) as { token?: unknown; expires_at?: unknown };

    if (typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
      throw new GitHubAppError(
        'GitHub returned an unexpected installation token response.',
        'exchange_failed',
      );
    }

    const expiresAt = new Date(body.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new GitHubAppError(
        'GitHub returned an unreadable token expiry.',
        'exchange_failed',
      );
    }

    this.#cache.set(installationId, { token: body.token, expiresAt });
    return { token: body.token, expiresAt };
  }

  /**
   * Lists the repositories an installation actually grants.
   *
   * This is the authoritative answer to "what may RepoSignal see?" — it comes
   * from GitHub rather than from anything the client claims, which is what
   * stops a crafted request from reaching a repository the user never granted.
   */
  async listRepositories(installationId: number): Promise<InstallationRepository[]> {
    const { token } = await this.getToken(installationId);
    const repositories: InstallationRepository[] = [];

    // Bounded: a very large installation is truncated rather than paginated
    // without limit, consistent with how analysis samples are bounded.
    for (let page = 1; page <= 5; page += 1) {
      const response = await this.#fetch()(
        `${API_BASE}/installation/repositories?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent':
              'RepoSignal (+https://github.com/mateoosoriodelhonte/reposignal)',
          },
        },
      );

      if (!response.ok) {
        throw new GitHubAppError(
          'Could not list the repositories for that installation.',
          'installation_unavailable',
        );
      }

      const body = (await response.json()) as { repositories?: unknown };
      if (!Array.isArray(body.repositories)) break;

      for (const raw of body.repositories) {
        if (typeof raw !== 'object' || raw === null) continue;
        const record = raw as Record<string, unknown>;
        if (typeof record['id'] !== 'number' || typeof record['full_name'] !== 'string') {
          continue;
        }
        repositories.push({
          githubId: record['id'],
          fullName: record['full_name'],
          isPrivate: record['private'] === true,
        });
      }

      if (body.repositories.length < 100) break;
    }

    return repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }
}
