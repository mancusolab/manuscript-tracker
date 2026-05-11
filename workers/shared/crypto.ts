/**
 * Crypto utilities for token encryption and JWT signing.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */

async function deriveKey(key: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', keyData);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * AES-GCM encrypt a token string. Returns base64-encoded iv + ciphertext.
 */
export async function encryptToken(token: string, key: string): Promise<string> {
  const cryptoKey = await deriveKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded,
  );
  // Concatenate iv (12 bytes) + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * AES-GCM decrypt. Expects base64-encoded iv + ciphertext.
 */
export async function decryptToken(encrypted: string, key: string): Promise<string> {
  const cryptoKey = await deriveKey(key);
  const raw = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

function base64url(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str));
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Sign a JWT with HMAC-SHA256. Sets exp to 7 days from now.
 */
export async function signJWT(payload: object, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 7 * 24 * 60 * 60 };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const hmacKey = await getHmacKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Verify a JWT signature and expiry. Returns the payload or null.
 */
export async function verifyJWT(token: string, secret: string): Promise<object | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const hmacKey = await getHmacKey(secret);

  // Decode signature from base64url
  const sigStr = base64urlDecode(signatureB64);
  const sigBytes = Uint8Array.from(sigStr, (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify(
    'HMAC',
    hmacKey,
    sigBytes,
    new TextEncoder().encode(signingInput),
  );

  if (!valid) return null;

  try {
    const payload = JSON.parse(base64urlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
