const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const settings = require('../../packages/server/src/service/badge-colors.js');

test('only administrators can change exclusive labels or colors', async () => {
  const sandbox = {
    module: { exports: {} },
    require: (name) =>
      name === './rest.js' ? class {} : name.includes('badge-colors') ? settings : {},
    think: {},
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.resolve(__dirname, '../../packages/server/src/controller/user.js'),
      'utf8',
    ),
    sandbox,
  );
  for (const input of [{ label: 'Admin' }, { label: 'Guest', labelColors: {} }]) {
    const context = {
      post: (key) => (key ? undefined : input),
      ctx: {
        state: { userInfo: { objectId: '1', type: 'guest' } },
        throw: (status) => {
          throw Object.assign(new Error('Forbidden'), { status });
        },
      },
    };
    await assert.rejects(sandbox.module.exports.prototype.putAction.call(context), { status: 403 });
  }
});

test('colors are optional, partial client overrides preserve server fields', async () => {
  const { getBadgeStyle } = await import('../../packages/client/src/utils/badge.ts');
  assert.deepEqual(getBadgeStyle(), {});
  const style = getBadgeStyle(
    { light: { text: '#123' } },
    {
      light: { text: '#456', background: '#aabbcc' },
      dark: { text: '#abcdef' },
    },
  );
  assert.match(style.color, /#123/);
  assert.match(style.color, /#abcdef/);
  assert.doesNotMatch(style.color, /#456/);
  assert.match(style.background, /#aabbcc/);
  assert.match(style.background, /--waline-badge-default-background/);
  assert.equal(style['border-color'], undefined);
  assert.deepEqual(getBadgeStyle({ light: { text: 'url(https://example.com)' } }), {});
});

test('server validates colors and clears removed fields', () => {
  assert.deepEqual(settings.validate({ light: { text: '' } }), { light: {} });
  for (const value of [
    null,
    [],
    { light: [] },
    { light: { text: 'red' } },
    { dark: { background: 'url(x)' } },
    { extra: {} },
  ]) {
    assert.throws(() => settings.validate(value));
  }
  for (const text of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) {
    assert.equal(settings.validate({ light: { text } }).light.text, text);
  }
});

test('user colors survive reads, stay bound to the label and preserve other settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-badge-'));
  const previous = process.env.DASHBOARD_SETTINGS_FILE;
  process.env.DASHBOARD_SETTINGS_FILE = path.join(directory, 'settings.json');
  try {
    fs.writeFileSync(
      process.env.DASHBOARD_SETTINGS_FILE,
      JSON.stringify({ images: { enabled: false } }),
    );
    settings.save('123', 'Guest', { dark: { text: '#fff' } });
    assert.deepEqual(settings.read('123', 'Guest'), { dark: { text: '#fff' } });
    assert.deepEqual(settings.read('123', 'Other'), {});
    assert.deepEqual(settings.read('456', 'Guest'), {});
    assert.equal(
      JSON.parse(fs.readFileSync(process.env.DASHBOARD_SETTINGS_FILE)).images.enabled,
      false,
    );
    settings.save('123', '', {});
    assert.deepEqual(settings.read('123', 'Guest'), {});
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_SETTINGS_FILE;
    else process.env.DASHBOARD_SETTINGS_FILE = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
