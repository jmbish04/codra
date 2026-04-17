import type { ReviewJobMessage } from '@shared/schema';

export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<any>;
}

export interface QueueProducer<T> {
  send(message: T): Promise<void>;
}

export interface AssetsBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface AppBindings {
  AI: WorkersAiBinding;
  APP_KV: KVNamespace;
  REVIEW_QUEUE: QueueProducer<ReviewJobMessage>;
  ASSETS: AssetsBinding;
  APP_PRIVATE_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_WEBHOOK_SECRET: string;
  GEMINI_API_KEY: string;
  NEON_DATABASE_URL: string;
  DASHBOARD_PASSWORD: string;
  BOT_USERNAME: string;
  ENVIRONMENT: string;
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
}

export interface AppVariables {
  sessionToken: string | null;
  requestId: string;
}

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
