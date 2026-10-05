export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Session values are supplied by the in-memory controller, never saved here.
export async function apiFetch(path, { token = null, body, fetchImpl = fetch, timeoutMs = 50000, signal } = {}) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('\\')) {
    throw new ApiError('Only same-origin API requests are allowed.');
  }
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetchImpl(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError('The server returned an unreadable response. Please try again.', response.status);
    }
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'The Etlab request failed. Please try again.';
      throw new ApiError(message, response.status);
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApiError('The server returned unexpected data. Please try again.', response.status);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new ApiError('Etlab is taking too long to respond. Please try again.', 504);
    if (signal?.aborted) throw error;
    throw new ApiError('Could not connect to the API. Check your network and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
