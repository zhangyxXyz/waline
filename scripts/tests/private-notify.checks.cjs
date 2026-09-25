const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
global.think = { Service: class {}, config: () => ({}) };
const Notify = require('../../packages/server/src/service/notify.js');
const store = require('../../packages/server/src/service/dashboard-settings.js');
const smtp = require('../../packages/server/src/service/smtp-settings.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-notify-'));
process.env.DASHBOARD_SETTINGS_FILE = path.join(dir, 'settings.json');
process.env.DISABLE_AUTHOR_NOTIFY = 'true';
const comment = {
  visibility: 'private',
  status: 'approved',
  private_user_a: 1,
  private_user_b: 2,
  user_id: 1,
  comment: '<p>Secret</p>',
  url: '/post',
  objectId: 8,
};
const users = [
  { objectId: 1, type: 'guest', email: 'a@example.test' },
  { objectId: 2, type: 'administrator', email: 'owner@example.test' },
];
const fixture = (accounts = users) => {
  const sent = [];
  const service = new Notify({
    getModel: () => ({ select: async () => accounts }),
    ctx: { state: { oauthServices: [] } },
    get: () => 'zh-cn',
    locale: (value) => value,
  });
  service.mail = async (...args) => {
    sent.push(args);
  };
  for (const method of ['wechat', 'qywxAmWechat', 'qq', 'telegram', 'pushplus', 'discord', 'lark'])
    service[method] = () => {
      throw Error('Private content reached a relay');
    };
  return { service, sent };
};
test('SMTP author switch overrides environment and survives environment/custom settings', () => {
  assert.equal(smtp.read().authorNotify, false);
  smtp.save({ useEnvironment: true, authorNotify: true });
  assert.equal(smtp.read().authorNotify, true);
  smtp.save({ useEnvironment: true });
  assert.equal(smtp.read().authorNotify, true);
  assert.throws(() => smtp.save({ useEnvironment: true, authorNotify: 'yes' }), { status: 400 });
  smtp.save({ useEnvironment: true, authorNotify: false });
});
test('private roots notify the designated account even when public author mail is off', async () => {
  const { service, sent } = fixture();
  await service.run({ ...comment, mail: 'spoof@example.test' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].to, 'owner@example.test');
  assert.equal(sent[0][0].templateKind, 'admin');
});
test('private continuations notify the other participant, including replies to own messages and admin replies', async () => {
  for (const sender of [1, 2]) {
    const { service, sent } = fixture();
    await service.run({ ...comment, user_id: sender }, { ...comment, user_id: sender }, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0].to, sender === 1 ? 'owner@example.test' : 'a@example.test');
    assert.equal(sent[0][0].templateKind, 'reply');
  }
});
test('pending/spam, missing audiences, inactive users and undeliverable addresses never receive private mail', async () => {
  for (const extra of [
    { status: 'waiting' },
    { status: 'spam' },
    { visibility: 'public' },
    { private_user_a: null, private_user_b: null },
    { private_user_b: 1 },
    { user_id: 3 },
  ]) {
    const { service, sent } = fixture();
    await service.privateMail({ ...comment, ...extra });
    assert.equal(sent.length, 0);
  }
  for (const accounts of [
    [users[0]],
    [users[0], { ...users[1], type: 'banned' }],
    [{ ...users[0], type: 'banned' }, users[1]],
    [users[0], { ...users[1], email: '123@mail.github' }],
  ]) {
    const { service, sent } = fixture(accounts);
    await service.run(comment);
    assert.equal(sent.length, 0);
  }
  // Administrators may read other private comments, so test with an ordinary recipient.
  const ordinary = fixture(users.map((u) => ({ ...u, type: 'guest' })));
  await ordinary.service.run(comment, { ...comment, private_user_a: 3, private_user_b: 4 });
  assert.equal(ordinary.sent.length, 0);
});
test('private mail subject and body are marked even with a saved custom template', async () => {
  store.save('mail', {
    'zh-cn': {
      admin: {
        subject: 'StarryNights 来信',
        body: '<!doctype html><html><body><p>{{self.comment | safe}}</p></body></html>',
      },
    },
  });
  const { service } = fixture();
  const sent = [];
  service.transporter = { sendMail: async (value) => sent.push(value) };
  await Notify.prototype.mail.call(
    service,
    { to: 'owner@example.test', templateKind: 'admin' },
    comment,
  );
  assert.match(sent[0].subject, /^\[私密评论\]/u);
  assert.match(sent[0].html, /<body><div role="note"/u);
  assert.match(sent[0].html, /仅对话双方及管理员可见/u);
  assert.match(sent[0].html, /<p>Secret<\/p>/u);
});
test('public author mail can be enabled while relays remain disabled; reply addresses are deduplicated', async () => {
  store.save('smtp', { useEnvironment: true, authorNotify: true });
  process.env.AUTHOR_EMAIL = 'owner@example.test';
  const { service, sent } = fixture();
  const publicComment = { ...comment, visibility: 'public', type: 'guest' };
  await service.run(publicComment, { mail: 'OWNER@example.test', user_id: 2, type: 'guest' });
  assert.equal(sent.length, 1);
  smtp.save({ useEnvironment: true, authorNotify: false });
  await service.run(publicComment);
  assert.equal(sent.length, 1);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
