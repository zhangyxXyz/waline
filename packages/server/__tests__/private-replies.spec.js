import fs from 'node:fs';
// oxlint-disable vitest/no-hooks
// Real HTTP authentication/controllers and MySQL WHERE compiler, with an
// isolated in-memory SQL transport. No production services are contacted.
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
process.env.MYSQL_DB = 'private_reply_test';
process.env.JWT_TOKEN = 'private-reply-test-secret';
process.env.IPQPS = '0';
const regionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-region-test-'));
process.env.REGION_SETTINGS_FILE = path.join(regionDirectory, 'settings.json');
process.env.DASHBOARD_SETTINGS_FILE = path.join(regionDirectory, 'dashboard.json');
const dashboard = require('../src/service/dashboard-settings.js');
const main = require('../index.js');
const jwt = require('jsonwebtoken');
const { Parser } = require('think-model-mysql');
const parser = new Parser();
const db = new DatabaseSync(':memory:');
const schema = `CREATE TABLE Comment (
 id INTEGER PRIMARY KEY, user_id INTEGER, comment TEXT, insertedAt TEXT, ip TEXT,
 link TEXT, mail TEXT, nick TEXT, pid INTEGER, rid INTEGER, sticky INTEGER,
 status TEXT DEFAULT 'approved', "like" INTEGER DEFAULT 0, ua TEXT, url TEXT,
 createdAt TEXT, updatedAt TEXT, visibility TEXT DEFAULT 'public',
 private_user_a INTEGER, private_user_b INTEGER);
 CREATE TABLE Users (id INTEGER PRIMARY KEY, display_name TEXT, email TEXT, url TEXT,
 type TEXT, avatar TEXT, "2fa" TEXT, label TEXT); CREATE TABLE Counter (id INTEGER PRIMARY KEY, url TEXT);`;
const sqlValue = (value) =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === 'boolean'
      ? Number(value)
      : (value ?? null);
