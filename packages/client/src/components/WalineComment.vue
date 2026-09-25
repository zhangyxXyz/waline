<script setup lang="ts">
//

import { useStyleTag, watchImmediate } from '@vueuse/core';
import type { WalineComment, WalineCommentStatus, WalineRootComment } from '@waline/api';
import { deleteComment, getComment, updateComment } from '@waline/api';
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';

import { createDraftStore, draftStoreKey } from '../composables/drafts.js';
import { useLikeStorage, useUserInfo } from '../composables/index.js';
import { configKey, sortingMethods, sortKeyMap } from '../config/index.js';
import type { WalineCommentSorting, WalineProps } from '../typings/index.js';
import { getConfig, getDarkStyle } from '../utils/index.js';
import { version } from '../version.js';
import ArticleReaction from './ArticleReaction.vue';
import CommentBox from './CommentBox.vue';
import CommentCard from './CommentCard.vue';
import { LoadingIcon, RssIcon } from './Icons.js';

// oxlint-disable-next-line vue/define-props-destructuring
const props = defineProps<WalineProps>();

const userInfo = useUserInfo();
const likeStorage = useLikeStorage();

const status = ref<'loading' | 'success' | 'error'>('loading');

const count = ref(0);
const serviceClosed = ref(false);
const page = ref(1);
const totalPages = ref(0);

const config = computed(() => getConfig(props as WalineProps));
const draftStore = createDraftStore();
let contextVersion = 0;
provide(draftStoreKey, draftStore);
watch(
  () => [config.value.serverURL, config.value.path, userInfo.value.token],
  () => {
    contextVersion += 1;
    draftStore.clear();
  },
  { flush: 'sync' },
);
onUnmounted(() => draftStore.clear());

const commentSortingRef = ref(config.value.commentSorting);

const data = ref<WalineRootComment[]>([]);
const reply = ref<WalineComment | null>(null);
const edit = ref<WalineComment | null>(null);

const darkmodeStyle = computed(() => getDarkStyle(config.value.dark));

const i18n = computed(() => config.value.locale);

useStyleTag(darkmodeStyle, { id: 'waline-darkmode' });

let abort: (() => void) | null = null;

const getCommentData = (pageNumber: number, replace = false): void => {
  const { serverURL, path, pageSize } = config.value;
  const controller = new AbortController();

  status.value = 'loading';

  abort?.();

  const options = {
    serverURL,
    lang: config.value.lang,
    path,
    pageSize,
    sortBy: sortKeyMap[commentSortingRef.value],
    signal: controller.signal,
    token: userInfo.value.token,
  };
  // Reload the visible pages after mutations: counts, levels and cascaded
  // deletions are authoritative on the server, including private visibility.
  const pages = replace
    ? Array.from({ length: pageNumber }, (_, index) => index + 1)
    : [pageNumber];
  Promise.all(pages.map((page) => getComment({ ...options, page })))
    .then((responses) => {
      if (controller.signal.aborted) return;
      const [resp] = responses;
      status.value = 'success';
      count.value = resp.count;
      serviceClosed.value = Boolean(resp.closed);
      if (serviceClosed.value) {
        data.value = [];
        reply.value = null;
        edit.value = null;
      }
      const comments = responses.flatMap((response) => response.data);
      if (replace) data.value = comments;
      else data.value.push(...comments);
      page.value = Math.min(pageNumber, Math.max(1, resp.totalPages));
      totalPages.value = resp.totalPages;
    })
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    .catch((err: unknown) => {
      if (!controller.signal.aborted && (err as Error).name !== 'AbortError') {
        // oxlint-disable-next-line no-console
        console.error((err as Error).message);
        status.value = 'error';
      }
    });

  abort = controller.abort.bind(controller);
};

const loadMore = (): void => {
  getCommentData(page.value + 1);
};

const refreshComments = (): void => {
  count.value = 0;
  reply.value = null;
  edit.value = null;
  data.value = [];
  getCommentData(1);
};

watch(
  () => userInfo.value.token,
  () => {
    abort?.();
    reply.value = null;
    edit.value = null;
    refreshComments();
  },
  { flush: 'sync' },
);

const onSortByChange = (item: WalineCommentSorting): void => {
  if (commentSortingRef.value !== item) {
    commentSortingRef.value = item;
    refreshComments();
  }
};

const onReply = (comment: WalineComment | null): void => {
  if (comment) edit.value = null;
  reply.value = comment;
};

const onEdit = (comment: WalineComment | null): void => {
  if (comment) reply.value = null;
  edit.value = comment;
};

const onSubmit = (comment: WalineComment): void => {
  if (edit.value) {
    edit.value.comment = comment.comment;
    edit.value.orig = comment.orig;
  } else if ('rid' in comment) {
    const repliedComment = data.value.find(({ objectId }) => objectId === comment.rid);

    if (repliedComment) {
      if (!Array.isArray(repliedComment.children)) repliedComment.children = [];
      repliedComment.children.push(comment);
    }
    count.value += 1;
  } else {
    data.value.unshift(comment);
    count.value += 1;
  }
  getCommentData(page.value, true);
};

const onStatusChange = async ({
  comment,
  status,
}: {
  comment: WalineComment;
  status: WalineCommentStatus;
}): Promise<void> => {
  if (comment.status === status) return;

  const { serverURL, lang } = config.value;

  await updateComment({
    serverURL,
    lang,
    token: userInfo.value.token,
    objectId: comment.objectId,
    comment: { status },
  });

  comment.status = status;
};

