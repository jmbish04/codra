import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLOUDFLARE_TEXT_GENERATION_MODELS = [
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/zai-org/glm-5.2',
  '@cf/moonshotai/kimi-k2.6',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/openai/gpt-oss-120b',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/nvidia/nemotron-3-120b-a12b',
  '@cf/moonshotai/kimi-k2.5',
  '@cf/ibm/granite-4.0-h-micro',
  '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
  '@cf/openai/gpt-oss-20b',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/google/gemma-3-12b-it',
  '@cf/mistral/mistral-small-3.1-24b-instruct',
  '@cf/qwen/qwq-32b',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/meta/llama-guard-3-8b',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.2-1b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/meta/llama-3.1-8b-instruct-awq',
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta-llama/meta-llama-3-8b-instruct',
  '@cf/meta/llama-3-8b-instruct-awq',
  '@cf/meta/llama-3-8b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.2',
  '@cf/google/gemma-7b-it-lora',
  '@cf/google/gemma-2b-it-lora',
  '@cf/meta-llama/llama-2-7b-chat-hf-lora',
  '@cf/google/gemma-7b-it',
  '@cf/nexusflow/starling-lm-7b-beta',
  '@cf/nousresearch/hermes-2-pro-mistral-7b',
  '@cf/mistral/mistral-7b-instruct-v0.2-lora',
  '@cf/qwen/qwen1.5-1.8b-chat',
  '@cf/microsoft/phi-2',
  '@cf/tinyllama/tinyllama-1.1b-chat-v1.0',
  '@cf/qwen/qwen1.5-14b-chat-awq',
  '@cf/qwen/qwen1.5-7b-chat-awq',
  '@cf/qwen/qwen1.5-0.5b-chat',
  '@cf/thebloke/discolm-german-7b-v1-awq',
  '@cf/tiiuae/falcon-7b-instruct',
  '@cf/openchat/openchat-3.5-0106',
  '@cf/defog/sqlcoder-7b-2',
  '@cf/deepseek-ai/deepseek-math-7b-instruct',
  '@cf/thebloke/deepseek-coder-6.7b-instruct-awq',
  '@cf/thebloke/deepseek-coder-6.7b-base-awq',
  '@cf/thebloke/llamaguard-7b-awq',
  '@cf/thebloke/neural-chat-7b-v3-1-awq',
  '@cf/thebloke/openhermes-2.5-mistral-7b-awq',
  '@cf/thebloke/llama-2-13b-chat-awq',
  '@cf/thebloke/mistral-7b-instruct-v0.1-awq',
  '@cf/thebloke/zephyr-7b-beta-awq',
  '@cf/meta/llama-2-7b-chat-fp16',
  '@cf/mistral/mistral-7b-instruct-v0.1',
  '@cf/meta/llama-2-7b-chat-int8',
  '@cf/meta/llama-3.1-70b-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fast'
];

function main() {
  const providerCfId = 'cfcfcfcf-cfcf-4fcf-bcfc-cfcfcfcfcfcf';
  const providerSlug = 'cloudflare-workers-ai';

  console.log('Generating seed SQL for all Cloudflare Workers AI models...');

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let sql = '-- Seed all Cloudflare Workers AI models\n';
  sql += 'INSERT OR IGNORE INTO model_configs (model_id, created_at, updated_at, rpm, tpm, rpd, provider, provider_id, model_name) VALUES\n';

  const rows = CLOUDFLARE_TEXT_GENERATION_MODELS.map((modelName) => {
    // Check if it's one of the already seeded models (which have specific ID format like the modelName itself)
    let modelId = `cloudflare-workers-ai:${modelName}`;
    if (
      modelName === '@cf/zai-org/glm-5.2' ||
      modelName === '@cf/moonshotai/kimi-k2.7-code' ||
      modelName === '@cf/qwen/qwen2.5-coder-32b-instruct'
    ) {
      modelId = modelName;
    }
    return `('${modelId}', '${now}', '${now}', NULL, NULL, NULL, '${providerSlug}', '${providerCfId}', '${modelName}')`;
  });

  sql += rows.join(',\n') + ';';

  const sqlPath = path.resolve(__dirname, './seed-all-models.sql');
  fs.writeFileSync(sqlPath, sql, 'utf-8');
  console.log(`Generated SQL file at ${sqlPath}`);
}

main();
