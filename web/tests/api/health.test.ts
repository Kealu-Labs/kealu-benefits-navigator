/**
 * Black-box API route tests for GET /api/health
 *
 * These tests FAIL before implementation (route does not exist).
 * Tests treat the route as a black box: only HTTP contract is asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/kvr-checker', () => ({
  checkKvrVersion: vi.fn(),
  checkCmsApiKey: vi.fn(),
  resolveKvr: vi.fn(),
  logStartupChecks: vi.fn(),
}));

import { checkKvrVersion, checkCmsApiKey } from '@/lib/kvr-checker';
const mockCheckKvrVersion = vi.mocked(checkKvrVersion);
const mockCheckCmsApiKey = vi.mocked(checkCmsApiKey);

// This import fails until web/src/app/api/health/route.ts is created.
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns HTTP 200 always', async () => {
    mockCheckKvrVersion.mockReturnValue({ ok: true, version: '0.225.0', path: '/usr/local/bin/kvr' });
    mockCheckCmsApiKey.mockReturnValue(true);

    const res = await GET();

    expect(res.status).toBe(200);
  });

  it("returns {kvr:'ok', cms_api_key:'set', version:'...'} when both are present", async () => {
    mockCheckKvrVersion.mockReturnValue({ ok: true, version: '0.225.0', path: '/usr/local/bin/kvr' });
    mockCheckCmsApiKey.mockReturnValue(true);

    const res = await GET();
    const body = await res.json();

    expect(body.kvr).toBe('ok');
    expect(body.cms_api_key).toBe('set');
    expect(body.version).toBe('0.225.0');
  });

  it("returns {kvr:'missing', cms_api_key:'unset', version:''} when both are absent", async () => {
    mockCheckKvrVersion.mockReturnValue({ ok: false, version: '', path: null, error: 'not found' });
    mockCheckCmsApiKey.mockReturnValue(false);

    const res = await GET();
    const body = await res.json();

    expect(body.kvr).toBe('missing');
    expect(body.cms_api_key).toBe('unset');
    expect(body.version).toBe('');
  });

  it('response body does NOT contain any filesystem path string', async () => {
    mockCheckKvrVersion.mockReturnValue({ ok: true, version: '0.225.0', path: '/usr/local/bin/kvr' });
    mockCheckCmsApiKey.mockReturnValue(true);

    const res = await GET();
    const body = await res.json();
    const bodyString = JSON.stringify(body);

    // The path field should NOT be in the response body
    expect(bodyString).not.toContain('/usr/local/bin/kvr');
    expect(bodyString).not.toContain('/usr/');
    expect(bodyString).not.toContain('path');
  });

  it('returns Content-Type: application/json', async () => {
    mockCheckKvrVersion.mockReturnValue({ ok: true, version: '0.225.0', path: '/usr/local/bin/kvr' });
    mockCheckCmsApiKey.mockReturnValue(true);

    const res = await GET();

    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
