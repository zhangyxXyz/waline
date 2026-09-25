import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import request from '../utils/request.js';
import MailTest from './MailTest.jsx';

export default function SmtpSettings({ onDirty }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    let active = true;
    request('settings?section=smtp')
      .then((value) => {
        if (active) setData({ ...value, password: '', clearPassword: false });
      })
      .catch(() => active && setMessage('settings.failed'));
    return () => {
      active = false;
    };
  }, []);
  const edit = (key, value) => {
    setData({ ...data, [key]: value });
    onDirty(true);
    setDirty(true);
    setMessage('');
  };
  const save = async () => {
    setBusy(true);
    try {
      const value = await request('settings?section=smtp', { method: 'PUT', body: data });
      setData({ ...value, password: '', clearPassword: false });
      onDirty(false);
      setDirty(false);
      setMessage('settings.saved');
    } catch {
      setMessage('smtp.invalid');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="waline-region-settings waline-smtp-editor">
      <h3>{t('mail.smtp')}</h3>
      <p>{t('smtp.tip')}</p>
      {data && (
        <fieldset disabled={busy}>
          <label className="waline-setting-check">
            <input
              type="checkbox"
              checked={data.authorNotify}
              onChange={(e) => edit('authorNotify', e.target.checked)}
            />{' '}
            {t('smtp.authorNotify')}
          </label>
          <p>{t('smtp.authorNotifyTip')}</p>
          <label className="waline-setting-check">
            <input
              type="checkbox"
              checked={data.useEnvironment}
              onChange={(e) => edit('useEnvironment', e.target.checked)}
            />{' '}
            {t('smtp.useEnvironment')}
          </label>
          <fieldset disabled={data.useEnvironment}>
            <label className="waline-setting-check">
              <input
                type="checkbox"
                checked={data.enabled}
                onChange={(e) => edit('enabled', e.target.checked)}
              />{' '}
              {t('smtp.enabled')}
            </label>
            {['host', 'port', 'user', 'password', 'senderEmail', 'senderName', 'authorEmail'].map(
              (key) => (
                <label className="waline-smtp-field" key={key}>
                  {t(`smtp.${key}`)}
                  <input
                    type={
                      key === 'password'
                        ? 'password'
                        : key === 'port'
                          ? 'number'
                          : key.endsWith('Email')
                            ? 'email'
                            : 'text'
                    }
                    value={data[key]}
                    autoComplete={key === 'password' ? 'new-password' : 'off'}
                    placeholder={
                      key === 'password'
                        ? t(data.passwordConfigured ? 'smtp.passwordSaved' : 'smtp.passwordEmpty')
                        : undefined
                    }
                    min={key === 'port' ? 1 : undefined}
                    max={key === 'port' ? 65535 : undefined}
                    onChange={(e) =>
                      edit(key, key === 'port' ? Number(e.target.value) : e.target.value)
                    }
                  />
                </label>
              ),
            )}
            <p>{t(data.passwordConfigured ? 'smtp.passwordSaved' : 'smtp.passwordEmpty')}</p>
            <label className="waline-setting-check">
              <input
                type="checkbox"
                checked={data.clearPassword}
                onChange={(e) => edit('clearPassword', e.target.checked)}
              />{' '}
              {t('smtp.clearPassword')}
            </label>
            <label className="waline-setting-check">
              <input
                type="checkbox"
                checked={data.secure}
                onChange={(e) => edit('secure', e.target.checked)}
              />{' '}
              {t('smtp.secure')}
            </label>
            <p>{t('smtp.tlsTip')}</p>
          </fieldset>
          <button type="button" className="btn primary" onClick={save}>
            {t('settings.save')}
          </button>
        </fieldset>
      )}
      <p role="status">{message && t(message)}</p>
      {data && <MailTest disabled={busy || dirty} />}
    </section>
  );
}
