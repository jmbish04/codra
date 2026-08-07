import { logger } from './logger';

export interface TokenUsage {
  input: number;
  output: number;
}

export interface ModelUsage extends TokenUsage {
  model: string;
  calls: number;
}

export class TokenTracker {
  private usage: Map<string, ModelUsage> = new Map();
  private subrequests = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private readonly MAX_SUBREQUESTS = 50;
  private readonly SAFE_MARGIN = 22; // Increased even further to handle finalization overhead

  incrementSubrequests(count = 1) {
    this.subrequests += count;
  }

  getSubrequestCount() {
    return this.subrequests;
  }

  hasRemainingSubrequests(needed = 1) {
    return this.subrequests + needed <= this.MAX_SUBREQUESTS;
  }

  isNearLimit() {
    return this.subrequests >= this.MAX_SUBREQUESTS - this.SAFE_MARGIN;
  }

  /**
   * Records token usage for a specific model call.
   */
  record(model: string, input: number, output: number) {
    const existing = this.usage.get(model) || { model, input: 0, output: 0, calls: 0 };

    this.usage.set(model, {
      model,
      input: existing.input + input,
      output: existing.output + output,
      calls: existing.calls + 1,
    });

    logger.debug(`Token usage recorded for ${model}`, {
      input,
      output,
      totalInput: existing.input + input,
      totalOutput: existing.output + output
    });
  }

  /**
   * Records cache token usage.
   */
  recordCache(read: number, write: number) {
    this.cacheRead += read;
    this.cacheWrite += write;
  }

  /**
   * Returns the accumulated cache token usage.
   */
  getCacheUsage(): { read: number; write: number } {
    return { read: this.cacheRead, write: this.cacheWrite };
  }

  /**
   * Returns the total usage across all models.
   */
  getTotalUsage(): TokenUsage {
    let input = 0;
    let output = 0;
    for (const modelUsage of this.usage.values()) {
      input += modelUsage.input;
      output += modelUsage.output;
    }
    return { input, output };
  }

  /**
   * Returns a breakdown of usage by model.
   */
  getBreakdown(): ModelUsage[] {
    return Array.from(this.usage.values());
  }

  /**
   * Merges another tracker's usage into this one.
   * Useful when combining results from retries or sub-tasks.
   */
  merge(other: TokenTracker) {
    for (const usage of other.getBreakdown()) {
      this.record(usage.model, usage.input, usage.output);
    }
    const cacheUsage = other.getCacheUsage();
    this.recordCache(cacheUsage.read, cacheUsage.write);
  }

  /**
   * Resets all usage data.
   */
  reset() {
    this.usage.clear();
    this.cacheRead = 0;
    this.cacheWrite = 0;
  }
}
