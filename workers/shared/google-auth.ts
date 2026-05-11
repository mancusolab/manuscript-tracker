// Google Service Account JWT authentication for Docs API
// The service account key JSON is stored as a Worker secret (GOOGLE_SERVICE_ACCOUNT_KEY)

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

function base64url(data: string): string {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createJWT(key: ServiceAccountKey, scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: key.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the private key for signing
  const pemContents = key.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = base64url(String.fromCharCode(...new Uint8Array(signature)));
  return `${unsignedToken}.${signatureB64}`;
}

export async function getAccessToken(serviceAccountKeyJson: string): Promise<string> {
  const key: ServiceAccountKey = JSON.parse(serviceAccountKeyJson);
  const jwt = await createJWT(key, [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
  ]);

  const response = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

export async function fetchDocContent(accessToken: string, docId: string): Promise<any> {
  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`Docs API error: ${response.status}`);
  return response.json();
}

export async function watchFile(accessToken: string, docId: string, webhookUrl: string, channelId: string): Promise<any> {
  const expiration = Date.now() + 86400000; // 24 hours
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/watch`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        expiration: expiration.toString(),
      }),
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Watch API error: ${response.status} ${err}`);
  }
  return response.json();
}

export async function stopWatch(accessToken: string, channelId: string, resourceId: string) {
  await fetch('https://www.googleapis.com/drive/v3/channels/stop', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: channelId, resourceId }),
  });
}

export async function fetchRevisions(accessToken: string, docId: string): Promise<any[]> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/revisions?fields=revisions(id,modifiedTime,lastModifyingUser)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`Drive API error: ${response.status}`);
  const data = await response.json() as { revisions: any[] };
  return data.revisions || [];
}

export async function postComment(accessToken: string, docId: string, content: string): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }
  );
  if (!response.ok) throw new Error(`Comments API error: ${response.status}`);
  const data = await response.json() as { id: string };
  return data.id;
}

export async function resolveComment(accessToken: string, docId: string, commentId: string) {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/comments/${commentId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resolved: true }),
    }
  );
}

export async function getComments(accessToken: string, docId: string): Promise<any[]> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=comments(id,resolved,content,quotedFileContent,author(displayName,emailAddress),createdTime,modifiedTime)&includeDeleted=false&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) throw new Error(`Comments API error: ${response.status}`);
  const data = await response.json() as { comments: any[] };
  return data.comments || [];
}
