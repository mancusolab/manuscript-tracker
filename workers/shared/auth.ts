/**
 * Auth module — Google OAuth login/callback, session management, token refresh.
 */

import type { Env, Session, User } from './types';
import { encryptToken, decryptToken, signJWT, verifyJWT } from './crypto';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

const COOKIE_MAX_AGE = 604800; // 7 days

/**
 * Build the Google OAuth authorization URL.
 */
export function getLoginUrl(env: Env): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.WORKER_URL}/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens, fetch user info, upsert user, return cookie + redirect.
 */
export async function handleCallback(
  code: string,
  env: Env,
): Promise<{ cookie: string; redirectUrl: string }> {
  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.WORKER_URL}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorBody}`);
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };

  // Fetch user info
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw new Error(`Failed to fetch user info: ${userInfoResponse.status}`);
  }

  const userInfo = (await userInfoResponse.json()) as {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };

  // Encrypt refresh token if present
  const encryptedRefreshToken = tokens.refresh_token
    ? await encryptToken(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY)
    : null;

  // Upsert user in D1 (keyed by Google user ID)
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, refresh_token, token_status)
     VALUES (?, ?, ?, ?, ?, 'valid')
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       refresh_token = COALESCE(excluded.refresh_token, users.refresh_token),
       token_status = 'valid'`,
  )
    .bind(
      userInfo.id,
      userInfo.email,
      userInfo.name,
      userInfo.picture ?? null,
      encryptedRefreshToken,
    )
    .run();

  // Create signed JWT session cookie
  const sessionPayload: Session = {
    user_id: userInfo.id,
    email: userInfo.email,
    name: userInfo.name,
  };

  const jwt = await signJWT(sessionPayload, env.SESSION_SECRET);

  const cookie = `session=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;

  return { cookie, redirectUrl: '/' };
}

/**
 * Extract and verify the session cookie. Returns Session or null.
 */
export async function getSession(request: Request, env: Env): Promise<Session | null> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/(?:^|;\s*)session=([^\s;]+)/);
  if (!match) return null;

  const payload = await verifyJWT(match[1], env.SESSION_SECRET);
  if (!payload) return null;

  const session = payload as Record<string, unknown>;
  if (
    typeof session.user_id !== 'string' ||
    typeof session.email !== 'string' ||
    typeof session.name !== 'string'
  ) {
    return null;
  }

  return {
    user_id: session.user_id,
    email: session.email,
    name: session.name,
  };
}

/**
 * Like getSession but throws a 401 Response if no valid session.
 */
export async function requireSession(request: Request, env: Env): Promise<Session> {
  const session = await getSession(request, env);
  if (!session) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return session;
}

/**
 * Use a refresh token to get a new access token from Google.
 */
export async function refreshAccessToken(
  refreshToken: string,
  env: Env,
): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Get a fresh access token for a user. Decrypts stored refresh token and refreshes.
 * If refresh fails, marks user token_status as 'needs_reauth' and throws.
 */
export async function getUserAccessToken(userId: string, env: Env): Promise<string> {
  const row = await env.DB.prepare(
    'SELECT refresh_token FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<Pick<User, 'refresh_token'>>();

  if (!row || !row.refresh_token) {
    throw new Error('No refresh token stored for user');
  }

  const refreshToken = await decryptToken(row.refresh_token, env.TOKEN_ENCRYPTION_KEY);

  try {
    return await refreshAccessToken(refreshToken, env);
  } catch (err) {
    // Mark token as needing reauth
    await env.DB.prepare(
      "UPDATE users SET token_status = 'needs_reauth' WHERE id = ?",
    )
      .bind(userId)
      .run();
    throw err;
  }
}