const transport = (table) => {
  let where = {};
  let field = '*';
  let group, limit, order;
  let offset = 0;
  const query = {
    where(value) {
      where = value;
      return query;
    },
    field(value) {
      field = Array.isArray(value) ? value.map((key) => `\`${key}\``).join(',') : value;
      return query;
    },
    limit(start, size) {
      offset = start;
      limit = size;
      return query;
    },
    order(value) {
      order = value;
      return query;
    },
    group(value) {
      group = value;
      return query;
    },
    async select() {
      let sql = `SELECT ${field} FROM ${table}${parser.parseWhere(structuredClone(where))}`;
      if (group) sql += ` GROUP BY ${group.join(',')}`;
      if (order) {
        sql += ` ORDER BY ${Object.entries(order)
          .map(([key, value]) => `"${key}" ${value}`)
          .join(',')}`;
      }
      if (limit != null) sql += ` LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
      return db
        .prepare(sql)
        .all()
        .map((row) => ({ ...row }));
    },
    async count() {
      return db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}${parser.parseWhere(structuredClone(where))}`)
        .get().n;
    },
    async add(data) {
      const keys = Object.keys(data).filter((key) => data[key] !== undefined);
      return Number(
        db
          .prepare(
            `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys
              .map(() => '?')
              .join(',')})`,
          )
          .run(...keys.map((key) => sqlValue(data[key]))).lastInsertRowid,
      );
    },
    async update(data) {
      const keys = Object.keys(data).filter((key) => data[key] !== undefined);
      db.prepare(
        `UPDATE ${table} SET ${keys
          .map((k) => `\`${k}\` = ?`)
          .join(',')}${parser.parseWhere(structuredClone(where))}`,
      ).run(...keys.map((k) => sqlValue(data[k])));
    },
    async delete() {
      db.exec(`DELETE FROM ${table}${parser.parseWhere(structuredClone(where))}`);
    },
  };
  return query;
};
const sideEffect = vi.fn();
const oauthUrl = 'https://oauth.test.invalid';
const originalFetch = globalThis.fetch;
const handler = main({
  storage: 'mysql',
  oauthUrl,
  disableRegion: true,
  disableUserAgent: true,
  preSave: sideEffect,
  postSave: sideEffect,
  preUpdate: sideEffect,
  postUpdate: sideEffect,
  customModel(name) {
    const Mysql = require('../src/service/storage/mysql.js');
    const model = new Mysql(name);
    model.model = transport;
    return model;
  },
});
const NotifyService = require('../src/service/notify.js');
const notifyRun = vi.spyOn(NotifyService.prototype, 'run').mockResolvedValue();
const AkismetService = require('../src/service/akismet.js');
const akismetCheck = vi.spyOn(AkismetService.prototype, 'check').mockResolvedValue(false);
let port, server;
const headers = (id) => ({
  'Content-Type': 'application/json',
  ...(id ? { Authorization: `Bearer ${jwt.sign(String(id), process.env.JWT_TOKEN)}` } : {}),
});
const request = (path, id, method, body) =>
  originalFetch(`http://127.0.0.1:${port}${path}`, {
    method: method ?? 'GET',
    headers: headers(id),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const json = async (...args) => (await request(...args)).json();
const post = (id, extra = {}) =>
  json('/api/comment', id, 'POST', {
    url: '/post',
    comment: 'new secret',
    pid: 1,
    rid: 1,
    visibility: 'private',
    nick: 'A',
    mail: 'a@test.invalid',
    link: '',
    ...extra,
  });
describe('private reply access', () => {
  beforeAll(async () => {
    db.exec(schema);
    vi.stubGlobal('fetch', (url, options) =>
      String(url).startsWith(oauthUrl)
        ? Promise.resolve({ json: async () => ({ services: [] }) })
        : originalFetch(url, options),
    );
    server = http.createServer(handler);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    ({ port } = server.address());
  });
  beforeEach(() => {
    dashboard.saveComments({ enabled: true, allowAdmin: false });
    db.exec('DELETE FROM Comment; DELETE FROM Users;');
    for (const [id, type] of [
      [1, 'guest'],
      [2, 'guest'],
      [3, 'guest'],
      [4, 'administrator'],
      [5, 'banned'],
    ]) {
      db.prepare(
        'INSERT INTO Users (id,display_name,email,url,type,avatar) VALUES (?,?,?,?,?,?)',
      ).run(
        id,
        `user${id}`,
        `user${id}@test.invalid`,
        '',
        type,
        'https://example.invalid/avatar.png',
      );
    }
    const insert = db.prepare(
      'INSERT INTO Comment (id,user_id,comment,url,pid,rid,visibility,private_user_a,private_user_b,status,insertedAt,nick,mail,link,ua,ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    insert.run(
      1,
      2,
      'public root',
      '/post',
      null,
      null,
      'public',
      null,
      null,
      'approved',
      '2026-01-01',
      'B',
      'b@test.invalid',
      '',
      '',
      '127.0.0.1',
    );
    insert.run(
      2,
      1,
      'PRIVATE_SENTINEL',
      '/post',
      1,
      1,
      'private',
      1,
      2,
      'approved',
      '2026-01-02',
      'A',
      'a@test.invalid',
      '',
      '',
      '127.0.0.1',
    );
    insert.run(
      3,
      null,
      'anonymous root',
      '/anon',
      null,
      null,
      'public',
      null,
      null,
      'approved',
      '2026-01-01',
      'anon',
      'a@test.invalid',
      '',
      '',
      '127.0.0.1',
    );
    sideEffect.mockClear();
    notifyRun.mockClear();
    akismetCheck.mockClear();
  });

  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    db.close();
    vi.unstubAllGlobals();
    notifyRun.mockRestore();
    akismetCheck.mockRestore();
    delete process.env.MYSQL_DB;
    delete process.env.JWT_TOKEN;
    delete process.env.IPQPS;
    delete process.env.REGION_SETTINGS_FILE;
    fs.rmSync(regionDirectory, { recursive: true, force: true });
  });

  it.each([undefined, 3, 5])('hides content and existence from viewer %s', async (id) => {
    const response = await request('/api/comment?path=/post', id);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.json();
    expect(body.errno).toBe(0);
    expect(body.data.count).toBe(1);
    expect(body.data.data[0].children).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain('PRIVATE_SENTINEL');
    expect((await json('/api/comment?type=count&url=/post', id)).data).toStrictEqual([1]);
    expect(JSON.stringify(await json('/api/comment?type=recent&count=1', id))).not.toContain(
      'PRIVATE_SENTINEL',
    );
  });

  it.each([1, 2, 4])('shows private replies to participant/admin %s', async (id) => {
    const body = await json('/api/comment?path=/post', id);
    expect(body.errno).toBe(0);
    expect(body.data.count).toBe(2);
    const [reply] = body.data.data[0].children;
    expect(reply.comment).toContain('PRIVATE_SENTINEL');
    expect(reply.visibility).toBe('private');
    expect(reply.canReply).toBe(id !== 4);
    expect(reply).not.toHaveProperty('private_user_a');
  });

  it.each([undefined, 1, 4])('rSS never includes private replies for %s', async (id) => {
    const response = await request('/api/comment/rss?path=/post', id);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.not.toContain('PRIVATE_SENTINEL');
  });

  it('closes all public comment reads while retaining admin maintenance and optional access', async () => {
    dashboard.saveComments({ enabled: false, allowAdmin: false });
    for (const id of [undefined, 1, 4]) {
      const list = await json('/api/comment?path=/post', id);
      expect(list.data.data).toStrictEqual([]);
      expect(list.data.count).toBe(0);
      expect(list.data.closed).toBe(true);
      expect((await json('/api/comment?type=recent', id)).data).toStrictEqual([]);
      expect((await json('/api/comment?type=count&url=/post', id)).data).toStrictEqual([0]);
      await expect((await request('/api/comment/rss', id)).text()).resolves.not.toContain('<item>');
      expect(
        (await request('/api/comment', id, 'POST', { url: '/post', comment: 'blocked' })).status,
      ).toBe(403);
    }
    expect((await json('/api/comment?type=list', 4)).data.data.length).toBeGreaterThan(0);
    expect((await request('/api/settings?section=comments')).status).toBe(401);
    expect((await request('/api/settings?section=comments', 1)).status).toBe(403);
    expect((await json('/api/settings?section=comments', 4)).data.enabled).toBe(false);
    dashboard.saveComments({ enabled: false, allowAdmin: true });
    expect((await json('/api/comment?path=/post', 4)).data.data.length).toBeGreaterThan(0);
    expect((await json('/api/comment?path=/post', 1)).data.data).toStrictEqual([]);
  });

  it('restricts region auditing and raw IP to administrators', async () => {
    for (const id of [undefined, 1, 5]) {
      expect(
        (await request('/api/comment?type=region-audit&path=/post', id)).status,
      ).toBeGreaterThanOrEqual(400);
    }
    db.prepare('UPDATE Comment SET ip = NULL WHERE id = 3').run();
    const audit = await json('/api/comment?type=region-audit', 4);
    expect(audit.errno).toBe(0);
    expect(audit.data.scanned).toBe(3);
    expect(audit.data.missingIP).toBe(1);
    expect(audit.data.nextPage).toBeNull();
    expect(JSON.stringify(audit)).not.toContain('127.0.0.1');
    for (const id of [undefined, 1]) {
      const comments = await json('/api/comment?path=/post', id);
      expect(comments.data.data[0]).not.toHaveProperty('ip');
    }
    const admin = await json('/api/comment?path=/post', 4);
    expect(admin.data.data[0].ip).toBe('127.0.0.1');
  });

  it('persists region settings for administrators and applies them to public reads', async () => {
    for (const id of [undefined, 1, 5]) {
      expect(
        (await request('/api/comment?type=region-settings', id)).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await request('/api/comment?type=region-settings', id, 'PUT', {
            level: 'city',
            country: true,
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(
      (
        await json('/api/comment?type=region-settings', 4, 'PUT', {
          level: 'invalid',
          country: true,
        })
      ).errno,
    ).not.toBe(0);
    const saved = await json('/api/comment?type=region-settings', 4, 'PUT', {
      level: 'province',
      country: true,
    });
    expect(saved.errno).toBe(0);
    expect(JSON.parse(fs.readFileSync(process.env.REGION_SETTINGS_FILE, 'utf8'))).toStrictEqual({
      level: 'province',
      country: true,
    });
    expect((await json('/api/comment?type=region-settings', 4)).data).toMatchObject({
      level: 'province',
      country: true,
    });
    db.prepare('UPDATE Comment SET ip=? WHERE id=1').run('43.132.141.24');
    const listed = await json('/api/comment?path=/post');
    expect(listed.data.data[0].addr).toBe('中国 香港特别行政区');
    expect(listed.data.data[0]).not.toHaveProperty('ip');
    await json('/api/comment?type=region-settings', 4, 'PUT', { level: 'off', country: true });
    expect((await json('/api/comment?path=/post')).data.data[0]).not.toHaveProperty('addr');
    fs.unlinkSync(process.env.REGION_SETTINGS_FILE);
  });

  it('creates a fixed audience and skips outgoing hooks', async () => {
    const result = await post(1);
    expect(result.errno).toBe(0);
    const row = db.prepare('SELECT * FROM Comment WHERE id = ?').get(result.data.objectId);
    expect([row.private_user_a, row.private_user_b]).toStrictEqual([1, 2]);
    expect(row.visibility).toBe('private');
    expect(sideEffect).not.toHaveBeenCalled();
    expect(notifyRun).not.toHaveBeenCalled();
    expect(akismetCheck).not.toHaveBeenCalled();
  });

  it('inherits the audience for a continuation', async () => {
    const result = await post(2, { pid: 2, visibility: undefined });
    expect(result.errno).toBe(0);
    expect(result.data.visibility).toBe('private');
  });

  it.each([
    [undefined, {}],
    [3, { pid: 2 }],
    [4, { pid: 2 }],
    [1, { pid: 3, rid: 3, url: '/anon' }],
    [1, { pid: 2, visibility: 'public' }],
    [1, { pid: 1, rid: 3 }],
    [1, { pid: 1, url: '/wrong' }],
    [1, { user_id: 2 }],
    [1, { private_user_a: 3 }],
    [4, { pid: undefined, rid: undefined }],
    [undefined, { pid: undefined, rid: undefined }],
    [5, { pid: undefined, rid: undefined }],
  ])('rejects invalid private creation %#', async (id, extra) => {
    const result = await post(id, extra);
    expect([400, 401, 403, 404]).toContain(result.errno);
    expect(db.prepare('SELECT COUNT(*) AS n FROM Comment').get().n).toBe(3);
  });

  it('creates a private root addressed to the administrator and preserves its audience', async () => {
    const result = await post(1, { pid: undefined, rid: undefined });
    expect(result.errno).toBe(0);
    const rootId = result.data.objectId;
    const row = db.prepare('SELECT * FROM Comment WHERE id=?').get(rootId);
    expect(Number(row.private_user_a)).toBe(1);
    expect(Number(row.private_user_b)).toBe(4);
    for (const id of [undefined, 2, 3]) {
      expect(JSON.stringify(await json('/api/comment?path=/post', id))).not.toContain('new secret');
    }
    const reply = await post(4, { pid: rootId, rid: rootId, visibility: undefined });
    expect(reply.errno).toBe(0);
    expect(reply.data.visibility).toBe('private');
    expect((await post(3, { pid: rootId, rid: rootId })).errno).not.toBe(0);
    expect((await post(1, { pid: rootId, rid: rootId, visibility: 'public' })).errno).not.toBe(0);
    expect(sideEffect).not.toHaveBeenCalled();
  });

  it.each([undefined, 3, 5])('blocks direct edits and likes for %s', async (id) => {
    for (const body of [{ comment: 'stolen' }, { like: true }]) {
      expect((await json('/api/comment/2', id, 'PUT', body)).errno).toBe(404);
    }
  });

  it('allows author editing but keeps audience immutable even for administrators', async () => {
    expect((await json('/api/comment/2', 1, 'PUT', { comment: 'edited secret' })).errno).toBe(0);
    expect(sideEffect).not.toHaveBeenCalled();
    expect((await json('/api/comment/2', 4, 'PUT', { visibility: 'public' })).errno).not.toBe(0);
    expect(
      (await json('/api/db?table=Comment&objectId=2', 4, 'PUT', { visibility: 'public' })).errno,
    ).not.toBe(0);
    expect((await json('/api/comment/2', 2, 'PUT', { comment: 'recipient edit' })).errno).not.toBe(
      0,
    );
  });

  it('checks both accounts and moderation state before accepting a private reply', async () => {
    db.exec("UPDATE Users SET type = 'banned' WHERE id = 2");
    expect((await post(1)).errno).toBe(400);
    db.exec(
      "UPDATE Users SET type = 'guest' WHERE id = 2; UPDATE Comment SET status = 'waiting' WHERE id = 1",
    );
    expect((await post(1)).errno).toBe(400);
  });

  it('allows admin moderation without publishing the audience', async () => {
    const result = await json('/api/comment/2', 4, 'PUT', { status: 'waiting' });
    expect(result.errno).toBe(0);
    expect(result.data.visibility).toBe('private');
    expect(
      (await json('/api/comment?type=list', 4)).data.data.some((c) => c.visibility === 'private'),
    ).toBe(true);
    expect((await json('/api/comment?type=list', 3)).errno).not.toBe(0);
  });

  it('exports private rows only to administrators and refuses lossy online restore', async () => {
    expect((await json('/api/db', 3)).errno).toBe(403);
    const response = await request('/api/db', 4);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await response.json()).data.data.Comment.some((c) => c.visibility === 'private')).toBe(
      true,
    );
    expect(
      (
        await json('/api/db?table=Comment', 4, 'POST', {
          visibility: 'private',
          private_user_a: 1,
          private_user_b: 2,
        })
      ).errno,
    ).toBe(400);
  });

  it('hides grouped counts, rankings and recent results before pagination', async () => {
    expect((await json('/api/comment?type=count&url=/post&url=/anon', 3)).data).toStrictEqual([
      1, 1,
    ]);
    const recent = await json('/api/comment?type=recent&count=1', 3);
    expect(recent.errno).toBe(0);
    expect(recent.data).toHaveLength(1);
    expect(recent.data[0].visibility).toBe('public');
    const ranks = await json('/api/user?type=count&pageSize=10', 3);
    expect(ranks.errno).toBe(0);
    expect(ranks.data.reduce((sum, user) => sum + user.count, 0)).toBe(2);
  });

  it('does not allow third parties to delete private comments', async () => {
    expect((await json('/api/comment/2', 3, 'DELETE')).errno).toBe(403);
    expect(db.prepare('SELECT id FROM Comment WHERE id = 2').get()).toBeDefined();
    expect((await json('/api/comment/2', 1, 'DELETE')).errno).toBe(0);
    expect(db.prepare('SELECT id FROM Comment WHERE id = 2').get()).toBeUndefined();
  });

  it('never interpolates a malformed identity into the SQL audience predicate', () => {
    const { readPredicate } = require('../src/service/comment-privacy.js');
    expect(readPredicate({ objectId: "1' OR 1=1 --", type: 'guest' })).toBe(
      "`visibility` = 'public'",
    );
  });
});
