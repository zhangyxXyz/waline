import { readFileSync } from 'node:fs';

import { transpileModule, ScriptTarget } from 'typescript';
import { describe, expect, it } from 'vitest';
import { compile, createSSRApp, ref, computed, watch } from 'vue';
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
        isPrivate: false,
        privateBlockedReason: '',
        visibilityMessage: (reason: string) => reason,
        onPrivateClick: () => {},
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
  it('blocks forbidden local toggles with a reason and never persists an edit draft when unlocked', () => {
    const script = source.slice(
      source.indexOf('const privateSelected ='),
      source.indexOf('const userMeta ='),
    );
    const code = transpileModule(script, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText;
    const alerts: string[] = [];
    const draft = ref('secret draft');
    const saved = ref('existing public draft');
    const controls = new Function(
      'ref',
      'computed',
      'watch',
      'props',
      'userInfo',
      'config',
      'privateDraft',
      'savedEditor',
      'notify',
      'getVisibilityPolicy',
      `${code}; return { privateChoice, visibilityPolicy, onPrivateClick, editor };`,
    )(
      ref,
      computed,
      watch,
      { edit: { visibility: 'private', objectId: 2 } },
      ref({ token: '' }),
      ref({ serverURL: 'https://example.invalid', locale: { visibilityOrigin: 'Cannot publish' } }),
      draft,
      saved,
      (message: string) => alerts.push(message),
      () => Promise.reject(new Error('No network expected')),
    );
    controls.visibilityPolicy.value = {
      public: { allowed: false, reason: 'visibilityOrigin' },
      private: { allowed: false, reason: 'visibilityReplies' },
    };
    let prevented = false;
    controls.onPrivateClick({
      preventDefault: () => {
        prevented = true;
      },
    });
    controls.privateChoice.value = false;
    expect(prevented).toBe(true);
    expect(alerts).toStrictEqual(['Cannot publish']);
    expect(controls.privateChoice.value).toBe(true);
    controls.visibilityPolicy.value = {
      public: { allowed: true, reason: '' },
      private: { allowed: false, reason: 'visibilityReplies' },
    };
    controls.privateChoice.value = false;
    expect(controls.editor.value).toBe('secret draft');
    controls.editor.value = 'edited secret';
    expect(saved.value).toBe('existing public draft');
    controls.privateChoice.value = true;
    expect(controls.privateChoice.value).toBe(true);
    expect(controls.editor.value).toBe('edited secret');
  });

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
      privateBlockedReason: 'visibilityParent',
    });
    expect(html).toContain(' checked');
    expect(html).toContain('aria-disabled="true"');
  });

  it('shows the visibility control for a public edit', async () => {
    await expect(renderControl({ edit: { visibility: 'public' } })).resolves.toContain(
      'type="checkbox"',
    );
  });

  it('shows a checked, disabled lock when editing a private message for either role', async () => {
    for (const type of ['guest', 'administrator']) {
      const html = await renderControl({
        edit: { visibility: 'private' },
        isPrivate: true,
        privateChoice: true,
        privateBlockedReason: 'visibilityOrigin',
        userInfo: { token: 'test-session', type },
      });
      expect(html).toContain('type="checkbox"');
      expect(html).toContain(' checked');
      expect(html).toContain('aria-disabled="true"');
    }
  });
});
