import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import resources from './index.js';

describe('dashboard badge translations', () => {
  for (const language of Object.keys(resources)) {
    it(`resolves flat badge keys for ${language}`, async () => {
      const i18n = createInstance();
      await i18n.init({
        resources,
        lng: language,
        fallbackLng: 'zh-CN',
        ns: ['translations'],
        defaultNS: 'translations',
        keySeparator: false,
      });
      for (const key of ['light', 'dark', 'text', 'background', 'border', 'default', 'hint']) {
        const name = `badgeColors.${key}`;
        expect(i18n.t(name)).not.toBe(name);
        expect(i18n.t(name)).toBeTypeOf('string');
      }
      expect(i18n.t('badgeColors.light')).toBe(
        ['zh-CN', 'zh-cn', 'zh-TW'].includes(language) ? '亮色模式' : 'Light mode',
      );
    });
  }
});
