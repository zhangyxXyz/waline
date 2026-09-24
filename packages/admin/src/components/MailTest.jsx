import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import request from '../utils/request.js';

export default function MailTest({ template, disabled = false }) {
  const { t } = useTranslation();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await request('settings?section=mail-test', {
        method: 'POST',
        body: { to, template },
      });
      const reasons = [
        'recipient',
        'template',
        'disabled',
        'rate',
        'rejected',
        'auth',
        'connection',
        'failed',
      ];
      setMessage(
        result.sent
          ? 'mailTest.sent'
          : `mailTest.${reasons.includes(result.reason) ? result.reason : 'failed'}`,
      );
    } catch {
      setMessage('mailTest.failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="waline-mail-test" disabled={busy || disabled}>
      <legend>{t('mailTest.title')}</legend>
      <p>{t(template ? 'mailTest.templateTip' : 'mailTest.smtpTip')}</p>
      <label className="waline-smtp-field">
        {t('mailTest.to')}
        <input
          type="email"
          value={to}
          maxLength={320}
          onChange={(event) => {
            setTo(event.target.value);
            setMessage('');
          }}
        />
      </label>
      <button type="button" className="btn" disabled={!to.trim()} onClick={send}>
        {t(busy ? 'mailTest.sending' : 'mailTest.send')}
      </button>
      <p role="status" aria-live="polite">
        {message && t(message)}
      </p>
    </fieldset>
  );
}
