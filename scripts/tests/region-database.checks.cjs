const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const serverRequire = createRequire(path.resolve(__dirname, '../../packages/server/package.json'));
const database = require('../../packages/server/src/service/region-database.js');

test('database conversion, updates, fallback and scheduling', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-region-test-'));
  const originalFetch = global.fetch;
  const savedEnv = { ...process.env };
  process.env.REGION_DATABASE_DIR = directory;
  delete process.env.IP2REGION_DB;
  delete process.env.IP2REGION_DB_V4;
  const source = Buffer.from('0.0.0.0|255.255.255.255|日本|東京都|東京|Example|JP\n');
  let calls = 0;
  const upstream = async () => {
    calls++;
    return new Response(source, { headers: { etag: 'test-version' } });
  };
  const settled = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!database.status().running) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Update did not finish');
  };
  try {
    await t.test('validates settings and preserves safe defaults', () => {
      assert.equal(database.status().source, 'bundled');
      assert.throws(() => database.save({ source: 'unknown', interval: 'daily' }));
      assert.throws(() => database.startUpdate());
      process.env.IP2REGION_DB_V4 = 'external.db';
      assert.equal(database.activeFile(), 'external.db');
      assert.throws(() => database.save({ source: 'official', interval: 'daily' }));
      delete process.env.IP2REGION_DB_V4;
    });
    await t.test('converts UTF-8 and rejects gaps, overlaps and malformed rows', async () => {
      const { data, ranges } = await database.convert(source);
      assert.equal(ranges, 1);
      assert.equal(data.readUInt32LE(0), data.readUInt32LE(4));
      for (const invalid of [
        '1.0.0.0|255.255.255.255|a|b|c|d|XX',
        '0.0.0.0|1.0.0.0|a|b|c|d|XX',
        'invalid',
        source.toString() + source.toString(),
      ])
        await assert.rejects(database.convert(Buffer.from(invalid)));
    });
    await t.test('publishes a readable database and deduplicates concurrent updates', async () => {
      database.save({ source: 'official', interval: 'off' });
      global.fetch = upstream;
      database.startUpdate();
      assert.equal(database.startUpdate().running, true);
      await settled();
      assert.equal(calls, 1);
      assert.equal(database.status().active, 'official');
      assert.equal(database.status().error, null);
      const Reader = serverRequire('ip2region').default;
      assert.equal(
        new Reader({ ipv4db: database.activeFile() }).search('210.130.1.1').country,
        '日本',
      );
    });
    await t.test('unchanged upstream skips download', async () => {
      global.fetch = async (url, options) => {
        calls++;
        assert.equal(options.headers['If-None-Match'], 'test-version');
        return new Response(null, { status: 304 });
      };
      database.startUpdate();
      await settled();
      assert.equal(calls, 2);
    });
    await t.test('failed downloads and invalid data preserve the working generation', async () => {
      const previous = database.activeFile();
      global.fetch = async () => {
        throw new Error('offline');
      };
      database.startUpdate();
      await settled();
      assert.equal(database.activeFile(), previous);
      assert.match(database.status().error, /offline/);
      global.fetch = async () => new Response('broken data');
      database.startUpdate();
      await settled();
      assert.equal(database.activeFile(), previous);
      assert.match(database.status().error, /Invalid upstream row/);
    });
    await t.test('switches back to the bundled snapshot without deleting downloaded data', () => {
      database.save({ source: 'bundled', interval: 'off' });
      assert.equal(database.status().active, 'bundled');
      database.save({ source: 'official', interval: 'off' });
      assert.equal(database.status().active, 'official');
    });
    await t.test('scheduler performs a due update on startup', async () => {
      database.save({ source: 'official', interval: 'daily' });
      const statePath = path.join(directory, 'state.json');
      const current = JSON.parse(fs.readFileSync(statePath));
      fs.writeFileSync(
        statePath,
        JSON.stringify({ ...current, attemptedAt: '2000-01-01T00:00:00Z' }),
      );
      global.fetch = async () => new Response(null, { status: 304 });
      database.startScheduler();
      await settled();
      assert.equal(database.status().error, null);
      assert.ok(Date.parse(database.status().attemptedAt) > Date.parse(current.attemptedAt));
    });
  } finally {
    global.fetch = originalFetch;
    for (const key of ['REGION_DATABASE_DIR', 'IP2REGION_DB', 'IP2REGION_DB_V4']) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
