declare interface Ai {
  run(model: string, input: Record<string, unknown>): Promise<any>;
}

declare interface Env {
  AI: Ai;
  APP_KV: KVNamespace;
  REVIEW_QUEUE: Queue<any>;
  ASSETS: Fetcher;
  HYPERDRIVE: Hyperdrive;
  APP_PRIVATE_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_WEBHOOK_SECRET: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  BOT_USERNAME: string;
  ENVIRONMENT: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
}
