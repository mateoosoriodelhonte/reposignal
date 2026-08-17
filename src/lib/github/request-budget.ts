/**
 * A hard cap on the GitHub requests a single analysis may spend.
 *
 * Without one, a repository with 8,000 open issues would happily paginate
 * until the rate limit is gone and every other user is locked out. The budget
 * makes the cost of an analysis bounded and predictable.
 *
 * Exhausting the budget is not an error. It means the analysis proceeds with
 * the data it has, records that its samples were truncated, and lowers the
 * confidence of anything derived from them. That is the honest outcome —
 * failing outright would discard good partial data.
 */
export class RequestBudget {
  readonly limit: number;
  #spent = 0;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('Request budget must be a positive integer.');
    }
    this.limit = limit;
  }

  get spent(): number {
    return this.#spent;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.#spent);
  }

  get exhausted(): boolean {
    return this.#spent >= this.limit;
  }

  /**
   * Reserves one request. Returns false when the budget is spent, so callers
   * stop paginating rather than throwing mid-collection.
   */
  tryConsume(): boolean {
    if (this.exhausted) return false;
    this.#spent += 1;
    return true;
  }
}
