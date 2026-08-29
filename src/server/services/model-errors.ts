/**
 * @fileoverview Model-layer error vocabulary, split out from `model.ts` so that
 * lower-level modules (e.g. `core/guardian-ai.ts`) can throw a
 * {@link RetryableModelError} without importing the full ModelService — which
 * would create an import cycle (model → provider modules → guardian-ai → model).
 */

/**
 * Signals that a model call failed transiently and the model chain should fall
 * back to the next configured model rather than aborting the review.
 */
export class RetryableModelError extends Error {
  readonly retryable = true;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RetryableModelError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: cause,
        writable: true,
        configurable: true,
      });
    }
  }
}

export function isRetryableModelError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable === true);
}
