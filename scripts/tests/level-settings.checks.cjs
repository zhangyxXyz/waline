const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const settings = require('../../packages/server/src/service/level-settings.js');

const example = {
  enabled: true,
  levels: [
    { min: 0, label: 'New' },
    { min: 2, label: 'Friend' },
    { min: 10, label: 'Regular' },
  ],
};

test('client labels preserve explicit overrides and localized defaults', async () => {
  const { getLevelLabel } = await import('../../packages/client/src/utils/level.ts');
  const comment = { level: 0, levelLabel: 'Server label' };
  assert.equal(getLevelLabel(comment, { level0: 'Default' }, { level0: 'Local' }), 'Local');
  assert.equal(getLevelLabel(comment, { level0: 'Default' }, {}), 'Server label');
  assert.equal(getLevelLabel({ level: 0 }, { level0: 'Default' }, {}), 'Default');
  assert.equal(getLevelLabel({ level: 8 }, {}, {}), 'Level 8');
  assert.equal(getLevelLabel(comment, { level0: 'Default' }, { level0: '' }), '');
});

test('settings persist, override environment values, and reject invalid writes atomically', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-level-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  assert.equal(settings.read(false, file).enabled, false);
  assert.equal(settings.read([5, 10], file).levels[0].min, 0);
  assert.deepEqual(settings.read([0, 10], file).levels, [
    { min: 0, label: '' },
    { min: 10, label: '' },
  ]);
  settings.write(example, file);
  assert.deepEqual(settings.read([0, 100], file), example);
  const invalid = [
    { ...example, enabled: 'true' },
    { ...example, levels: [] },
    { ...example, levels: [{ min: 1, label: 'A' }] },
    {
      ...example,
      levels: [
        { min: 0, label: 'A' },
        { min: 0, label: 'B' },
      ],
    },
    {
      ...example,
      levels: [
        { min: 0, label: 'A' },
        { min: 0.5, label: 'B' },
      ],
    },
    { ...example, levels: [{ min: 0, label: 'x'.repeat(41) }] },
    { ...example, levels: [{ min: 0, label: 'x\ny' }] },
  ];
  for (const value of invalid) assert.throws(() => settings.write(value, file), { status: 400 });
  assert.deepEqual(settings.read(false, file), example);
  settings.write({ ...example, enabled: false }, file);
  assert.equal(settings.read([0, 10], file).enabled, false);
});

test('threshold boundaries, changed emails, anonymous identities and disabling badges', () => {
  const comments = [{ user_id: 1 }, { user_id: 2 }, { mail: 'visitor@example.invalid' }, {}];
  settings.apply(
    comments,
    [
      { user_id: 1, mail: 'old@example.invalid', count: 4 },
      { user_id: 1, mail: 'new@example.invalid', count: 6 },
      { user_id: 2, count: 1 },
      { mail: 'visitor@example.invalid', count: 2 },
    ],
    example,
  );
  assert.deepEqual(
    comments.map(({ level }) => level),
    [2, 0, 1, 0],
  );
  assert.deepEqual(
    comments.map(({ levelLabel }) => levelLabel),
    ['Regular', 'New', 'Friend', 'New'],
  );
  settings.apply(comments, [], { ...example, enabled: false });
  assert.ok(comments.every((row) => !('level' in row) && !('levelLabel' in row)));
  const blank = [{ user_id: 1 }];
  settings.apply(blank, [], { enabled: true, levels: [{ min: 0, label: '' }] });
  assert.deepEqual(blank, [{ user_id: 1, level: 0 }]);
});

test('GET and PUT settings require administrator access in both controller and logic', async () => {
  const root = path.resolve(__dirname, '../../packages/server/src');
  let writes = 0;
  class Base {}
  const think = {
    config: () => undefined,
    isEmpty: (value) => !value || !Object.keys(value).length,
  };
  const load = (file) => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
      module,
      think,
      require: (name) => {
        if (name === './rest.js' || name === './base.js') return Base;
        if (name.includes('level-settings'))
          return {
            read: () => example,
            write: (value) => {
              writes++;
              return settings.validate(value);
            },
          };
        if (name.includes('markdown')) return { getMarkdownParser: () => (value) => value };
        return {};
      },
    });
    return module.exports;
  };
  const Controller = load('controller/comment.js');
  const Logic = load('logic/comment.js');
  for (const user of [undefined, { type: 'guest' }, { type: 'administrator' }]) {
    const ctx = {
      state: { userInfo: user },
      set: () => {},
      throw: (status) => {
        throw Object.assign(new Error(), { status });
      },
    };
    const controller = Object.assign(Object.create(Controller.prototype), {
      ctx,
      get: () => 'level-settings',
      config: () => false,
      success: (value) => value,
      post: () => example,
    });
    const logic = Object.assign(Object.create(Logic.prototype), {
      ctx,
      get: (key) => (key ? 'level-settings' : { type: 'level-settings' }),
    });
    if (user?.type === 'administrator') {
      assert.deepEqual(await controller.getAction(), example);
      assert.deepEqual(await controller.putAction(), example);
      logic.getAction();
      await logic.putAction();
    } else {
      await assert.rejects(controller.getAction(), { status: 403 });
      await assert.rejects(controller.putAction(), { status: 403 });
      assert.throws(() => logic.getAction(), { status: user ? 403 : 401 });
      await assert.rejects(logic.putAction(), { status: user ? 403 : 401 });
    }
  }
  assert.equal(writes, 1);
});
