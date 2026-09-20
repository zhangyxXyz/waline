const store = require('./dashboard-settings.js');
const locales = require('../locales/index.js');

const languages = [
  'zh-cn',
  'zh-tw',
  'en-us',
  'de',
  'es',
  'fr',
  'id',
  'it',
  'jp',
  'ko',
  'pt-br',
  'ru',
  'vi',
];
const language = (value = 'en-us') => {
  const lang = String(value).toLowerCase();
  return (
    {
      en: 'en-us',
      'es-mx': 'es',
      esmx: 'es',
      'ko-kr': 'ko',
      'jp-jp': 'jp',
      'ja-jp': 'jp',
      'fr-fr': 'fr',
      'id-id': 'id',
      'it-it': 'it',
      'ru-ru': 'ru',
      'vi-vn': 'vi',
    }[lang] || lang
  );
};
const fields = new Set([
  'site.name',
  'site.url',
  'site.postUrl',
  'self.nick',
  'self.comment',
  'parent.nick',
  'parent.comment',
]);
const token = /\{\{\s*([\w.]+)(\s*\|\s*safe)?\s*\}\}/gu;
const validate = (value) => {
  const lang = language(value?.language);
  if (
    !languages.includes(lang) ||
    !['reply', 'admin'].includes(value?.kind) ||
    typeof value.subject !== 'string' ||
    typeof value.body !== 'string' ||
    !value.subject.trim() ||
    !value.body.trim() ||
    value.subject.length > 300 ||
    value.body.length > 100000 ||
    /[\r\n]/u.test(value.subject)
  ) {
    throw store.invalid();
  }
  for (const [part, source] of [
    ['subject', value.subject],
    ['body', value.body],
  ]) {
    const remainder = source.replace(token, (match, key, safe) => {
      if (
        !fields.has(key) ||
        (value.kind === 'admin' && key.startsWith('parent.')) ||
        (part === 'subject' && key.endsWith('.comment')) ||
        (safe && !key.endsWith('.comment'))
      ) {
        throw store.invalid();
      }
      return '';
    });
    // Dashboard templates deliberately allow variable insertion, not executable template expressions.
    if (/\{\{|\}\}|\{%|\{#/u.test(remainder)) throw store.invalid();
  }
  return { language: lang, kind: value.kind, subject: value.subject, body: value.body };
};
const defaults = (lang, kind, config = {}) => {
  const suffix = kind === 'admin' ? '_ADMIN' : '';
  const pick = (key) =>
    config.locales?.[lang]?.[key] ||
    locales[lang === 'es' ? 'esMX' : lang]?.[key] ||
    locales['en-us'][key];
  return {
    subject: (
      config[kind === 'admin' ? 'mailSubjectAdmin' : 'mailSubject'] || pick(`MAIL_SUBJECT${suffix}`)
    ).replaceAll(/\s*\|\s*safe/gu, ''),
    body:
      config[kind === 'admin' ? 'mailTemplateAdmin' : 'mailTemplate'] ||
      pick(`MAIL_TEMPLATE${suffix}`),
  };
};
const get = (lang, kind, config = {}) => {
  lang = language(lang);
  if (!languages.includes(lang) || !['reply', 'admin'].includes(kind)) throw store.invalid();
  const saved = store.read().mail?.[lang]?.[kind];
  return {
    language: lang,
    kind,
    languages,
    custom: Boolean(saved),
    ...(saved || defaults(lang, kind, config)),
    defaults: defaults(lang, kind, config),
  };
};
const save = (value, config) => {
  const current = get(value?.language, value?.kind, config);
  const mail = store.read().mail || {};
  const group = { ...mail[current.language] };
  if (value.reset === true) delete group[current.kind];
  else {
    const { subject, body } = validate(value);
    group[current.kind] = { subject, body };
  }
  store.save('mail', { ...mail, [current.language]: group });
  return get(current.language, current.kind, config);
};
const escape = (value) =>
  String(value ?? '').replaceAll(
    /[&<>"']/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const render = (template, data) => {
  const fill = (text, html) =>
    text.replace(token, (_match, key, safe) => {
      const [object, property] = key.split('.');
      const value = data[object]?.[property] ?? '';
      return html && !safe ? escape(value) : String(value);
    });
  return {
    subject: fill(template.subject, false).replaceAll(/[\r\n]/gu, ' '),
    body: fill(template.body, true),
  };
};
const preview = (value) => {
  const template = validate(value);
  const chinese = template.language.startsWith('zh');
  return render(template, {
    site: {
      name: process.env.SITE_NAME || 'Waline',
      url: 'https://example.invalid/',
      postUrl: 'https://example.invalid/post#comment',
    },
    self: {
      nick: chinese ? '示例评论者' : 'Example commenter',
      comment: chinese
        ? '<p>感谢分享，这是一条示例评论。</p>'
        : '<p>Thanks for sharing. This is a sample comment.</p>',
    },
    parent: {
      nick: chinese ? '示例读者' : 'Example reader',
      comment: chinese ? '<p>这是被回复的原评论。</p>' : '<p>This is the original comment.</p>',
    },
  });
};
module.exports = { language, languages, validate, get, save, render, preview };
