import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';

import { createDraftStore } from './drafts.js';

describe('page comment drafts', () => {
  it('restores separate reply and edit text, including an intentionally empty edit', () => {
    const store = createDraftStore();
    const reply = reactive({
      text: 'unfinished reply',
      privateSelected: true,
      visibility: 'public' as const,
    });
    store.set('reply:1', reply);
    store.set('edit:1', { text: '', privateSelected: false, visibility: 'private' });
    store.set('reply:2', {
      text: 'another recipient',
      privateSelected: false,
      visibility: 'public',
    });
    expect(store.get('reply:1')).toBe(reply);
    expect(store.get('reply:1')?.privateSelected).toBe(true);
    expect(store.get('edit:1')?.text).toBe('');
    expect(store.get('edit:1')?.visibility).toBe('private');
    store.delete('edit:1');
    expect(store.get('edit:1')).toBeUndefined();
    expect(store.get('reply:1')?.text).toBe('unfinished reply');
    expect(store.get('reply:2')?.text).toBe('another recipient');
  });

  it('does not share drafts between instances or recover cleared account/page drafts', () => {
    const store = createDraftStore();
    const oldDraft = {
      text: 'private text',
      privateSelected: true,
      visibility: 'private' as const,
    };
    store.set('reply:1', oldDraft);
    expect(createDraftStore().get('reply:1')).toBeUndefined();
    store.clear();
    oldDraft.text = 'late upload response';
    expect(store.get('reply:1')).toBeUndefined();
  });
});
