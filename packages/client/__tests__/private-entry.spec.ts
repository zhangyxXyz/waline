import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { compile, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

// Render the actual client control, independently of any theme or live account.
const source = readFileSync(new URL('../src/components/CommentBox.vue', import.meta.url), 'utf8');
const control = (/<label\s+v-if="[\s\S]*?class="wl-private-reply"[\s\S]*?<\/label>/u.exec(source))?.[0];
if (!control) throw new Error('Private comment control not found');
const render = compile(control);

const renderControl = (overrides = {}) =>
  renderToString(
    createSSRApp({
      render,
      setup: () => ({
        replyId: undefined,
        canPrivateReply: false,
        edit: null,
        userInfo: { token: 'test-session', type: 'guest' },
        privateChoice: false,
        privateReply: false,
        locale: { privateReply: 'Private message', privateReplyHint: 'Participants only' },
        ...overrides,
      }),
    }),
  );

describe('private comment entry', () => {
  it('offers a top-level private message to a signed-in user without a reply target', async () => {
    await expect(renderControl()).resolves.toContain('type="checkbox"');
  });

  it('hides the control before login and for an administrator messaging themself', async () => {
    for (const userInfo of [
      { token: '', type: 'guest' },
      { token: 'admin', type: 'administrator' },
    ]) {
      await expect(renderControl({ userInfo })).resolves.not.toContain('type="checkbox"');
    }
  });

  it('requires server permission when replying to an existing comment', async () => {
    await expect(renderControl({ replyId: 1 })).resolves.not.toContain('type="checkbox"');
    await expect(renderControl({ replyId: 1, canPrivateReply: true })).resolves.toContain('type="checkbox"');
  });

  it('keeps an existing private conversation checked and locked', async () => {
    const html = await renderControl({
      replyId: 1,
      canPrivateReply: true,
      privateReply: true,
      privateChoice: true,
    });
    expect(html).toContain(' checked');
    expect(html).toContain(' disabled');
  });

  it('does not offer visibility changes while editing', async () => {
    await expect(renderControl({ edit: { visibility: 'public' } })).resolves.not.toContain(
      'type="checkbox"',
    );
  });
});
