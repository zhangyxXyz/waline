import type { InjectionKey } from 'vue';

export interface CommentDraft {
  text: string;
  privateSelected: boolean;
  visibility: 'public' | 'private';
}

export interface DraftStore {
  get: (key: string) => CommentDraft | undefined;
  set: (key: string, draft: CommentDraft) => void;
  delete: (key: string) => void;
  clear: () => void;
}

// Owned by one Waline instance; never persisted to browser storage.
export const createDraftStore = (): DraftStore => {
  const drafts = new Map<string, CommentDraft>();
  return {
    get: (key: string): CommentDraft | undefined => drafts.get(key),
    set: (key: string, draft: CommentDraft): void => {
      drafts.set(key, draft);
    },
    delete: (key: string): void => {
      drafts.delete(key);
    },
    clear: (): void => {
      drafts.clear();
    },
  };
};

export const draftStoreKey: InjectionKey<ReturnType<typeof createDraftStore>> =
  Symbol('waline-drafts');
