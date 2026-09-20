import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import request from '../utils/request.js';

export default function RegionSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    request('comment?type=region-settings')
      .then((data) => {
        if (active) setSettings({ level: data.level, country: data.country });
      })
      .catch(() => {
        if (active) setMessage('region.loadFailed');
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await request('comment?type=region-settings', {
        method: 'PUT',
        body: settings,
      });
      setMessage('levels.saved');
    } catch {
      setMessage('region.saveFailed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="waline-region-settings">
      <h3>{t('region.settings')}</h3>
      {settings && (
        <div className="waline-region-settings-fields">
          <label>
            {t('region.precision')}{' '}
            <select
              value={settings.level}
              disabled={busy}
              onChange={(event) => setSettings({ ...settings, level: event.target.value })}
            >
              {['off', 'country', 'province', 'city', 'isp'].map((level) => (
                <option key={level} value={level}>
                  {t(`region.${level}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.country}
              disabled={busy || settings.level === 'off' || settings.level === 'country'}
              onChange={(event) => setSettings({ ...settings, country: event.target.checked })}
            />{' '}
            {t('region.includeCountry')}
          </label>
          <button type="button" className="btn" disabled={busy} onClick={save}>
            {t(busy ? 'management.saving' : 'management.save')}
          </button>
          <small>{t('region.visibilityTip')}</small>
        </div>
      )}
      <output aria-live="polite">{message && t(message)}</output>
    </section>
  );
}
