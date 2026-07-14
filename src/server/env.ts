// App-level types (not binding types — those come from wrangler-generated worker-env.d.ts)

export interface DashboardSessionUser {
  githubUserId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  signedInAt: string;
}

export interface AppVariables {
  sessionToken: string | null;
  sessionUser: DashboardSessionUser | null;
  requestId: string;
}

export type AppEnv = {
  Bindings: Env; // global Env from wrangler types
  Variables: AppVariables;
};
