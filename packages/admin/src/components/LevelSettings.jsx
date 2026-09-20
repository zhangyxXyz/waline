import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import request from '../utils/request.js';

export default function LevelSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    request('comment?type=level-settings')
      .then((data) => {
        if (active) setSettings({ enabled: data.enabled, levels: data.levels });
      })
      .catch(() => {
        if (active) setMessage('levels.loadFailed');
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async (event) => {
    event.preventDefault();
    const valid = settings.levels.every(
      (row, index, rows) =>
        Number.isSafeInteger(row.min) &&
        row.min >= 0 &&
        row.min <= 1000000000 &&
        (index === 0 ? row.min === 0 : row.min > rows[index - 1].min) &&
        row.label.trim().length <= 40,
    );
    if (!valid) {
      setMessage('levels.invalid');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const data = await request('comment?type=level-settings', {
        method: 'PUT',
        body: settings,
      });
      setSettings({ enabled: data.enabled, levels: data.levels });
      setMessage('levels.saved');
    } catch {
      setMessage('levels.saveFailed');
    } finally {
      setBusy(false);
    }
  };
  const update = (index, key, value) =>
    setSettings((current) => ({
      ...current,
      levels: current.levels.map((row, position) =>
        position === index ? { ...row, [key]: value } : row,
      ),
    }));
  return (
    <section className="waline-level-settings" aria-busy={busy}>
      <p>{t('levels.description')}</p>
      {settings && (
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <label className="waline-level-toggle">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
              />{' '}
              {t('levels.enabled')}
            </label>
            <div className="waline-level-rows">
              {settings.levels.map((row, index) => (
                <div className="waline-level-row" key={index}>
                  <span>{t('levels.number', { number: index })}</span>
                  <label>
                    {t('levels.minimum')}
                    <input
                      type="number"
                      min="0"
                      max="1000000000"
                      step="1"
                      required
                      value={row.min}
                      readOnly={index === 0}
                      onChange={(event) =>
                        update(
                          index,
                          'min',
                          event.target.value === '' ? '' : Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    {t('levels.label')}
                    <input
                      type="text"
                      maxLength="40"
                      value={row.label}
                      placeholder={t('levels.placeholder')}
                      onChange={(event) => update(index, 'label', event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={index === 0}
                    aria-label={t('levels.removeNumber', { number: index })}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        levels: settings.levels.filter((_, position) => position !== index),
                      })
                    }
                  >
                    {t('levels.remove')}
                  </button>
                </div>
              ))}
            </div>
            <div className="waline-database-actions">
              <button
                type="button"
                className="btn"
                disabled={settings.levels.length >= 20}
                onClick={() =>
                  setSettings({
                    ...settings,
                    levels: [
                      ...settings.levels,
                      {
                        min: Number(settings.levels.at(-1).min) + 10,
                        label: '',
                      },
                    ],
                  })
                }
              >
                {t('levels.add')}
              </button>
              <button type="submit" className="btn">
                {t(busy ? 'management.saving' : 'management.save')}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <p className="waline-settings-tip">{t('levels.priority')}</p>
      <p className="waline-settings-tip">{t('levels.languageTip')}</p>
      <p className="waline-settings-tip">{t('levels.countTip')}</p>
      <output aria-live="polite">{message && t(message)}</output>
    </section>
  );
}
