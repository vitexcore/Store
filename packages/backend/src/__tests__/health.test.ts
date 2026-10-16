/**
 * Health-check endpoint tests.
 *
 * Integration tests — boots the real Express app via supertest.
 * Requires DATABASE_URL in the environment (pointing to a running PostgreSQL).
 */

import request from 'supertest';
import { createApp } from '../app.js';
import { closePool } from '../db/pool.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('GET /health', () => {
  it('returns HTTP 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('returns ok: true', async () => {
    const res = await request(app).get('/health');
    expect(res.body.ok).toBe(true);
  });

  it('includes status: ok in data', async () => {
    const res = await request(app).get('/health');
    expect(res.body.data.status).toBe('ok');
  });

  it('includes a timestamp in ISO 8601 format', async () => {
    const res = await request(app).get('/health');
    const ts: unknown = res.body.data?.timestamp;
    expect(typeof ts).toBe('string');
    expect(new Date(ts as string).toISOString()).toBe(ts);
  });

  it('includes services.database field', async () => {
    const res = await request(app).get('/health');
    expect(['ok', 'error', 'unknown']).toContain(res.body.data?.services?.database);
  });

  it('does not expose stack traces or internal config', async () => {
    const res = await request(app).get('/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/password/i);
    expect(body).not.toMatch(/DATABASE_URL/i);
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/stack/i);
  });

  it('returns JSON content-type', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('Security headers', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('does not expose X-Powered-By', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('404 handling', () => {
  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent-route-xyz');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('does not leak route information in 404 body', async () => {
    const res = await request(app).get('/api/nonexistent-route-xyz');
    expect(JSON.stringify(res.body)).not.toMatch(/stack/i);
  });
});

describe('GET /api/dashboard (stub)', () => {
  it('returns 200 with ok: true', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
