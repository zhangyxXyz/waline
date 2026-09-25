import { readFileSync } from 'node:fs';

import { ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { createDraftStore } from '../src/composables/drafts.js';

interface TestComment {
  objectId: number;
  level?: number;
  pid?: number;
  rid?: number;
  children?: TestComment[];
}
interface CommentResponse {
  count: number;
  totalPages: number;
  data: TestComment[];
}

const source = readFileSync(
  new URL('../src/components/WalineComment.vue', import.meta.url),
  'utf8',
);
const script = source.slice(source.indexOf('let abort:'), source.indexOf('const onLike ='));
const code = transpileModule(script, {
  compilerOptions: { target: ScriptTarget.ES2022 },
}).outputText;

const root = (objectId: number, level = 0): TestComment => ({ objectId, level, children: [] });
// oxlint-disable-next-line typescript/explicit-function-return-type
const fixture = () => {
  const child = { objectId: 2, pid: 1, rid: 1, level: 0 };
  const data = ref<TestComment[]>([{ ...root(1), children: [child] }, root(3)]);
  const reply = ref<unknown>(child);
  const edit = ref<unknown>(null);
  const count = ref(3);
  const page = ref(1);
  const totalPages = ref(1);
  const notify = vi.fn<(message: string) => void>();
  const getComment = vi
    .fn<(options: { page: number }) => Promise<CommentResponse>>()
    .mockResolvedValue({ count: 1, totalPages: 1, data: [root(3)] });
  const deleteComment = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const confirm = vi.fn<() => boolean>().mockReturnValue(true);
  const draftStore = createDraftStore();
  draftStore.set('root', { text: 'Keep my draft', privateSelected: true, visibility: 'private' });
  draftStore.set('reply:2', {
    text: 'Deleted target',
    privateSelected: true,
    visibility: 'private',
  });
  const bindings = {
    data,
    reply,
    edit,
    count,
    page,
    totalPages,
    draftStore,
    getComment,
    deleteComment,
    confirm,
    config: ref({ serverURL: 'https://example.invalid', path: '/', pageSize: 10, notify }),
    userInfo: ref({ token: 'test-session' }),
    commentSortingRef: ref('insertedAtDesc'),
    sortKeyMap: { insertedAtDesc: 'insertedAt_desc' },
    serviceClosed: ref(false),
    status: ref('success'),
    watch: (): void => {},
  };
  // Execute the actual SFC handlers rather than duplicating their implementation.
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval, typescript/no-unsafe-call
  const handlers = new Function(
    ...Object.keys(bindings),
    `let contextVersion = 0; ${code}; return { onDelete, onSubmit, changeContext: () => contextVersion++ };`,
  )(...Object.values(bindings)) as {
    onDelete: (comment: TestComment) => Promise<void>;
    onSubmit: (comment: TestComment) => void;
    changeContext: () => void;
  };
  return { ...bindings, ...handlers, notify };
};
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('comment mutations', () => {
  it('reloads cascade deletions and restores the root editor without clearing its draft', async () => {
    const f = fixture();
    await f.onDelete({ objectId: 1 });
    await settle();
    expect(f.reply.value).toBeNull();
    expect(f.data.value.map((comment) => comment.objectId)).toStrictEqual([3]);
    expect(f.count.value).toBe(1);
    expect(f.draftStore.get('root')?.text).toBe('Keep my draft');
    expect(f.draftStore.get('reply:2')).toBeUndefined();
  });

  it('clears editing a deleted child and handles the last comment', async () => {
    const f = fixture();
    f.reply.value = null;
    f.edit.value = { objectId: 2, pid: 1, rid: 1 };
    f.getComment.mockResolvedValue({ count: 0, totalPages: 0, data: [] });
    await f.onDelete({ objectId: 2 });
    await settle();
    expect(f.edit.value).toBeNull();
    expect(f.count.value).toBe(0);
    expect(f.data.value).toStrictEqual([]);
    expect(f.page.value).toBe(1);
  });

  it('does not cancel an unrelated reply', async () => {
    const f = fixture();
    f.reply.value = { objectId: 3 };
    await f.onDelete({ objectId: 1 });
    expect(f.reply.value).toStrictEqual({ objectId: 3 });
  });

  it('preserves the editor and list after failed or cancelled deletion', async () => {
    const f = fixture();
    f.confirm.mockReturnValue(false);
    await f.onDelete({ objectId: 1 });
    expect(f.deleteComment).not.toHaveBeenCalled();
    f.confirm.mockReturnValue(true);
    f.deleteComment.mockRejectedValue(new Error('Delete failed'));
    await f.onDelete({ objectId: 1 });
    expect(f.notify).toHaveBeenCalledWith('Delete failed');
    expect(f.reply.value).not.toBeNull();
    expect(f.data.value).toHaveLength(2);
    expect(f.count.value).toBe(3);
    expect(f.getComment).not.toHaveBeenCalled();
  });

  it('ignores a delete response belonging to an old page, account or unmounted instance', async () => {
    const f = fixture();
    let complete = (): void => {};
    f.deleteComment.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = f.onDelete({ objectId: 1 });
    f.changeContext();
    complete();
    await pending;
    expect(f.getComment).not.toHaveBeenCalled();
    expect(f.reply.value).not.toBeNull();
  });

  it('refreshes levels on existing and newly submitted comments', async () => {
    const f = fixture();
    f.reply.value = null;
    f.getComment.mockResolvedValue({
      count: 4,
      totalPages: 1,
      data: [root(4, 1), root(1, 1), root(3, 1)],
    });
    f.onSubmit(root(4));
    await settle();
    expect(f.data.value.map((comment) => comment.level)).toStrictEqual([1, 1, 1]);
    expect(f.count.value).toBe(4);
  });

  it('updates reply counts and reloads every already loaded page', async () => {
    const f = fixture();
    f.page.value = 2;
    f.getComment.mockImplementation(({ page }) =>
      Promise.resolve({
        count: 4,
        totalPages: 2,
        data: [root([1, 3][page - 1], 1)],
      }),
    );
    f.onSubmit({ objectId: 4, pid: 1, rid: 1 });
    expect(f.count.value).toBe(4);
    await settle();
    expect(f.getComment.mock.calls.map(([options]) => options.page)).toStrictEqual([1, 2]);
    expect(f.data.value.map((comment) => comment.objectId)).toStrictEqual([1, 3]);
    expect(f.page.value).toBe(2);
  });

  it('discards an older refresh when another comment is submitted', async () => {
    const f = fixture();
    let complete = (_value: CommentResponse): void => {};
    f.getComment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    f.onSubmit(root(4));
    f.getComment.mockResolvedValue({ count: 5, totalPages: 1, data: [root(5, 2)] });
    f.onSubmit(root(5));
    await settle();
    complete({ count: 4, totalPages: 1, data: [root(4, 1)] });
    await settle();
    expect(f.data.value).toStrictEqual([root(5, 2)]);
    expect(f.count.value).toBe(5);
  });
});
