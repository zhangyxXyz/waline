import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updateUser } from '../services/user.js';

export default function LabelEditor({ user, onSave, onCancel }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(user.label || '');
  const [colors, setColors] = useState(user.labelColors || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const update = (mode, key, value) =>
    setColors((current) => ({
      ...current,
      [mode]: { ...current[mode], [key]: value },
    }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await updateUser({ id: user.objectId, label, labelColors: colors });
      onSave({ ...user, label, labelColors: label ? colors : {} });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="waline-level-settings" onSubmit={save} aria-busy={busy}>
      <h3>
        {t('set label')} · {user.display_name}
      </h3>
      <fieldset disabled={busy}>
        <label>
          {t('exclusive label')}{' '}
          <input value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <p>{t('badgeColors.hint')}</p>
        {['light', 'dark'].map((mode) => (
          <fieldset key={mode}>
            <legend>{t(`badgeColors.${mode}`)}</legend>
            {['text', 'background', 'border'].map((key) => (
              <label
                key={key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5em',
                  margin: '0.5em',
                }}
              >
                {t(`badgeColors.${key}`)}
                <input
                  type="color"
                  aria-label={`${t(`badgeColors.${mode}`)} ${t(`badgeColors.${key}`)}`}
                  value={
                    /^#[\da-f]{6}$/iu.test(colors[mode]?.[key] || '')
                      ? colors[mode][key]
                      : '#808080'
                  }
                  onChange={(event) => update(mode, key, event.target.value)}
                />
                <input
                  aria-label={`${t(`badgeColors.${mode}`)} ${t(`badgeColors.${key}`)} HEX`}
                  placeholder={t('badgeColors.default')}
                  value={colors[mode]?.[key] || ''}
                  pattern="#([a-fA-F0-9]{3}|[a-fA-F0-9]{4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})"
                  onChange={(event) => update(mode, key, event.target.value)}
                />
              </label>
            ))}
          </fieldset>
        ))}
        <button type="submit">{t('management.save')}</button>{' '}
        <button type="button" onClick={onCancel}>
          {t('cancel')}
        </button>
      </fieldset>
      {error && <p role="alert">{t('levels.saveFailed')}</p>}
    </form>
  );
}
