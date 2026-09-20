const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const store = require('../../packages/server/src/service/dashboard-settings.js');
const root = path.resolve(__dirname, '../../packages/server/src');
const services = [{ name: 'github' }, { name: 'qq' }];
const auth = (registration = true, email = true, login = true, bind = true) =>
  store.saveAuth(
    {
      registration,
      email,
      providers: { github: { login, bind }, qq: { login: false, bind: false } },
    },
    services,
  );
const think = {
  Controller: class {},
  config: () => false,
  isEmpty: (value) => !value || !Object.keys(value).length,
  buildUrl: (base) => base,
};
const load = (name) => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, name), 'utf8'), {
    module,
    process,
    console,
    think,
    fetch: async () => ({ json: async () => ({ id: 'social-id', name: 'New user' }) }),
    require: (id) => {
      if (id.endsWith('rest.js')) return class {};
      if (id.includes('dashboard-settings')) return store;
      if (id === 'jsonwebtoken') return { sign: () => 'signed-token' };
      if (id.includes('markdown')) return { getMarkdownParser: () => (value) => value };
      return {};
    },
  });
  return module.exports;
};
const instance = (Controller, user, query = {}) =>
  Object.assign(Object.create(Controller.prototype), {
    ctx: {
      state: { userInfo: user, oauthServices: services },
      set() {},
      throw(status) {
        throw Object.assign(new Error(), { status });
      },
    },
    get: (key) => (key ? query[key] : query),
    config: () => ({ oauthUrl: 'https://example.invalid' }),
    locale: (value) => value,
    success: (value) => value,
    jsonOrSuccess: (value) => value,
    redirect: () => 'redirect',
  });
test('registration, OAuth binding and public comment shutdown', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-access-'));
  const previous = process.env.DASHBOARD_SETTINGS_FILE;
  process.env.DASHBOARD_SETTINGS_FILE = path.join(dir, 'settings.json');
  try {
    await t.test('registration combinations and strict setting validation', async () => {
      const User = load('controller/user.js');
      for (const [registration, email] of [
        [false, false],
        [false, true],
        [true, false],
      ]) {
        auth(registration, email);
        await assert.rejects(instance(User, {}).postAction(), { status: 403 });
      }
      assert.throws(() =>
        store.saveAuth({ registration: 'yes', email: true, providers: {} }, services),
      );
      assert.throws(() =>
        store.saveAuth(
          { registration: true, email: true, providers: { unknown: { login: true, bind: true } } },
          services,
        ),
      );
    });
    await t.test(
      'OAuth: total switch blocks new users but keeps existing login and binding',
      async () => {
        const OAuth = load('controller/oauth.js');
        auth(false, false);
        const callback = instance(
          OAuth,
          {},
          { type: 'github', code: 'code', redirect: 'https://example.invalid' },
        );
        callback.modelInstance = { select: async () => [] };
        await assert.rejects(callback.indexAction(), { status: 403 });
        callback.modelInstance.select = async () => [{ objectId: 'existing', type: 'guest' }];
        await callback.indexAction();
        const binding = instance(OAuth, { objectId: 'existing' }, { type: 'github', code: 'code' });
        let updates = 0;
        binding.modelInstance = { select: async () => [], update: async () => updates++ };
        await binding.indexAction();
        assert.equal(updates, 1);
        auth(true, true, false, false);
        await assert.rejects(callback.indexAction(), { status: 403 });
        await assert.rejects(binding.indexAction(), { status: 403 });
        auth(true, true);
        callback.get = (key) => (key ? undefined : { type: 'unknown', code: 'code' });
        await assert.rejects(callback.indexAction(), { status: 403 });
      },
    );
    await t.test(
      'closed comments return empty lists/counts and deny posting for all users',
      async () => {
        const Comment = load('controller/comment.js');
        store.saveComments({ enabled: false, allowAdmin: false });
        for (const user of [
          {},
          { objectId: 'guest', type: 'guest' },
          { objectId: 'admin', type: 'administrator' },
        ]) {
          const list = await instance(Comment, user, { path: '/', page: 1 }).getAction();
          assert.equal(list.count, 0);
          assert.equal(list.data.length, 0);
          assert.equal(list.closed, true);
          assert.equal((await instance(Comment, user, { type: 'recent' }).getAction()).length, 0);
          assert.equal(await instance(Comment, user, { type: 'count' }).getAction(), 0);
          const counts = await instance(Comment, user, {
            type: 'count',
            url: ['/', '/post'],
          }).getAction();
          assert.deepEqual(Array.from(counts), [0, 0]);
          await assert.rejects(instance(Comment, user).postAction(), { status: 403 });
        }
        const admin = instance(Comment, { type: 'administrator' }, { type: 'list' });
        admin.getAdminCommentList = async () => ({ data: ['retained'] });
        assert.deepEqual(await admin.getAction(), { data: ['retained'] });
        store.saveComments({ enabled: false, allowAdmin: true });
        assert.equal(store.allowed({ type: 'administrator' }), true);
        assert.equal(store.allowed({ type: 'guest' }), false);
        store.saveComments({ enabled: true, allowAdmin: false });
        assert.equal(store.allowed({}), true);
      },
    );
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_SETTINGS_FILE;
    else process.env.DASHBOARD_SETTINGS_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
