// oxlint-disable vitest/no-hooks
import http from 'node:http';
import { createRequire } from 'node:module';

import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const visits = require('../src/service/visit-management.js');
const { isLoopback: loopback } = require('../src/service/loopback.js');
const rows = [
  { objectId: 1, url: '/a/', time: 12 },
  { objectId: 2, url: '/b/', time: 8 },
];
let writes = 0;
const model = {
  async withCounterTransaction(run) {
    const before = rows.map((row) => ({ ...row }));
    try {
      return await run({ ...model, inCounterTransaction: true });
    } catch (err) {
      rows.splice(0, rows.length, ...before);
      throw err;
    }
  },
  select: async (where = {}) =>
    rows.filter((row) =>
      Object.entries(where).every(
        ([key, value]) =>
          row[key] === value || (Array.isArray(value) && value[1].includes(row[key])),
      ),
    ),
  add: async (row) => {
    writes++;
    const value = { ...row, objectId: rows.length + 1 };
    rows.push(value);
    return value;
  },
  update: async (data, where) => {
    const found = await model.select(where);
    for (const row of found) {
      writes++;
      Object.assign(row, typeof data === 'function' ? data(row) : data);
    }
    return found;
  },
};
process.env.SQLITE_PATH = `/tmp/test-waline-visits-${process.pid}.sqlite`;
const handler = require('../index.js')({
  customModel: (name) => (name === 'Counter' ? model : { select: async () => [] }),
});
describe('visit management and public pageview API', () => {
  let base, server;
  beforeAll(async () => {
    server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://localhost:${server.address().port}/api`;
  });

  afterAll(async () => {
    delete process.env.SQLITE_PATH;
    await new Promise((resolve) => server.close(resolve));
  });

  it('reads total and single-page counts without writing', async () => {
    const before = writes;
    const total = await fetch(`${base}/article?site=1`).then((r) => r.json());
    const single = await fetch(`${base}/article?path=/a/&type=time`).then((r) => r.json());
    expect(total.data).toStrictEqual({ pageViews: 20 });
    expect(single.data).toStrictEqual([{ time: 12 }]);
    expect(writes).toBe(before);
  });

  it('blocks loopback browser increments and private management APIs', async () => {
    const before = writes;
    for (const origin of [
      'http://localhost:4000',
      'http://127.0.0.2',
      'http://[::1]',
      'http://preview.localhost',
    ]) {
      const response = await fetch(`${base}/article`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/a/', type: 'time' }),
      });
      expect(response.status).toBe(403);
    }
    for (const [method, section] of [
      ['GET', 'visits'],
      ['PUT', 'visits'],
      ['POST', 'visits-preview'],
      ['PUT', 'visits-import'],
    ]) {
      const response = await fetch(`${base}/settings?section=${section}`, { method });
      expect([401, 403]).toContain(response.status);
    }
    expect(writes).toBe(before);
  });

  it('recognizes alternative loopback forms', () => {
    for (const origin of ['http://2130706433', 'http://127.1', 'http://[::ffff:127.0.0.1]']) {
      expect(loopback(origin)).toBe(true);
    }
    expect(loopback('https://onlyzyx.com')).toBe(false);
  });

  it('previews imports without writes and keeps higher values on repeat imports', async () => {
    const items = [
      { url: '/a/', time: 20 },
      { url: '/b/', time: 3 },
      { url: '/new/', time: 4 },
    ];
    const before = writes;
    const plan = await visits.preview(model, items);
    expect(writes).toBe(before);
    expect(plan.rows.map((row) => row.after)).toStrictEqual([20, 8, 4]);
    await expect(visits.apply(model, items, plan.token)).resolves.toStrictEqual({ updated: 2 });
    const repeat = await visits.preview(model, items);
    await expect(visits.apply(model, items, repeat.token)).resolves.toStrictEqual({ updated: 0 });
    await expect(visits.apply(model, items, plan.token)).rejects.toMatchObject({ status: 409 });
    await expect(visits.edit(model, { url: '/a/', before: 12, time: 1 })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('rejects invalid or ambiguous imports', () => {
    for (const items of [
      [{ url: '//other/', time: 1 }],
      [{ url: '/a/?x=1', time: 1 }],
      [{ url: '/a/', time: -1 }],
      [
        { url: '/a/', time: 1 },
        { url: '/a/', time: 2 },
      ],
    ]) {
      expect(() => visits.validate(items)).toThrow(/Invalid|Duplicate/);
    }
  });

  it('passes the storage adapter order contract to snapshots', async () => {
    const { normalizeOrder, toSqlOrder } = require('../src/service/storage/order.js');
    await visits.snapshot({
      select: async (_where, options) => {
        expect(toSqlOrder(normalizeOrder(options.order))).toStrictEqual({ url: 'ASC' });
        return [];
      },
    });
  });

  it('commits increments before ThinkJS sends the successful response', async () => {
    const before = rows.find((row) => row.url === '/a/').time;
    const result = await fetch(`${base}/article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/a/', type: 'time' }),
    }).then((response) => response.json());
    expect(result.data).toStrictEqual([{ time: before + 1 }]);
    expect(rows.find((row) => row.url === '/a/').time).toBe(before + 1);
  });

  it('allows loopback reads with a production-only domain allowlist', async () => {
    think.config('secureDomains', ['onlyzyx.com']);
    try {
      for (const origin of [
        'http://[::1]:4000',
        'http://127.0.0.2:4000',
        'http://preview.localhost',
      ]) {
        const response = await fetch(`${base}/article?site=1`, { headers: { Origin: origin } });
        expect(response.status).toBe(200);
      }
    } finally {
      think.config('secureDomains', null);
    }
  });
});
