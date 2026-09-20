const { test } = require('node:test');
const assert = require('node:assert/strict');
const download = require('../../packages/server/src/service/database-download.js');
test('download routes and custom URL boundaries', () => {
  assert.match(download.address({}), /^https:\/\/raw.githubusercontent.com\//);
  assert.match(
    download.address({ route: 'ghproxy' }),
    /^https:\/\/gh-proxy.org\/https:\/\/raw.githubusercontent.com\//,
  );
  assert.equal(
    download.address({
      route: 'custom',
      customType: 'url',
      customURL: 'https://example.com/source.txt',
    }),
    'https://example.com/source.txt',
  );
  assert.match(
    download.address({ route: 'custom', customURL: 'https://example.com/' }),
    /^https:\/\/example.com\/https:/,
  );
  for (const customURL of [
    'http://example.com/',
    'https://user:secret@example.com/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://example.com:8360/',
  ])
    assert.throws(() => download.configuration({ route: 'custom', customURL }));
  for (const ip of [
    '127.0.0.1',
    '10.1.0.1',
    '172.16.1.1',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.1.2',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(download.publicIP(ip), false, ip);
  assert.equal(download.publicIP('8.8.8.8'), true);
});
test('connection test detects HTML error pages and does not consume a complete database', async () => {
  const original = global.fetch;
  let cancelled = false;
  try {
    global.fetch = async () => new Response('<html>blocked</html>');
    await assert.rejects(download.test({}), /not IPv4 source/);
    global.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('0.0.0.0|255.255.255.255|Example'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 206 },
      );
    const result = await download.test({});
    assert.equal(result.status, 206);
    assert.equal(cancelled, true);
  } finally {
    global.fetch = original;
  }
});
