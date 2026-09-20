import type { WalineComment } from '@waline/api';

import type { WalineLocale } from '../typings/index.js';

export const getLevelLabel = (
  comment: Pick<WalineComment, 'level' | 'levelLabel'>,
  locale: Partial<WalineLocale>,
  overrides: Partial<WalineLocale>,
): string => {
  const key: `level${number}` = `level${comment.level ?? 0}`;
  return overrides[key] ?? comment.levelLabel ?? locale[key] ?? `Level ${comment.level}`;
};
