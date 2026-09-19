import React, { useEffect, useState } from 'react';

import request from '../utils/request.js';

export default function RegionSettings() {
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
        if (active) setMessage('无法读取属地设置，请刷新重试');
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await request('comment?type=region-settings', { method: 'PUT', body: settings });
      setMessage('已保存，新的评论请求立即生效');
    } catch {
      setMessage('保存失败，请检查服务器持久化目录权限后重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="waline-region-settings">
      <h3>属地显示设置</h3>
      {settings && (
        <div className="waline-region-settings-fields">
          <label>
            访客可见精度{' '}
            <select
              value={settings.level}
              disabled={busy}
              onChange={(event) => setSettings({ ...settings, level: event.target.value })}
            >
              <option value="off">不显示</option>
              <option value="country">国家</option>
              <option value="province">省／地区</option>
              <option value="city">城市</option>
              <option value="isp">城市与运营商</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.country}
              disabled={busy || settings.level === 'off' || settings.level === 'country'}
              onChange={(event) => setSettings({ ...settings, country: event.target.checked })}
            />{' '}
            附带国家
          </label>
          <button type="button" className="btn" disabled={busy} onClick={save}>
            {busy ? '保存中…' : '保存'}
          </button>
          <small>只影响普通访客；管理员仍可查看完整 IP 和详细属地。</small>
        </div>
      )}
      <output aria-live="polite">{message}</output>
    </section>
  );
}
