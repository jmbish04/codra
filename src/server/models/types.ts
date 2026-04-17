export type ModelResponse = {
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: 'google' | 'cloudflare';
};
