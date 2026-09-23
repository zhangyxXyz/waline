import { describe, expect, it } from 'vitest';

import { restoreEmoji } from './restoreEmoji.js';

describe(restoreEmoji, () => {
  const map = {
    bb_heart_eyes: '/resource/static/npm/%40waline/emojis%401.4.0/bilibili/bb_heart_eyes.png',
  };
  const image =
    '<img class="emoji" src="https://cdn.onlyzyx.com/static/npm/@waline/emojis@1.3.0/bilibili/bb_heart_eyes.png" alt="old">';

  it('matches mirrors and versions by package path', () => {
    expect(restoreEmoji(`Hello ${image}`, map)).toBe('Hello :bb_heart_eyes:');
    expect(restoreEmoji(image.replace('emojis@1.3.0', 'emojis'), map)).toBe(':bb_heart_eyes:');
  });

  it('preserves unknown images and code examples', () => {
    expect(restoreEmoji(image.replace('bb_heart_eyes.png', 'unknown.png'), map)).toContain('<img');
    const code = `\`\`\`html\n${image}\n\`\`\`\n\`${image}\``;
    expect(restoreEmoji(code, map)).toBe(code);
    expect(restoreEmoji(image, {})).toBe(image);
  });
});
