import type { BaseAPIOptions } from './utils.js';
import { getFetchPrefix } from './utils.js';

/**
 * Read only the public upload-tool policy; no image-host credentials are exposed.
 *
 * @returns Whether the server allows client upload tools.
 */
export const getImageUploadSettings = async ({
  serverURL,
  signal,
}: Pick<BaseAPIOptions, 'serverURL'> & { signal?: AbortSignal }): Promise<boolean> => {
  const response = await fetch(`${getFetchPrefix(serverURL)}comment?type=image-upload`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('Could not load image upload settings');
  const result = (await response.json()) as { errno?: number; data?: { enabled?: boolean } };
  return result.errno === 0 && result.data?.enabled === true;
};
