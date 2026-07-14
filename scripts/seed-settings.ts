import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encryptLlmApiKey } from '../src/server/core/llm-crypto';

// Setup __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const devVarsPath = path.resolve(__dirname, '../.dev.vars');

function getEncryptionKey() {
  if (process.env.LLM_CONFIG_ENCRYPTION_KEY) {
    return process.env.LLM_CONFIG_ENCRYPTION_KEY;
  }
  if (fs.existsSync(devVarsPath)) {
    const content = fs.readFileSync(devVarsPath, 'utf-8');
    const match = content.match(/LLM_CONFIG_ENCRYPTION_KEY="([^"]+)"/);
    if (match) return match[1];
  }
  throw new Error('LLM_CONFIG_ENCRYPTION_KEY not found in process.env or .dev.vars');
}

async function main() {
  const encryptionKey = getEncryptionKey();
  const env = { LLM_CONFIG_ENCRYPTION_KEY: encryptionKey };

  console.log('Encrypting API keys using LLM_CONFIG_ENCRYPTION_KEY...');

  const encryptedGemini = await encryptLlmApiKey(env, 'placeholder-gemini-key');
  const encryptedAnthropic = await encryptLlmApiKey(env, 'placeholder-anthropic-key');
  const encryptedOpenai = await encryptLlmApiKey(env, 'placeholder-openai-key');

  const providerCfId = 'cfcfcfcf-cfcf-4fcf-bcfc-cfcfcfcfcfcf';
  const providerGeminiId = '88888888-8888-4888-b888-888888888888';
  const providerAnthropicId = '33333333-3333-4333-b333-333333333333';
  const providerOpenaiId = '11111111-1111-4111-b111-111111111111';

  const sql = `
-- Seed LLM Providers
INSERT OR REPLACE INTO llm_providers (id, name, api_format, base_url, encrypted_api_key, enabled) VALUES
('${providerCfId}', 'Cloudflare Workers AI', 'cloudflare-workers-ai', NULL, NULL, 1),
('${providerGeminiId}', 'Gemini', 'gemini', NULL, '${encryptedGemini}', 1),
('${providerAnthropicId}', 'Anthropic', 'anthropic', NULL, '${encryptedAnthropic}', 1),
('${providerOpenaiId}', 'OpenAI', 'openai', NULL, '${encryptedOpenai}', 1);

-- Seed Model Configs
INSERT OR REPLACE INTO model_configs (model_id, provider, provider_id, model_name, rpm, tpm, rpd) VALUES
('@cf/zai-org/glm-5.2', 'cloudflare-workers-ai', '${providerCfId}', '@cf/zai-org/glm-5.2', NULL, NULL, NULL),
('@cf/moonshotai/kimi-k2.7-code', 'cloudflare-workers-ai', '${providerCfId}', '@cf/moonshotai/kimi-k2.7-code', NULL, NULL, NULL),
('@cf/qwen/qwen2.5-coder-32b-instruct', 'cloudflare-workers-ai', '${providerCfId}', '@cf/qwen/qwen2.5-coder-32b-instruct', NULL, NULL, NULL),
('gemini-2.5-flash', 'gemini', '${providerGeminiId}', 'gemini-2.5-flash', NULL, NULL, NULL),
('gemini-2.5-pro', 'gemini', '${providerGeminiId}', 'gemini-2.5-pro', NULL, NULL, NULL),
('claude-3-5-sonnet-latest', 'anthropic', '${providerAnthropicId}', 'claude-3-5-sonnet-latest', NULL, NULL, NULL),
('gpt-4o', 'openai', '${providerOpenaiId}', 'gpt-4o', NULL, NULL, NULL),
('gpt-4o-mini', 'openai', '${providerOpenaiId}', 'gpt-4o-mini', NULL, NULL, NULL);
`;

  const sqlPath = path.resolve(__dirname, './seed-settings.sql');
  fs.writeFileSync(sqlPath, sql, 'utf-8');
  console.log(`Generated SQL file at ${sqlPath}`);
}

main().catch(console.error);
