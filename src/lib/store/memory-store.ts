import type { AnalysisStore, StoredAnalysis } from './types';

/**
 * In-memory analysis store.
 *
 * Used by tests, and as the production fallback when `DATABASE_URL` is not
 * configured. That fallback is deliberate: RepoSignal is useful without a
 * database — analyses simply do not survive a restart — and requiring one to
 * run the app would make the project harder to try than it needs to be.
 *
 * Entries are capped so a long-running process cannot grow without bound.
 */
export class MemoryAnalysisStore implements AnalysisStore {
  #byRepository = new Map<number, StoredAnalysis>();
  #idsByFullName = new Map<string, number>();
  #insertionOrder: number[] = [];

  constructor(private readonly maxEntries = 200) {}

  async findLatest(githubId: number): Promise<StoredAnalysis | null> {
    return this.#byRepository.get(githubId) ?? null;
  }

  async findIdByFullName(fullName: string): Promise<number | null> {
    return this.#idsByFullName.get(fullName.toLowerCase()) ?? null;
  }

  async save(entry: StoredAnalysis): Promise<void> {
    const githubId = entry.result.repository.githubId;

    if (!this.#byRepository.has(githubId)) {
      this.#insertionOrder.push(githubId);
    }

    this.#byRepository.set(githubId, entry);
    this.#idsByFullName.set(entry.result.repository.fullName.toLowerCase(), githubId);

    while (this.#insertionOrder.length > this.maxEntries) {
      const oldest = this.#insertionOrder.shift();
      if (oldest === undefined) break;

      const evicted = this.#byRepository.get(oldest);
      this.#byRepository.delete(oldest);
      if (evicted) {
        this.#idsByFullName.delete(evicted.result.repository.fullName.toLowerCase());
      }
    }
  }

  /** Test helper. */
  get size(): number {
    return this.#byRepository.size;
  }
}
