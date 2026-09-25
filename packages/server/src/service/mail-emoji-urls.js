const { JSDOM } = require('jsdom');
const settings = require('./dashboard-settings.js');

// Normalize only @ escapes used by npm CDN paths; never decode path separators.
const pathKey = (value) => value.replaceAll(/%40/giu, '@');
const directory = (value) => {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value)) {
    throw settings.invalid();
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw settings.invalid();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/')
  ) {
    throw settings.invalid();
  }
  url.pathname = pathKey(url.pathname);
  return url.href;
};
const read = () => settings.read().mailEmojiUrls || { enabled: false, rules: [] };
const save = (value) => {
  if (
    typeof value?.enabled !== 'boolean' ||
    !Array.isArray(value.rules) ||
    value.rules.length > 20
  ) {
    throw settings.invalid();
  }
  const rules = value.rules.map((rule) => ({
    from: directory(rule?.from),
    to: directory(rule?.to),
  }));
  if (new Set(rules.map(({ from }) => from)).size !== rules.length) throw settings.invalid();
  return settings.save('mailEmojiUrls', { enabled: value.enabled, rules });
};
const replaceUrl = (value, rules) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return value;
  url.pathname = pathKey(url.pathname);
  for (const rule of rules) {
    if (url.href.startsWith(rule.from)) return rule.to + url.href.slice(rule.from.length);
  }
  return value;
};
const rewrite = (html) => {
  const config = read();
  if (!config.enabled || !config.rules.length || typeof html !== 'string') return html;
  // Parse inertly, but patch only source attributes. Reserializing the document
  // would alter email tables, conditional comments and template formatting.
  const dom = new JSDOM(html, { includeNodeLocations: true });
  try {
    const replacements = [];
    for (const img of dom.window.document.querySelectorAll('img.wl-emoji[src]')) {
      const src = img.getAttribute('src');
      const next = replaceUrl(src, config.rules);
      const location = dom.nodeLocation(img)?.attrs?.src;
      if (next === src || !location) continue;
      const escaped = next
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;');
      replacements.push({ ...location, text: `src="${escaped}"` });
    }
    for (const { startOffset, endOffset, text } of replacements.sort(
      (a, b) => b.startOffset - a.startOffset,
    )) {
      html = html.slice(0, startOffset) + text + html.slice(endOffset);
    }
    return html;
  } finally {
    dom.window.close();
  }
};

module.exports = { read, save, rewrite };
