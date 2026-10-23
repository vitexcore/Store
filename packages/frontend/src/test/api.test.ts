import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('API client CSRF handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a product on the first submit after obtaining a CSRF token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { token: 'session-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'product-1' } }, 201));

    const { api } = await import('../lib/api.js');
    const result = await api.products.create({
      name: 'First submit product',
      price_cents: 1200,
      idempotency_key: '5e36dfb1-e77a-49d6-a0ca-e1a9402dc041',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/csrf-token');
    const productRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(productRequest.credentials).toBe('include');
    expect(new Headers(productRequest.headers).get('x-csrf-token')).toBe('session-token');
  });

  it('shares one in-flight token request across simultaneous product submissions', async () => {
    let releaseToken!: (response: Response) => void;
    const tokenResponse = new Promise<Response>((resolve) => { releaseToken = resolve; });
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/csrf-token') return tokenResponse;
      return Promise.resolve(jsonResponse({ ok: true, data: { id: `product-${fetchMock.mock.calls.length}` } }, 201));
    });

    const { api } = await import('../lib/api.js');
    const first = api.products.create({ name: 'One', price_cents: 100 });
    const second = api.products.create({ name: 'Two', price_cents: 200 });
    await Promise.resolve();

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/csrf-token')).toHaveLength(1);
    releaseToken(jsonResponse({ ok: true, data: { token: 'shared-token' } }));
    const results = await Promise.all([first, second]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/products')).toHaveLength(2);
  });

  it('does not reuse an in-flight token after the session generation changes', async () => {
    const releaseToken: Array<(response: Response) => void> = [];
    let tokenRequests = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/csrf-token') {
        tokenRequests += 1;
        return new Promise<Response>((resolve) => { releaseToken.push(resolve); });
      }
      return Promise.resolve(jsonResponse({ ok: true, data: { id: 'product' } }, 201));
    });

    const { api, resetCsrfToken } = await import('../lib/api.js');
    const first = api.products.create({ name: 'Before rotation', price_cents: 100 });
    resetCsrfToken();
    const second = api.products.create({ name: 'After rotation', price_cents: 200 });
    await Promise.resolve();

    expect(tokenRequests).toBe(2);
    releaseToken[0]!(jsonResponse({ ok: true, data: { token: 'old-session-token' } }));
    releaseToken[1]!(jsonResponse({ ok: true, data: { token: 'new-session-token' } }));
    await Promise.all([first, second]);

    const productCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/products');
    expect(productCalls).toHaveLength(2);
    expect(productCalls.every((call) => new Headers(call[1]?.headers).get('x-csrf-token') === 'new-session-token')).toBe(true);
  });

  it('refreshes once and retries the first product request after a CSRF rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { token: 'stale-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, code: 'CSRF_ERROR', message: 'invalid csrf token' }, 403))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { token: 'current-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'product-1' } }, 201));

    const { api } = await import('../lib/api.js');
    const result = await api.products.create({ name: 'Retry safely', price_cents: 1500 });

    expect(result.ok).toBe(true);
    const productCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/products');
    expect(productCalls).toHaveLength(2);
    expect(new Headers(productCalls[0]?.[1]?.headers).get('x-csrf-token')).toBe('stale-token');
    expect(new Headers(productCalls[1]?.[1]?.headers).get('x-csrf-token')).toBe('current-token');
  });

  it('does not send a state-changing request when token preparation fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'));

    const { api } = await import('../lib/api.js');
    const result = await api.products.create({ name: 'Not submitted', price_cents: 100 });

    expect(result).toMatchObject({ ok: false, code: 'CSRF_TOKEN_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
