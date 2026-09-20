import { describe, expect, it, vi } from 'vitest';

import { getImageUploadSettings } from './imageUpload.js';

describe('public image upload policy', () => {
  it.each([true, false])('reads the explicit server switch: %s', async (enabled) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ errno: 0, data: { enabled } })));
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(
        getImageUploadSettings({ serverURL: 'https://example.test/nested' }),
      ).resolves.toBe(enabled);
      expect(fetcher.mock.calls[0][0]).toBe(
        'https://example.test/nested/api/comment?type=image-upload',
      );
      expect(fetcher.mock.calls[0][1]?.cache).toBe('no-store');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { errno: 0, data: { data: [] } },
    { errno: 403, data: { enabled: true } },
  ])('does not enable uploads for an old server or failed API result: %j', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    try {
      await expect(getImageUploadSettings({ serverURL: 'https://example.test' })).resolves.toBe(
        false,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
