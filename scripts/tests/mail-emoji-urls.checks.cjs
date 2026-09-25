const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../../packages/server/src/service/dashboard-settings.js');
const emoji = require('../../packages/server/src/service/mail-emoji-urls.js');
const templates = require('../../packages/server/src/service/mail-templates.js');

test('email emoji URL rules', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-emoji-'));
  const previous = process.env.DASHBOARD_SETTINGS_FILE;
  process.env.DASHBOARD_SETTINGS_FILE = path.join(dir, 'settings.json');
  const from = 'https://cdn.example/static/npm/@waline/emojis@1.4.0/';
  const to = 'https://cdn.jsdelivr.net/npm/@waline/emojis@1.4.0/';
  const src = `${from}bilibili/bb_doge.png`;
  const img = `<img class="wl-emoji" src="${src}" alt="doge">`;
  const config = { enabled: true, rules: [{ from, to }] };
  try {
    await t.test('disabled by default, persisted without altering other settings', () => {
      store.save('mail', { preserved: true });
      assert.equal(emoji.rewrite(img), img);
      assert.deepEqual(emoji.save(config), config);
      assert.deepEqual(store.read().mail, { preserved: true });
    });
    await t.test(
      'only marked emoji images; preserves email markup, regular images, text and links',
      () => {
        const unchanged = `<!doctype html><!--[if mso]><table><![endif]--><style>.card{background:red}</style><p>${src}</p><a href="${src}">link</a><img src="${src}"><img class="wl-emoji" src="https://cdn.example/photo.png"><code>&lt;img class="wl-emoji" src="${src}"&gt;</code>`;
        assert.equal(
          emoji.rewrite(unchanged + img),
          unchanged + img.replace(src, `${to}bilibili/bb_doge.png`),
        );
      },
    );
    await t.test('encoded @, quote styles, entities, uppercase tags and query strings', () => {
      const original = `<IMG CLASS='other wl-emoji' SRC='${src.replaceAll('@', '%40')}?a=1&amp;b=2'><img class=wl-emoji src=${src}>`;
      const output = emoji.rewrite(original);
      assert.ok(output.includes(`SRC=`) === false);
      assert.ok(output.includes(`src="${to}bilibili/bb_doge.png?a=1&amp;b=2"`));
      assert.equal((output.match(/cdn.jsdelivr.net/gu) || []).length, 2);
      assert.equal(
        emoji.save({ enabled: true, rules: [{ from: from.replaceAll('@', '%40'), to }] }).rules[0]
          .from,
        from,
      );
    });
    await t.test('first match only, no chaining or lookalike prefix match', () => {
      emoji.save({
        enabled: true,
        rules: [
          { from, to },
          { from: to, to: 'https://other.example/' },
        ],
      });
      assert.ok(emoji.rewrite(img).includes(to));
      const other = img.replace('@1.4.0/', '@1.4.0-extra/');
      assert.equal(emoji.rewrite(other), other);
      emoji.save({ ...config, enabled: false });
      assert.equal(emoji.rewrite(img), img);
      emoji.save(config);
    });
    await t.test('rejects unsafe or ambiguous directories and duplicate rules atomically', () => {
      for (const bad of [
        'javascript:alert(1)',
        'file:///tmp/',
        'https://user:pass@example.com/',
        'https://example.com/no-slash',
        'https://example.com/?q=1',
        'https://example.com/#x',
        'https://example.com/\n',
        'https://example.com/\\',
      ]) {
        assert.throws(() => emoji.save({ enabled: true, rules: [{ from, to: bad }] }), {
          status: 400,
        });
      }
      assert.throws(
        () => emoji.save({ enabled: true, rules: [config.rules[0], config.rules[0]] }),
        { status: 400 },
      );
      assert.throws(() => emoji.save({ enabled: 'yes', rules: [] }), { status: 400 });
      assert.deepEqual(emoji.read(), config);
    });
    await t.test(
      'real notification sender rewrites both comments and preserves private marking and input',
      async () => {
        global.think = { Service: class {} };
        const Notify = require('../../packages/server/src/service/notify.js');
        templates.save({
          language: 'zh-cn',
          kind: 'reply',
          subject: 'Reply',
          body: '{{self.comment | safe}}{{parent.comment | safe}}',
        });
        const service = Object.assign(Object.create(Notify.prototype), {
          transporter: { sendMail: (value) => value },
          controller: { get: () => 'zh-cn', locale: (value) => value },
        });
        const self = { comment: img, visibility: 'private', url: '/', objectId: '1' };
        const parent = { comment: img };
        const sent = await service.mail(
          { to: 'sample@example.invalid', templateKind: 'reply' },
          self,
          parent,
        );
        assert.equal((sent.html.match(/cdn.jsdelivr.net/gu) || []).length, 2);
        assert.equal(self.comment, img);
        assert.equal(parent.comment, img);
        assert.match(sent.subject, /私密评论/u);
        delete global.think;
      },
    );
    await t.test('test mail uses the same rules without saving a template', async () => {
      const nodemailer = require('../../packages/server/node_modules/nodemailer');
      const smtp = require('../../packages/server/src/service/smtp-settings.js');
      const originalTransport = nodemailer.createTransport;
      const originalConfig = smtp.transport;
      let sent;
      nodemailer.createTransport = () => ({
        sendMail: async (value) => {
          sent = value;
          return { accepted: ['sample@example.invalid'] };
        },
        close() {},
      });
      smtp.transport = () => ({ host: 'example.invalid' });
      try {
        const result = await require('../../packages/server/src/service/mail-test.js').send({
          to: 'sample@example.invalid',
          template: { language: 'zh-cn', kind: 'admin', subject: 'Sample', body: img },
        });
        assert.equal(result.sent, true);
        assert.equal(sent.html, img.replace(src, `${to}bilibili/bb_doge.png`));
        assert.equal(templates.get('zh-cn', 'reply').subject, 'Reply');
      } finally {
        nodemailer.createTransport = originalTransport;
        smtp.transport = originalConfig;
      }
    });
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_SETTINGS_FILE;
    else process.env.DASHBOARD_SETTINGS_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
