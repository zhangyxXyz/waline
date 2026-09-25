import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import request from '../utils/request.js';

let nextRuleId = 0;
const withIds = (value) => ({
  ...value,
  rules: value.rules.map((rule) => ({ ...rule, id: nextRuleId++ })),
});

export default function MailEmojiUrls({ onDirty }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    request('settings?section=mail-emoji-urls')
      .then((value) => active && setData(withIds(value)))
      .catch(() => active && setMessage('settings.failed'));
    return () => {
      active = false;
    };
  }, []);
  const edit = (value) => {
    setData(value);
    onDirty?.(true);
    setMessage('');
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const body = { ...data, rules: data.rules.map(({ from, to }) => ({ from, to })) };
      const result = await request('settings?section=mail-emoji-urls', { method: 'PUT', body });
      setData(withIds(result));
      onDirty?.(false);
      setMessage('settings.saved');
    } catch {
      setMessage('mail.emojiInvalid');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="waline-region-settings waline-smtp-editor">
      <p>{t('mail.emojiTip')}</p>
      {data && (
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <label>
              <input
                type="checkbox"
                checked={data.enabled}
                onChange={(event) => edit({ ...data, enabled: event.target.checked })}
              />{' '}
              {t('mail.emojiEnabled')}
            </label>
            {data.rules.map((rule, index) => (
              <div className="waline-emoji-rule" key={rule.id}>
                {['from', 'to'].map((field) => (
                  <label className="waline-smtp-field" key={field}>
                    {t(`mail.emoji${field === 'from' ? 'From' : 'To'}`)}
                    <input
                      type="url"
                      required
                      maxLength={2048}
                      value={rule[field]}
                      onChange={(event) =>
                        edit({
                          ...data,
                          rules: data.rules.map((item, position) =>
                            position === index ? { ...item, [field]: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    edit({ ...data, rules: data.rules.filter((_, position) => position !== index) })
                  }
                >
                  {t('mail.emojiRemove')}
                </button>
              </div>
            ))}
            <p>{t('mail.emojiOrder')}</p>
            <div className="waline-database-actions">
              <button
                type="button"
                className="btn"
                disabled={data.rules.length >= 20}
                onClick={() =>
                  edit({
                    ...data,
                    rules: [...data.rules, { id: nextRuleId++, from: '', to: '' }],
                  })
                }
              >
                {t('mail.emojiAdd')}
              </button>
              <button type="submit" className="btn primary">
                {t('settings.save')}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <output>{message && t(message)}</output>
    </section>
  );
}
