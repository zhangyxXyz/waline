import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import request from '../utils/request.js';

export default function RegionDatabase() {
  const { t, i18n } = useTranslation();
  const date = (value) =>
    value
      ? new Date(value).toLocaleString(
          i18n.language === 'jp' || i18n.language === 'jp-JP' ? 'ja-JP' : i18n.language,
        )
      : t('database.noRecord');
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    let timeout;
    const refresh = async () => {
      try {
        const next = await request('comment?type=region-database');
        if (!active) return;
        setData(next);
        if (!next.running) {
          setMessage((current) => (current === 'database.started' ? '' : current));
        }
        setConfig(
          (current) =>
            current || {
              source: next.source,
              interval: next.interval,
              route: next.route || 'official',
              customType: next.customType || 'prefix',
              customURL: next.customURL || '',
            },
        );
      } catch {
        if (active) setMessage('database.loadFailed');
      } finally {
        if (active) timeout = setTimeout(refresh, 3000);
      }
    };
    refresh();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, []);
  const save = async (update = false) => {
    setBusy(true);
    setMessage('');
    try {
      let next = await request('comment?type=region-database', {
        method: 'PUT',
        body: config,
      });
      if (update)
        next = await request('comment?type=region-database-update', {
          method: 'POST',
        });
      setData(next);
      setMessage(update ? 'database.started' : 'database.saved');
    } catch {
      setMessage('database.failed');
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || data?.running || data?.external;
  const [connection, setConnection] = useState('');
  const testConnection = async () => {
    setBusy(true);
    setConnection(t('download.testing'));
    try {
      const result = await request('settings?section=download-test', {
        method: 'POST',
        body: config,
      });
      setConnection(t('download.success', { status: result.status, elapsed: result.elapsed }));
    } catch (error) {
      setConnection(`${t('download.failed')}: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="waline-region-settings waline-region-database" aria-busy={busy}>
      <h3>{t('database.title')}</h3>
      {config && (
        <>
          <div className="waline-region-settings-fields">
            <label>
              {t('database.source')}{' '}
              <select
                defaultValue="ip2region"
                disabled={disabled}
                aria-label={t('database.source')}
              >
                <option value="ip2region">ip2region</option>
              </select>
            </label>
            <label>
              {t('database.version')}{' '}
              <select
                value={config.source}
                disabled={disabled}
                onChange={(event) => setConfig({ ...config, source: event.target.value })}
              >
                <option value="bundled">{t('database.bundled')}</option>
                <option value="official">{t('database.official')}</option>
              </select>
            </label>
            <small>{t('database.languageTip')}</small>
            {config.source === 'official' ? (
              <>
                <label>
                  {t('download.route')}{' '}
                  <select
                    value={config.route}
                    disabled={disabled}
                    onChange={(event) => setConfig({ ...config, route: event.target.value })}
                  >
                    {['official', 'ghproxy', 'custom'].map((route) => (
                      <option key={route} value={route}>
                        {t(`download.${route}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {config.route === 'custom' && (
                  <>
                    <label>
                      {t('download.type')}{' '}
                      <select
                        disabled={disabled}
                        value={config.customType}
                        onChange={(event) =>
                          setConfig({ ...config, customType: event.target.value })
                        }
                      >
                        <option value="prefix">{t('download.prefix')}</option>
                        <option value="url">{t('download.url')}</option>
                      </select>
                    </label>
                    <label>
                      {t('download.address')}{' '}
                      <input
                        type="url"
                        disabled={disabled}
                        value={config.customURL}
                        placeholder={
                          config.customType === 'prefix'
                            ? 'https://proxy.example.com/'
                            : 'https://example.com/ipv4_source.txt'
                        }
                        onChange={(event) =>
                          setConfig({ ...config, customURL: event.target.value })
                        }
                      />
                    </label>
                  </>
                )}
                <small>{t('download.tip')}</small>
                <button type="button" className="btn" disabled={disabled} onClick={testConnection}>
                  {t('download.test')}
                </button>
                <output aria-live="polite">{connection}</output>
                <label>
                  {t('database.schedule')}{' '}
                  <select
                    value={config.interval}
                    disabled={disabled}
                    onChange={(event) => setConfig({ ...config, interval: event.target.value })}
                  >
                    {['off', 'daily', 'weekly'].map((interval) => (
                      <option key={interval} value={interval}>
                        {t(`database.${interval}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <small>{t('database.updateTip')}</small>
              </>
            ) : (
              <small>{t('database.bundledTip')}</small>
            )}
            <div className="waline-database-actions">
              <button type="button" className="btn" disabled={disabled} onClick={() => save()}>
                {t(busy ? 'database.processing' : 'database.save')}
              </button>
              {config.source === 'official' && (
                <button
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={() => save(true)}
                >
                  {t(data?.running ? 'database.updating' : 'database.updateNow')}
                </button>
              )}
            </div>
          </div>
          <dl className="waline-database-status">
            <dt>{t('database.active')}</dt>
            <dd>{t(`database.${data.active}`)}</dd>
            {data.version && (
              <>
                <dt>{t('database.downloaded')}</dt>
                <dd>
                  <code title={data.version}>{data.version.slice(0, 12)}</code>
                </dd>
              </>
            )}
            <dt>{t('database.checked')}</dt>
            <dd>{date(data.checkedAt)}</dd>
            <dt>{t('database.updated')}</dt>
            <dd>{date(data.updatedAt)}</dd>
          </dl>
          {data.external && <p>{t('database.externalTip')}</p>}
          {data.running && data.phase && (
            <p role="status">
              {t(`download.${data.phase}`)}{' '}
              {data.downloadedBytes != null && `${(data.downloadedBytes / 1048576).toFixed(2)} MiB`}
              {data.totalBytes ? ` / ${(data.totalBytes / 1048576).toFixed(2)} MiB` : ''}
            </p>
          )}
          {!data.running && data.error && (
            <p className="waline-download-error">
              {t('download.reason')}: {data.error}
            </p>
          )}
          <p role="status">
            {data.running
              ? t('database.running')
              : data.error
                ? t('database.updateFailed')
                : data.checkedAt
                  ? t('database.current')
                  : ''}
          </p>
        </>
      )}
      <output aria-live="polite">{message && t(message)}</output>
    </section>
  );
}
