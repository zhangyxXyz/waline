import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Header from '../../components/Header.jsx';
import { LANGUAGE_OPTIONS } from '../../locales/index.js';
import request from '../../utils/request.js';

import './style.css';

export default function Mail() {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState('reply');
  const normalizeLanguage = (value) =>
    ({ en: 'en-us', 'es-mx': 'es', 'ko-kr': 'ko', 'jp-jp': 'jp', 'vi-vn': 'vi' })[
      value.toLowerCase()
    ] || value.toLowerCase();
  const [language, setLanguage] = useState(() => normalizeLanguage(i18n.language || 'en-US'));
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const subject = useRef(null);
  const body = useRef(null);
  const target = useRef('body');
  useEffect(() => {
    let active = true;
    setData(null);
    setMessage('');
    setPreview(null);
    request(`settings?section=mail&language=${language}&kind=${kind}`)
      .then((value) => {
        if (active) {
          setData(value);
          setDirty(false);
        }
      })
      .catch(() => active && setMessage('settings.failed'));
    return () => {
      active = false;
    };
  }, [kind, language]);
  const change = (setter, value) => {
    if (!dirty || confirm(t('mail.discard'))) setter(value);
  };
  const edit = (key, value) => {
    setData({ ...data, [key]: value });
    setDirty(true);
    setPreview(null);
    setMessage('');
  };
  const insert = (key) => {
    const field = target.current;
    if (field === 'subject' && key.endsWith('.comment')) return;
    const element = field === 'subject' ? subject.current : body.current;
    const text = `{{${key}${key.endsWith('.comment') ? ' | safe' : ''}}}`;
    const start = element.selectionStart ?? data[field].length;
    const end = element.selectionEnd ?? start;
    edit(field, data[field].slice(0, start) + text + data[field].slice(end));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const action = async (mode) => {
    if (mode === 'reset' && !confirm(t('mail.resetConfirm'))) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await request(
        `settings?section=${mode === 'preview' ? 'mail-preview' : 'mail'}`,
        {
          method: mode === 'preview' ? 'POST' : 'PUT',
          body: { language, kind, subject: data.subject, body: data.body, reset: mode === 'reset' },
        },
      );
      if (mode === 'preview') setPreview(result);
      else {
        setData(result);
        setDirty(false);
        setPreview(null);
        setMessage('settings.saved');
      }
    } catch {
      setMessage('mail.invalid');
    } finally {
      setBusy(false);
    }
  };
  const variables = [
    'site.name',
    'site.url',
    'site.postUrl',
    'self.nick',
    'self.comment',
    ...(kind === 'reply' ? ['parent.nick', 'parent.comment'] : []),
  ];
  return (
    <>
      <Header />
      <div className="main">
        <div className="body container">
          <nav className="waline-management-tabs">
            {['reply', 'admin'].map((value) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                aria-pressed={kind === value}
                onClick={() => change(setKind, value)}
              >
                {t(`mail.${value}`)}
              </button>
            ))}
          </nav>
          <div className="typecho-page-title">
            <h2>{t('mail.title')}</h2>
          </div>
          <section className="waline-region-settings waline-mail-editor">
            <label>
              {t('mail.language')}{' '}
              <select
                disabled={busy}
                value={language}
                onChange={(event) => change(setLanguage, event.target.value)}
              >
                {[
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
                ].map((lang) => (
                  <option key={lang} value={lang}>
                    {LANGUAGE_OPTIONS.find(({ value }) => normalizeLanguage(value) === lang)
                      ?.label || lang}
                  </option>
                ))}
              </select>
            </label>
            <p>{t('mail.tip')}</p>
            {data && (
              <fieldset disabled={busy}>
                <label>
                  {t('mail.subject')}
                  <input
                    ref={subject}
                    value={data.subject}
                    maxLength={300}
                    onFocus={() => {
                      target.current = 'subject';
                    }}
                    onChange={(event) => edit('subject', event.target.value)}
                  />
                </label>
                <label>
                  {t('mail.body')}
                  <textarea
                    ref={body}
                    rows={15}
                    value={data.body}
                    maxLength={100000}
                    onFocus={() => {
                      target.current = 'body';
                    }}
                    onChange={(event) => edit('body', event.target.value)}
                  />
                </label>
                <p>{t('mail.variables')}</p>
                <div className="waline-variable-tags">
                  {variables.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="btn"
                      title={`{{${key}}}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insert(key)}
                    >
                      {t(`mail.${key}`)}
                    </button>
                  ))}
                </div>
                <div className="waline-database-actions">
                  <button type="button" className="btn primary" onClick={() => action('save')}>
                    {t('settings.save')}
                  </button>
                  <button type="button" className="btn" onClick={() => action('preview')}>
                    {t('mail.preview')}
                  </button>
                  <button type="button" className="btn" onClick={() => action('reset')}>
                    {t('mail.reset')}
                  </button>
                </div>
              </fieldset>
            )}
            <p role="status">{message && t(message)}</p>
            {preview && (
              <>
                <h3>{preview.subject}</h3>
                <iframe
                  title={t('mail.preview')}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>body{font-family:Arial,sans-serif;color:#222;background:white;overflow-wrap:anywhere}</style>${preview.body}`}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
