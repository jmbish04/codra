import { Hono } from 'hono';
import type { AppEnv } from '@server/env';
import { readSession } from '@server/core/sessions';
import { jsonError } from '@server/core/http';

function randomHex(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createMcpOAuthRouter() {
  const app = new Hono<AppEnv>();

  // OAuth 2.1 Authorization Endpoint
  app.get('/authorize', async (c) => {
    const user = await readSession(c);

    const responseType = c.req.query('response_type');
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const state = c.req.query('state');
    const codeChallenge = c.req.query('code_challenge');
    const codeChallengeMethod = c.req.query('code_challenge_method') || 'plain';

    if (!responseType || !redirectUri) {
      return c.text('Missing required OAuth parameters', 400);
    }

    // If not authenticated, redirect to GitHub Login
    if (!user) {
      const loginUrl = new URL('/auth/github', c.req.url);
      loginUrl.searchParams.set('next', c.req.url);
      return c.redirect(loginUrl.toString());
    }

    // Generate authorization code
    const code = randomHex(32);
    
    // Store auth code state in KV with a 5-minute TTL
    await c.env.APP_KV.put(
      `oauth_code:${code}`,
      JSON.stringify({
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        user: user.login,
      }),
      { expirationTtl: 60 * 5 }
    );

    // Redirect back to Claude/client
    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set('code', code);
    if (state) {
      callbackUrl.searchParams.set('state', state);
    }

    return c.redirect(callbackUrl.toString());
  });

  // OAuth 2.1 Token Exchange Endpoint
  app.post('/token', async (c) => {
    const body = await c.req.parseBody();
    const grantType = body.grant_type;
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const codeVerifier = body.code_verifier;

    if (grantType !== 'authorization_code' || !code) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid grant_type or missing code.' }, 400);
    }

    const codeDataStr = await c.env.APP_KV.get(`oauth_code:${code}`);
    if (!codeDataStr) {
      return c.json({ error: 'invalid_grant', error_description: 'Authorization code has expired or is invalid.' }, 400);
    }

    const codeData = JSON.parse(codeDataStr);
    await c.env.APP_KV.delete(`oauth_code:${code}`);

    // PKCE verification
    if (codeData.codeChallenge) {
      if (!codeVerifier) {
        return c.json({ error: 'invalid_grant', error_description: 'Missing code_verifier for PKCE validation.' }, 400);
      }

      let challengeVerified = false;
      if (codeData.codeChallengeMethod === 'S256') {
        const calculated = await sha256(String(codeVerifier));
        challengeVerified = calculated === codeData.codeChallenge;
      } else {
        challengeVerified = String(codeVerifier) === codeData.codeChallenge;
      }

      if (!challengeVerified) {
        return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' }, 400);
      }
    }

    // Generate access token
    const accessToken = 'mcp_' + randomHex(32);
    
    // Persist access token in KV (no expiration by default or 30 days)
    await c.env.APP_KV.put(
      `mcp_token:${accessToken}`,
      JSON.stringify({
        user: codeData.user,
        createdAt: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 30 } // 30 days
    );

    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 60 * 60 * 24 * 30, // 30 days
    });
  });

  // Dynamic Client Registration (RFC 7591) — Claude registers itself here
  app.post('/register', async (c) => {
    const body = await c.req.json();
    const redirectUris = body.redirect_uris || [];
    const clientName = body.client_name || 'mcp-client';

    // Generate a stable client_id based on the redirect URIs
    const clientId = 'mcp_' + randomHex(16);

    // Store client registration in KV (90-day TTL)
    await c.env.APP_KV.put(
      `oauth_client:${clientId}`,
      JSON.stringify({
        clientName,
        redirectUris,
        createdAt: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );

    return c.json({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }, 201);
  });

  return app;
}
