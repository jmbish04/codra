export type ModelResponse = {
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: string;
};

export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
  ) {
    super(`${provider} request failed with ${status}: ${message}`);
    this.name = 'ProviderRequestError';
  }
}

export function providerErrorMessage(errorText: string) {
  try {
    const parsed = JSON.parse(errorText) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      let message: unknown;

      if (typeof obj.error === 'object' && obj.error !== null) {
        message = (obj.error as Record<string, unknown>).message ?? obj.error;
      } else {
        message = obj.message ?? obj.error;
      }

      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
  } catch {
    // Fall back to the provider body below.
  }

  return errorText.trim() || 'The provider returned an error.';
}

/**
 * A structured-output contract for a model call. Providers default to the file
 * review schema; other callers (e.g. changelog generation) pass their own.
 * `name` is used as the OpenAI json_schema name and the Anthropic tool name.
 */
export interface StructuredSchema {
  name: string;
  description?: string;
  schema: object;
}
