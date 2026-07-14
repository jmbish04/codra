import { logger } from '@server/core/logger';
import { withTimeout } from '@server/core/timeout';
import { ProviderRequestError, providerErrorMessage, type ModelResponse } from './types';
import { REVIEW_RESPONSE_SCHEMA } from './schemas';

const OPENAI_TIMEOUT_MS = 180_000;
const OPENAI_MAX_OUTPUT_TOKENS = 4096;

export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  output_text?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

function extractOpenAiText(data: OpenAIResponse) {
  const messageContent = data?.choices?.[0]?.message?.content;
  if (typeof messageContent === 'string') return messageContent.trim();
  if (Array.isArray(messageContent)) {
    return messageContent.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim();
  }
  const outputText = data?.output_text;
  if (typeof outputText === 'string') return outputText.trim();
  return '';
}

function isPrivateIP(hostname: string) {
  const privateRanges = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^localhost$/,
    /^::1$/,
  ];
  return privateRanges.some((regex) => regex.test(hostname));
}

function isValidPublicUrl(urlString: string) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    
    const hostname = url.hostname;
    if (hostname === 'metadata.google.internal' || hostname === '100.100.100.200') {
      return false;
    }
    if (isPrivateIP(hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function reviewWithOpenAI(
  config: { apiKey: string | null; baseUrl: string; providerName: string },
  model: string,
  input: { systemPrompt: string; userPrompt: string },
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<ModelResponse> {
  logger.info(`Calling OpenAI-format model: ${model}`);
  
  if (!isValidPublicUrl(config.baseUrl)) {
    throw new ProviderRequestError(config.providerName, 400, 'Invalid provider base URL.');
  }
  
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  if (tracker) tracker.incrementSubrequests(1);
  const response = await withTimeout('OpenAI API', OPENAI_TIMEOUT_MS, (signal) =>
    fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `${input.systemPrompt}\n\nReturn only the JSON object. Do not include chain-of-thought, analysis, markdown, code fences, or explanatory prose.`,
          },
          { role: 'user', content: `${input.userPrompt}\n\nRespond with the required JSON object only.` },
        ],
        temperature: 0,
        max_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'codra_file_review',
            strict: true,
            schema: REVIEW_RESPONSE_SCHEMA,
          },
        },
      }),
    }),
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new ProviderRequestError(config.providerName, response.status, providerErrorMessage(errorText));
  }

  const data = await response.json() as OpenAIResponse;
  const rawText = extractOpenAiText(data);
  if (!rawText) {
    throw new Error('OpenAI provider returned an empty response.');
  }

  return {
    rawText,
    inputTokens: data?.usage?.prompt_tokens ?? data?.usage?.input_tokens ?? 0,
    outputTokens: data?.usage?.completion_tokens ?? data?.usage?.output_tokens ?? 0,
    modelUsed: model,
    provider: config.providerName,
  };
}
