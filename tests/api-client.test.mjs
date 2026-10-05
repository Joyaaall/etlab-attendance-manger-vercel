import test from 'node:test';
import assert from 'node:assert/strict';

const { apiFetch, ApiError } = await import('../public/static/api-client.mjs');

test('the API client sends login as JSON without browser cookies or an auth header', async () => {
  let call;
  const result = await apiFetch('/api/login', {
    body: { username: 'fixture-user', password: 'fixture-only-not-a-real-secret' },
    fetchImpl: async (path, options) => {
      call = { path, options };
      return new Response(JSON.stringify({ token: 'fixture-session' }), { status: 200 });
    },
  });
  assert.equal(result.token, 'fixture-session');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.cache, 'no-store');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.equal(call.options.headers.Authorization, undefined);
  assert.equal(JSON.parse(call.options.body).username, 'fixture-user');
});

test('an authenticated read uses the exact session value in a Bearer header', async () => {
  let headers;
  await apiFetch('/api/profile', { token: 'fixture-session', fetchImpl: async (path, options) => {
    headers = options.headers;
    return new Response('{}', { status: 200 });
  } });
  assert.equal(headers.Authorization, 'Bearer fixture-session');
});

test('an expired upstream session becomes a typed 401 error', async () => {
  await assert.rejects(apiFetch('/api/profile', {
    token: 'fixture-session',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'Token expired. Please login again.' }), { status: 401 }),
  }), (error) => error instanceof ApiError && error.status === 401 && /expired/.test(error.message));
});

test('non-JSON server errors produce a readable error without exposing HTML', async () => {
  await assert.rejects(apiFetch('/api/attendance', {
    fetchImpl: async () => new Response('<html>Traceback secret</html>', { status: 500 }),
  }), (error) => error instanceof ApiError && error.status === 500 && !error.message.includes('secret'));
});

test('credentials cannot be sent to an external address', async () => {
  let called = false;
  await assert.rejects(apiFetch('https://example.com/api/login', { token: 'fixture-session', fetchImpl: async () => { called = true; } }), /same-origin/);
  assert.equal(called, false);
});

test('client timeouts abort the request and return a readable error', async () => {
  await assert.rejects(apiFetch('/api/profile', {
    timeoutMs: 5,
    fetchImpl: async (path, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }),
  }), (error) => error instanceof ApiError && error.status === 504);
});
