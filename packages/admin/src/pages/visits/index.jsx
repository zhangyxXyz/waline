import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Header from '../../components/Header.jsx';
import request from '../../utils/request.js';

export default function Visits() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState({});
  const [items, setItems] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    request(`settings?section=visits&page=${page}&search=${encodeURIComponent(search)}`)
      .then((value) => {
        if (active) {
          setData(value);
          setDrafts({});
        }
      })
      .catch(() => {
        if (active) setMessage('visits.failed');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [page, search, revision]);
  const run = async (operation) => {
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch {
      setMessage('visits.failed');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const edit = (row) =>
    run(async () => {
      await request('settings?section=visits', {
        method: 'PUT',
        body: { url: row.url, before: row.time, time: Number(drafts[row.url]) },
      });
      setMessage('visits.saved');
      setRevision((value) => value + 1);
    });
  const readFile = (file) =>
    run(async () => {
      setPreview(null);
      setItems(null);
      if (!file || file.size > 5 * 1024 * 1024) throw new Error('Invalid file');
      const parsed = JSON.parse(await file.text());
      const counters = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(counters)) throw new Error('Expected counters');
      setItems(counters);
      setPreview(
        await request('settings?section=visits-preview', {
          method: 'POST',
          body: { items: counters },
        }),
      );
    });
  const apply = () =>
    run(async () => {
      await request('settings?section=visits-import', {
        method: 'PUT',
        body: { items, token: preview.token },
      });
      setPreview(null);
      setItems(null);
      setMessage('visits.saved');
      setRevision((value) => value + 1);
    });
  return (
    <>
      <Header />
      <div className="main">
        <div className="body container">
          <div className="typecho-page-title">
            <h2>{t('visits.title')}</h2>
          </div>
          <section className="waline-region-settings" aria-busy={busy}>
            <p>{t('visits.description')}</p>
            {data && <p>{t('visits.total', { count: data.totalViews })}</p>}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSearch(query);
                setPage(1);
              }}
            >
              <label>
                {t('visits.path')}{' '}
                <input value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>{' '}
              <button className="btn" disabled={busy}>
                {t('visits.search')}
              </button>
            </form>
            <div style={{ overflowX: 'auto' }}>
              <table className="typecho-list-table">
                <thead>
                  <tr>
                    <th>{t('visits.path')}</th>
                    <th>{t('visits.count')}</th>
                    <th>{t('visits.edit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((row) => (
                    <tr key={row.objectId}>
                      <td style={{ overflowWrap: 'anywhere' }}>{row.url}</td>
                      <td>{row.time}</td>
                      <td>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void edit(row);
                          }}
                        >
                          <input
                            aria-label={`${t('visits.count')} ${row.url}`}
                            type="number"
                            min="0"
                            max="2147483647"
                            step="1"
                            required
                            style={{ width: '9em' }}
                            value={drafts[row.url] ?? row.time}
                            onChange={(event) =>
                              setDrafts({ ...drafts, [row.url]: event.target.value })
                            }
                          />{' '}
                          <button className="btn" disabled={busy || drafts[row.url] === undefined}>
                            {t('management.save')}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn" disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
              {t('visits.previous')}
            </button>{' '}
            <span>{page}</span>{' '}
            <button
              className="btn"
              disabled={busy || !data || page * 50 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              {t('visits.next')}
            </button>
          </section>
          <section className="waline-region-settings">
            <h3>{t('visits.import')}</h3>
            <p>{t('visits.importTip')}</p>
            <label>
              {t('visits.file')}{' '}
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => {
                  void readFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {preview && (
              <>
                <p>{t('visits.previewCount', { count: preview.rows.length })}</p>
                <div style={{ maxHeight: '24rem', overflow: 'auto' }}>
                  <table className="typecho-list-table">
                    <thead>
                      <tr>
                        <th>{t('visits.path')}</th>
                        <th>{t('visits.before')}</th>
                        <th>{t('visits.after')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.url}>
                          <td>{row.url}</td>
                          <td>{row.before}</td>
                          <td>{row.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className="btn" disabled={busy} onClick={apply}>
                  {t('visits.apply')}
                </button>
              </>
            )}
          </section>
          <output aria-live="polite">{message && t(message)}</output>
        </div>
      </div>
    </>
  );
}
