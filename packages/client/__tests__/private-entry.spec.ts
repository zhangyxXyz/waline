import { readFileSync } from 'node:fs';

import { transpileModule, ScriptTarget } from 'typescript';
import { describe, expect, it } from 'vitest';
import { compile, createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

// Render the actual client control, independently of any theme or live account.
const source = readFileSync(new URL('../src/components/CommentBox.vue', import.meta.url), 'utf8');
const control = /<label\s+v-if="[\s\S]*?class="wl-private-reply"[\s\S]*?<\/label>/u.exec(
  source,
)?.[0];
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
        locale: {
          privateReply: 'Private message',
          privateReplyHint: 'Participants only',
          privateAdminHint: 'Administrators only',
        },
        ...overrides,
      }),
    }),
  );

describe('private comment entry', () => {
  it('submits the private audience for a top-level message as well as a reply', async () => {
    // Execute the real payload preparation, stopping before network submission.
    const start = source.indexOf('const submitComment = async');
    const end = source.indexOf('  isSubmitting.value = true;', start);
    const code = transpileModule(`${source.slice(start, end)}return comment; };`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText;
    for (const props of [{}, { replyId: 2, rootId: 1 }]) {
      const bindings = {
        userInfo: { value: { token: 'session', display_name: 'User', email: 'user@example.test' } },
        config: { value: { path: '/post', requiredMeta: [] } },
        content: { value: 'Private message' },
        userMeta: { value: {} },
        userAgent: async () => 'test',
        props,
        syncUserMeta: () => {},
        isWordNumberLegal: { value: true },
        parseEmoji: (value: string) => value,
        emoji: { value: { map: {} } },
        isPrivate: { value: true },
      };
      const submit = new Function(...Object.keys(bindings), `${code}; return submitComment;`)(
        ...Object.values(bindings),
      );
      const payload = await submit();
      expect(payload.visibility).toBe('private');
      expect(payload.pid).toBe('replyId' in props ? props.replyId : undefined);
    }
  });

  it('offers a top-level private message to a signed-in user without a reply target', async () => {
    await expect(renderControl()).resolves.toContain('type="checkbox"');
  });

  it('hides the control before login', async () => {
    await expect(renderControl({ userInfo: { token: '', type: 'guest' } })).resolves.not.toContain(
      'type="checkbox"',
    );
  });

  it('offers administrators a private root and private replies to account-owned comments', async () => {
    const userInfo = { token: 'admin', type: 'administrator' };
    const root = await renderControl({ userInfo });
    expect(root).toContain('type="checkbox"');
    expect(root).toContain('Administrators only');
    const reply = await renderControl({ userInfo, replyId: 1, canPrivateReply: true });
    expect(reply).toContain('type="checkbox"');
    expect(reply).toContain('Participants only');
  });

  it('requires server permission when replying to an existing comment', async () => {
    await expect(renderControl({ replyId: 1 })).resolves.not.toContain('type="checkbox"');
    await expect(renderControl({ replyId: 1, canPrivateReply: true })).resolves.toContain(
      'type="checkbox"',
    );
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
