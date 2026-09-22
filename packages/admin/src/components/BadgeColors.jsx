import React from 'react';
import { useTranslation } from 'react-i18next';

export default function BadgeColors({ colors = {}, onChange }) {
  const { t } = useTranslation();
  const update = (mode, key, value) =>
    onChange({ ...colors, [mode]: { ...colors[mode], [key]: value } });
  return (
    <div>
      <p className="waline-settings-tip">{t('levels.colorsHint')}</p>
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
                flexWrap: 'wrap',
              }}
            >
              {t(`badgeColors.${key}`)}
              <input
                type="color"
                aria-label={`${t(`badgeColors.${mode}`)} ${t(`badgeColors.${key}`)}`}
                value={
                  /^#[\da-f]{6}$/iu.test(colors[mode]?.[key] || '') ? colors[mode][key] : '#808080'
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
    </div>
  );
}
