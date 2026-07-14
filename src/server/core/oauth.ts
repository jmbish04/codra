
const OAUTH_STATE_TTL_SECONDS = 60 * 10;

function randomHex(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function oauthStateKey(state: string) {
  return `oauth-state:${state}`;
}

export function parseAllowedUsers(input: string) {
  return new Set(
    input
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function createOAuthState(env: Pick<Env, 'APP_KV'>, payload: Record<string, any> = {}) {
  const state = randomHex();
  await env.APP_KV.put(
    oauthStateKey(state),
    JSON.stringify({ ...payload, createdAt: new Date().toISOString() }),
    { expirationTtl: OAUTH_STATE_TTL_SECONDS },
  );
  return state;
}

export async function consumeOAuthState(env: Pick<Env, 'APP_KV'>, state: string) {
  const key = oauthStateKey(state);
  const value = await env.APP_KV.get(key);
  if (!value) {
    return null;
  }

  await env.APP_KV.delete(key);
  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return {};
  }
}
