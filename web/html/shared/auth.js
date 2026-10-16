// Sign-in with Thunder: OIDC authorization code with PKCE (a public client). The code is exchanged through this
// origin's /oidc/token proxy; the access token is kept for this browser tab only and sent on every call.

const IDP = 'https://localhost:8095';
const CLIENT_ID = 'claims-web';
const SCOPES = 'openid profile email groups';
const redirectUri = () => `${location.origin}/callback/`;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function store(key, value) {
  try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch { /* unavailable */ }
}
function read(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

// Sends the browser to Thunder; it comes back to /callback/ and then to `next`.
export async function signIn(next = location.pathname) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  store('pkce', JSON.stringify({ verifier, state, next }));
  const query = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri(), scope: SCOPES,
    state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  location.assign(`${IDP}/oauth2/authorize?${query}`);
  return new Promise(() => {});
}

// Finishes the redirect back from Thunder and returns where to go next, or throws with the reason.
export async function completeSignIn() {
  const params = new URLSearchParams(location.search);
  const saved = JSON.parse(read('pkce') || '{}');
  store('pkce', null);
  if (params.get('error')) throw new Error(params.get('error_description') || params.get('error'));
  if (!params.get('code') || params.get('state') !== saved.state) throw new Error('The sign-in response did not match this browser.');
  const res = await fetch('/oidc/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri(),
      client_id: CLIENT_ID, code_verifier: saved.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}).`);
  store('token', (await res.json()).access_token);
  const next = saved.next || '/claims/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/claims/';
}

export const token = () => read('token');

// The token's claims: username, given_name, family_name and groups.
export function claims() {
  const t = token();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp && payload.exp * 1000 < Date.now() ? null : payload;
  } catch {
    return null;
  }
}

export function signOut() {
  store('token', null);
  location.href = '/';
}

// fetch with the token; an expired or missing token sends the user to sign in again.
export async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token()}` } });
  if (res.status === 401) {
    store('token', null);
    await signIn();
  }
  return res;
}

// A protected file as an object URL, for <img> and links that cannot send the token themselves.
const blobs = new Map();
export async function fileUrl(url) {
  if (!blobs.has(url)) {
    const res = await api(url);
    blobs.set(url, res.ok ? URL.createObjectURL(await res.blob()) : '');
  }
  return blobs.get(url);
}