const onSticky = async (comment: WalineComment): Promise<void> => {
  if ('rid' in comment) return;

  const { serverURL, lang } = config.value;

  await updateComment({
    serverURL,
    lang,
    token: userInfo.value.token,
    objectId: comment.objectId,
    comment: { sticky: comment.sticky ? 0 : 1 },
  });

  comment.sticky = !comment.sticky;
};

const onDelete = async ({ objectId }: WalineComment): Promise<void> => {
  if (!confirm('Are you sure you want to delete this comment?')) return;

  const { serverURL, lang } = config.value;
  const version = contextVersion;

  try {
    await deleteComment({
      serverURL,
      lang,
      token: userInfo.value.token,
      objectId,
    });
    if (version !== contextVersion) return;

    const removed = (comment: WalineComment): boolean =>
      comment.objectId === objectId ||
      ('pid' in comment && (comment.pid === objectId || comment.rid === objectId));
    for (const root of data.value) {
      for (const comment of [root, ...(root.children || [])]) {
        if (removed(comment)) {
          draftStore.delete(`edit:${comment.objectId}`);
          draftStore.delete(`reply:${comment.objectId}`);
        }
      }
    }
    if (reply.value && removed(reply.value)) reply.value = null;
    if (edit.value && removed(edit.value)) edit.value = null;
    getCommentData(page.value, true);
  } catch (err: unknown) {
    if (version === contextVersion) config.value.notify((err as Error).message);
  }
};

const onLike = async (comment: WalineComment): Promise<void> => {
  const { serverURL, lang } = config.value;
  const { objectId } = comment;
  const hasLiked = likeStorage.value.includes(objectId);

  await updateComment({
    serverURL,
    lang,
    objectId,
    token: userInfo.value.token,
    comment: { like: !hasLiked },
  });

  if (hasLiked) {
    likeStorage.value = likeStorage.value.filter((id) => id !== objectId);
  } else {
    likeStorage.value = [...likeStorage.value, objectId];

    if (likeStorage.value.length > 50) {
      likeStorage.value = likeStorage.value.slice(-50);
    }
  }

  comment.like = Math.max(0, (comment.like || 0) + (hasLiked ? -1 : 1));
};

provide(configKey, config);

onMounted(async () => {
  watchImmediate(
    () => [props.serverURL, props.path],
    () => {
      refreshComments();
    },
  );

  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');

  if (!token) {
    return;
  }

  const resp = await fetch(`${config?.value.serverURL}/token`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
    .then((res) => res.json())
    .catch((err) => {
      // oxlint-disable-next-line no-console
      console.error(err);
      return {};
    });

  if (!resp.errno && resp?.data?.objectId) {
    userInfo.value = { ...resp.data, token };
  }

  const url = new URL(window.location.href);
  url.searchParams.delete('token');

  history.replaceState(
    null,
    '',
    url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') +
      url.hash,
  );
});
onUnmounted(() => {
  contextVersion += 1;
  abort?.();
});
</script>

<template>
  <div data-waline>
    <ArticleReaction />

    <CommentBox
      v-if="!serviceClosed && !reply && !edit"
      @log="refreshComments"
      @submit="onSubmit"
    />

    <div class="wl-meta-head">
      <div class="wl-count">
        <span v-if="count" class="wl-num" v-text="count" />
        {{ i18n.comment }}
      </div>

      <ul class="wl-sort">
        <li
          v-for="item in sortingMethods"
          :key="item"
          :class="[item === commentSortingRef ? 'active' : '']"
          @click="onSortByChange(item)"
        >
          {{ i18n[item] }}
        </li>
      </ul>
    </div>

    <div class="wl-cards">
      <CommentCard
        v-for="comment in data"
        :key="comment.objectId"
        :root-id="comment.objectId"
        :comment="comment"
        :reply="reply"
        :edit="edit"
        @log="refreshComments"
        @reply="onReply"
        @edit="onEdit"
        @submit="onSubmit"
        @status="onStatusChange"
        @delete="onDelete"
        @sticky="onSticky"
        @like="onLike"
      />
    </div>

    <div v-if="status === 'error'" class="wl-operation">
      <button type="button" class="wl-btn" @click="refreshComments" v-text="i18n.refresh" />
    </div>

    <div v-else-if="status === 'loading'" class="wl-loading">
      <LoadingIcon :size="30" />
    </div>

    <div v-else-if="!data.length" class="wl-empty" v-text="i18n.sofa" />

    <!-- Load more button -->
    <div v-else-if="page < totalPages" class="wl-operation">
      <button type="button" class="wl-btn" @click="loadMore" v-text="i18n.more" />
    </div>

    <div class="wl-meta-foot" v-if="data.length || status !== 'loading'">
      <div v-if="!config.noRss" class="wl-rss">
        <a
          :href="`${config.serverURL}/api/comment/rss?path=${encodeURIComponent(config.path)}`"
          target="_blank"
          rel="noopener noreferrer"
          :alt="i18n.subPostComment"
        >
          <RssIcon />
          <span v-text="i18n.subPostComment" />
        </a>

        <a
          :href="`${config.serverURL}/api/comment/rss`"
          target="_blank"
          rel="noopener noreferrer"
          :alt="i18n.subSiteComment"
        >
          <RssIcon />
          <span v-text="i18n.subSiteComment" />
        </a>
      </div>

      <!-- Copyright Information -->
      <div v-if="!config.noCopyright" class="wl-power">
        Powered by
        <a href="https://github.com/walinejs/waline" target="_blank" rel="noopener noreferrer">
          Waline
        </a>
        v{{ version }}
      </div>
    </div>
  </div>
</template>
