import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import request from '../utils/request.js';

export default function ServiceSettings({ section }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    request(`settings?section=${section}`)
      .then((value) => {
        if (!active) return;
        if (section === 'auth')
          value.providers = Object.fromEntries(
            value.services.map(({ name }) => [
              name,
              value.providers === null
                ? { login: true, bind: true }
                : value.providers[name] || { login: false, bind: false },
            ]),
          );
        setData(value);
      })
      .catch(() => active && setMessage('settings.failed'));
    return () => {
      active = false;
    };
  }, [section]);
  const save = async () => {
    setBusy(true);
    try {
      await request(`settings?section=${section}`, { method: 'PUT', body: data });
      if (section === 'auth') window.authSettings = data;
      setMessage('settings.saved');
    } catch {
      setMessage('settings.failed');
    } finally {
      setBusy(false);
    }
  };
  const check = (key, label, disabled = false) => (
    <label className="waline-setting-check">
      <input
        type="checkbox"
        checked={data[key]}
        disabled={busy || disabled}
        onChange={(event) => setData({ ...data, [key]: event.target.checked })}
      />{' '}
      {t(label)}
    </label>
  );
  return (
    <section className="waline-region-settings">
      <h3>{t(section === 'auth' ? 'settings.auth' : 'settings.comments')}</h3>
      {data && (
        <>
          {section === 'auth' ? (
            <>
              {check('registration', 'settings.registration')}
              {check('email', 'settings.email', !data.registration)}
              <p>{t('settings.registrationTip')}</p>
              <div className="typecho-table-wrap">
                <table className="typecho-list-table">
                  <thead>
                    <tr>
                      <th>{t('settings.provider')}</th>
                      <th>{t('settings.login')}</th>
                      <th>{t('settings.bind')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.services.map(({ name }) => (
                      <tr key={name}>
                        <td>{name}</td>
                        {['login', 'bind'].map((mode) => (
                          <td key={mode}>
                            <input
                              type="checkbox"
                              aria-label={`${name} ${t(`settings.${mode}`)}`}
                              checked={data.providers[name][mode]}
                              disabled={busy}
                              onChange={(event) =>
                                setData({
                                  ...data,
                                  providers: {
                                    ...data.providers,
                                    [name]: {
                                      ...data.providers[name],
                                      [mode]: event.target.checked,
                                    },
                                  },
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>{t('settings.providerTip')}</p>
            </>
          ) : (
            <>
              {check('enabled', 'settings.commentsEnabled')}
              {check('allowAdmin', 'settings.allowAdmin')}
              <p>{t('settings.commentsTip')}</p>
            </>
          )}
          <button className="btn primary" type="button" disabled={busy} onClick={save}>
            {t('settings.save')}
          </button>
        </>
      )}
      <p role="status">{message && t(message)}</p>
    </section>
  );
}
