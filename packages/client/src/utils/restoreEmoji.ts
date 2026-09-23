import type { WalineEmojiMaps } from '../typings/index.js';

// Compare package-relative paths across CDN/local mirrors and package versions.
const emojiPath = (url: string): string | undefined => {
  try {
    const path = decodeURIComponent(url).split(/[?#]/u)[0];
    return /(?:^|\/)@waline\/emojis(?:@[^/]+)?\/(.+)$/u.exec(path)?.[1];
  } catch {
    return undefined;
  }
};

export const restoreEmoji = (text: string, emojiMap: WalineEmojiMaps): string => {
  const keys = new Map<string, string>();
  for (const [key, url] of Object.entries(emojiMap)) {
    const path = emojiPath(url);
    if (path) keys.set(path, key);
  }
  // Leave fenced/inline code examples and unknown images untouched.
  return text.replaceAll(
    /(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\2[^\n]*(?:\n|$))|(`+)[^`]*?\3|<img\b[^>]*>/gimu,
    (raw) => {
      if (!/^<img\b/iu.test(raw)) return raw;
      const source = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(raw);
      const path = emojiPath(source?.[1] ?? source?.[2] ?? source?.[3] ?? '');
      const key = path ? keys.get(path) : undefined;
      return key ? `:${key}:` : raw;
    },
  );
};
