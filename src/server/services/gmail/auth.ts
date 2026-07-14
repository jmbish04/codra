/**
 * @fileoverview Gmail Comms Hub — service-account (DWD) token minting.
 *
 * Mints a short-lived Gmail API access token by impersonating a Workspace
 * user (`justin@126colby.com`) via a service account configured for
 * domain-wide delegation. This runs entirely on Workers using WebCrypto —
 * there is no `googleapis`/`google-auth-library` dependency (those assume
 * Node's `crypto`/`Buffer`, which Workers does not provide).
 *
 * Secrets (all `SecretsStoreSecret` bindings, read via `.get()`):
 *   - `GOOGLE_CREDS_SA_CLIENT_EMAIL`      service account email (JWT `iss`/`sub` actor)
 *   - `GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1`  first half of the PKCS8 PEM
 *   - `GOOGLE_CREDS_SA_PRIVATE_KEY_PT_2`  second half — the key EXCEEDS the
 *     secrets-store single-value size limit, so it is split; concatenate the
 *     two parts back together before parsing.
 *
 * Flow: build a signed JWT assertion (RS256) -> POST it to Google's OAuth
 * token endpoint using the `urn:ietf:params:oauth:grant-type:jwt-bearer`
 * grant -> receive a bearer access_token good for ~1hr.
 *
 * The minted token is cached per-isolate (module-level), keyed by the
 * impersonated user's email, and reused until it has under 5 minutes left —
 * Workers reuse the global scope across requests within an isolate. A cold
 * isolate or eviction just re-mints; there is no correctness risk in a
 * stale-miss here. Keying by `impersonate` (rather than a single shared slot)
 * matters as soon as this is ever called for more than one Workspace user —
 * a single-slot cache would silently hand user A's bearer token to a request
 * impersonating user B.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SCOPES =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

/** Refresh this many seconds before actual expiry to avoid edge-of-window 401s. */
const REFRESH_SKEW_SECONDS = 5 * 60;

interface CachedToken {
  token: string;
  /** Epoch seconds at which the token should be considered expired. */
  exp: number;
}

/** Per-isolate cache, keyed by impersonated email — NOT per-request state;
 * safe because each entry is just an upstream-issued bearer token that is
 * valid for any request made on behalf of that same impersonated user. */
const cachedTokens = new Map<string, CachedToken>();

// ─── base64url helpers (no Buffer on Workers) ────────────────────────────────

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(input: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(input));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ─── PEM -> CryptoKey ─────────────────────────────────────────────────────────

/**
 * Strip PEM armor/newlines from a (possibly split-and-concatenated) PKCS8
 * private key and import it as an RSASSA-PKCS1-v1_5 / SHA-256 signing key.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\r?\n/g, "")
    .replace(/\\n/g, "") // in case the secret store value uses literal "\n" escapes
    .trim();

  let der: ArrayBuffer;
  try {
    der = base64ToArrayBuffer(stripped);
  } catch (err) {
    throw new Error(
      `gmail/auth: failed to base64-decode service account private key (is PT_1+PT_2 concatenated correctly?): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (err) {
    throw new Error(
      `gmail/auth: failed to import service account private key (expected PKCS8 PEM): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// ─── JWT assertion ────────────────────────────────────────────────────────────

async function buildSignedJwt(
  clientEmail: string,
  privateKey: CryptoKey,
  impersonate: string,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    sub: impersonate,
    scope: GMAIL_SCOPES,
    aud: TOKEN_URL,
    iat,
    exp,
  };

  const signingInput = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(
    JSON.stringify(claims),
  )}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function exchangeJwtForAccessToken(assertion: string): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "<unreadable body>");
    throw new Error(
      `gmail/auth: Google token endpoint returned ${res.status} ${res.statusText}: ${errorBody}`,
    );
  }

  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Read + concatenate the split private key secret, minting a fresh access
 * token via a signed JWT-bearer assertion. Throws descriptive errors for
 * missing secrets or Google error responses (passthrough of the error body).
 */
export async function getGmailAccessToken(
  env: Env,
  impersonate = "justin@126colby.com",
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = cachedTokens.get(impersonate);
  if (cached && cached.exp - now > REFRESH_SKEW_SECONDS) {
    return cached.token;
  }

  const [clientEmail, keyPart1, keyPart2] = await Promise.all([
    (env as any).GOOGLE_CREDS_SA_CLIENT_EMAIL.get().catch(() => null),
    (env as any).GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1.get().catch(() => null),
    (env as any).GOOGLE_CREDS_SA_PRIVATE_KEY_PT_2.get().catch(() => null),
  ]);

  if (!clientEmail) {
    throw new Error("gmail/auth: GOOGLE_CREDS_SA_CLIENT_EMAIL secret is missing or empty");
  }
  if (!keyPart1 || !keyPart2) {
    throw new Error(
      "gmail/auth: GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1/PT_2 secrets are missing — the private key is split across both and must be concatenated",
    );
  }

  const privateKeyPem = `${keyPart1}${keyPart2}`;
  const privateKey = await importPrivateKey(privateKeyPem);
  const assertion = await buildSignedJwt(clientEmail, privateKey, impersonate);
  const tokenResponse = await exchangeJwtForAccessToken(assertion);

  const newToken: CachedToken = {
    token: tokenResponse.access_token,
    exp: now + (tokenResponse.expires_in || 3600),
  };
  cachedTokens.set(impersonate, newToken);

  return newToken.token;
}
