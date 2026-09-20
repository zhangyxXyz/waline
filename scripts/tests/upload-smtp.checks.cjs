const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const store = require('../../packages/server/src/service/dashboard-settings.js');
const smtp = require('../../packages/server/src/service/smtp-settings.js');

test('upload and SMTP settings persist safely and stay administrator-only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-upload-smtp-'));
  const original = { ...process.env };
  process.env.DASHBOARD_SETTINGS_FILE = path.join(dir, 'settings.json');
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.SMTP_USER = 'sender@example.test';
  process.env.SMTP_PASS = 'environment-secret';
  delete process.env.SMTP_SERVICE;
  try {
    assert.equal(store.images().enabled, true);
    store.saveImages({ enabled: false, password: 'discarded' });
    assert.deepEqual(store.images(), { enabled: false });
    assert.throws(() => store.saveImages({ enabled: 'true' }), { status: 400 });
    assert.equal(store.images().enabled, false);
    assert.equal(smtp.publicSettings().passwordConfigured, true);
    assert.equal(JSON.stringify(smtp.publicSettings()).includes('environment-secret'), false);
    const custom = {
      ...smtp.publicSettings(),
      useEnvironment: false,
      port: 587,
      secure: false,
      password: 'custom-secret',
    };
    assert.equal(smtp.save(custom).passwordConfigured, true);
    assert.equal(smtp.transport().auth.pass, 'custom-secret');
    assert.equal(smtp.transport().requireTLS, true);
    assert.equal(store.images().enabled, false);
    assert.equal(JSON.stringify(smtp.publicSettings()).includes('custom-secret'), false);
    smtp.save({ ...custom, password: '', senderName: 'Site' });
    assert.equal(smtp.transport().auth.pass, 'custom-secret');
    assert.equal(smtp.from().name, 'Site');
    assert.throws(() => smtp.save({ ...custom, port: 0 }), { status: 400 });
    assert.throws(() => smtp.save({ ...custom, host: 'https://invalid/' }), { status: 400 });
    assert.throws(() => smtp.save({ ...custom, senderName: 'Site\r\nBcc: victim@example.test' }), {
      status: 400,
    });
    assert.equal(smtp.transport().auth.pass, 'custom-secret');
    smtp.save({ ...custom, password: '', clearPassword: true });
    assert.equal(smtp.publicSettings().passwordConfigured, false);
    smtp.save({ ...custom, enabled: false });
    assert.equal(smtp.enabled(), false);
    assert.equal(smtp.transport(), null);
    smtp.save({ useEnvironment: true });
    assert.equal(smtp.transport().auth.pass, 'environment-secret');
    assert.deepEqual(store.read().smtp, { useEnvironment: true });

    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(
        path.resolve(__dirname, '../../packages/server/src/controller/settings.js'),
        'utf8',
      ),
      {
        module,
        require: (id) =>
          id.includes('dashboard-settings')
            ? store
            : id.includes('smtp-settings')
              ? smtp
              : id.endsWith('rest.js')
                ? class {}
                : {},
      },
    );
    for (const type of [undefined, 'guest', 'administrator']) {
      for (const section of ['images', 'smtp']) {
        const controller = Object.assign(new module.exports(), {
          ctx: {
            state: { userInfo: { type } },
            set() {},
            throw(status) {
              throw Object.assign(new Error(), { status });
            },
          },
          get: () => section,
          post: () => (section === 'images' ? { enabled: false } : { useEnvironment: true }),
          success: (value) => value,
        });
        if (type === 'administrator') {
          const result = await controller.getAction();
          assert.equal('password' in result, false);
          await controller.putAction();
        } else {
          await assert.rejects(controller.getAction(), { status: 403 });
          await assert.rejects(controller.putAction(), { status: 403 });
        }
      }
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
