const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const store = require('../../packages/server/src/service/dashboard-settings.js');
const mail = require('../../packages/server/src/service/mail-templates.js');

test('mail templates: language isolation, validation, restore and actual sender integration', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-mail-'));
  const previous = process.env.DASHBOARD_SETTINGS_FILE;
  process.env.DASHBOARD_SETTINGS_FILE = path.join(dir, 'settings.json');
  try {
    const example = {
      language: 'zh-CN',
      kind: 'reply',
      subject: '{{self.nick}} replied',
      body: '<p>{{parent.nick}}: {{self.comment | safe}}</p>',
    };
    await t.test('all language defaults can be previewed', () => {
      for (const language of mail.languages)
        for (const kind of ['reply', 'admin']) {
          const value = mail.get(language, kind);
          assert.ok(mail.preview(value).body.length > 20);
        }
    });
    await t.test(
      'languages and types persist independently; restore removes only selected override',
      () => {
        mail.save(example);
        mail.save({ ...example, kind: 'admin', body: '{{self.comment | safe}}' });
        assert.equal(mail.get('zh-cn', 'reply').custom, true);
        assert.equal(mail.get('en-US', 'reply').custom, false);
        mail.save({ language: 'zh-cn', kind: 'admin', reset: true });
        assert.equal(mail.get('zh-cn', 'admin').custom, false);
        assert.equal(mail.get('zh-cn', 'reply').custom, true);
      },
    );
    await t.test('invalid and executable expressions cannot replace valid templates', () => {
      for (const patch of [
        { subject: 'a\nb' },
        { body: '{{self.password}}' },
        { body: '{% include "secret" %}' },
        { body: '{{range.constructor()}}' },
        { body: '{{self.nick | safe}}' },
        { body: '' },
        { kind: 'admin' },
        { language: '__proto__' },
      ])
        assert.throws(() => mail.save({ ...example, ...patch }), { status: 400 });
      assert.equal(mail.get('zh-cn', 'reply').subject, example.subject);
    });
    await t.test('data is escaped without evaluating inserted template expressions', () => {
      const rendered = mail.render(example, {
        self: { nick: 'a\nb', comment: '<p>{{7*7}}</p>' },
        parent: { nick: '<img src=x>' },
      });
      assert.equal(rendered.subject, 'a b replied');
      assert.match(rendered.body, /&lt;img src=x&gt;/);
      assert.match(rendered.body, /<p>\{\{7\*7\}\}<\/p>/);
    });
    await t.test('SMTP sender uses saved templates and retains default fallback', async () => {
      global.think = { Service: class {} };
      const Notify = require('../../packages/server/src/service/notify.js');
      let sent;
      const service = Object.assign(Object.create(Notify.prototype), {
        transporter: {
          sendMail: (data) => {
            sent = data;
            return data;
          },
        },
        controller: { get: () => 'zh-CN', locale: (text) => text },
      });
      await service.mail(
        {
          to: 'example@example.invalid',
          templateKind: 'reply',
          title: 'default',
          content: 'default',
        },
        { nick: 'Reader', comment: 'Hello', url: '/', objectId: '1' },
        { nick: 'Parent' },
      );
      assert.equal(sent.subject, 'Reader replied');
      assert.match(sent.html, /Hello/);
      await service.mail(
        {
          to: 'example@example.invalid',
          templateKind: 'admin',
          title: 'default',
          content: 'default',
        },
        { nick: 'Reader' },
      );
      assert.equal(sent.html, 'default');
      delete global.think;
    });
    await t.test('settings controller and logic reject anonymous and ordinary users', async () => {
      for (const name of ['logic', 'controller']) {
        const module = { exports: {} };
        vm.runInNewContext(
          fs.readFileSync(
            path.resolve(__dirname, `../../packages/server/src/${name}/settings.js`),
            'utf8',
          ),
          {
            module,
            require: (id) =>
              id.startsWith('./') ? class {} : id.includes('dashboard-settings') ? store : mail,
          },
        );
        for (const type of [undefined, 'guest']) {
          const instance = Object.assign(Object.create(module.exports.prototype), {
            ctx: {
              state: { userInfo: type ? { objectId: '1', type } : {} },
              throw: (status) => {
                throw Object.assign(new Error(), { status });
              },
            },
          });
          for (const method of ['getAction', 'putAction', 'postAction'])
            await assert.rejects(async () => instance[method]());
        }
      }
    });
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_SETTINGS_FILE;
    else process.env.DASHBOARD_SETTINGS_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
