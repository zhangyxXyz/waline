import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  aggregateComments,
  commentList,
  authorKey,
  authorWhere,
  withAvatars,
} = require('../src/service/comment-statistics.js');
const publicComment = {
  visibility: 'public',
  status: 'approved',
  nick: 'Visitor',
  mail: 'visitor@example.test',
  ip: '192.0.2.1',
  insertedAt: '2026-01-10T00:00:00Z',
};
const now = new Date('2026-03-15T00:00:00Z');

describe('public comment statistics', () => {
  it('adds public avatars without leaking account details or hydrating private rows', async () => {
    const rows = [
      { ...publicComment, objectId: 1, user_id: 7 },
      { ...publicComment, objectId: 2 },
      { ...publicComment, objectId: 3, visibility: 'private' },
    ];
    const avatar = vi.fn(async () => 'https://avatar.test/guest.png');
    const result = await withAvatars(
      commentList(rows, {}),
      rows,
      [
        {
          objectId: 7,
          avatar: 'https://avatar.test/member.png',
          email: 'secret@test',
          display_name: 'Member',
        },
      ],
      avatar,
      'https://proxy.test/avatar',
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0].avatar).toBe(
      'https://proxy.test/avatar?url=https%3A%2F%2Favatar.test%2Fguest.png',
    );
    expect(result.items[1].avatar).toContain('member.png');
    expect(avatar).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/secret|mail|user_id|192\.0\.2/u);
  });

  it('authenticates opaque contributor tokens and builds server-side filters', () => {
    expect(authorWhere(authorKey({ ...publicComment, user_id: 12 }))).toStrictEqual({
      user_id: '12',
    });
    expect(authorWhere(authorKey(publicComment))).toMatchObject({ mail: 'visitor@example.test' });
    expect(authorWhere(authorKey({ nick: 'Guest' }))).toMatchObject({ nick: 'Guest' });
    expect(() => authorWhere('a'.repeat(80))).toThrow('Invalid contributor');
  });

  it('excludes private, pending and spam comments and returns no sensitive fields', async () => {
    const lookup = vi.fn(async (_ip, options) => (options.level === 'country' ? '中国' : '北京市'));
    const rows = [
      publicComment,
      ...['private', 'waiting', 'spam'].map((value) => ({
        ...publicComment,
        nick: 'Hidden',
        mail: 'secret@example.test',
        ip: '192.0.2.9',
        ...(value === 'private' ? { visibility: value } : { status: value }),
      })),
    ];
    const result = await aggregateComments(rows, lookup, { level: 'province', country: true }, now);
    expect(result.total).toBe(1);
    expect(result.participants).toBe(1);
    expect(result.regions).toStrictEqual({
      china: [{ name: '北京', value: 1 }],
      world: [{ name: '中国', value: 1 }],
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|example\.test|192\.0\.2|user_id|mail|"ip"/u);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('fills missing months and merges repeated public contributors', async () => {
    const rows = [
      publicComment,
      { ...publicComment, mail: 'VISITOR@example.test', insertedAt: '2026-03-01T00:00:00Z' },
    ];
    const result = await aggregateComments(rows, vi.fn(), { level: 'off', country: true }, now);
    expect(result.trend).toStrictEqual([
      { name: '2026-01', value: 1 },
      { name: '2026-02', value: 0 },
      { name: '2026-03', value: 1 },
    ]);
    expect(result.ranking).toStrictEqual([
      { key: authorKey(publicComment), name: 'Visitor', value: 2 },
    ]);
    expect(result.participants).toBe(1);
  });

  it('honors region-off, country-only, and hidden-country settings', async () => {
    const lookup = vi.fn(async (_ip, options) => (options.level === 'country' ? '中国' : '北京市'));
    const off = await aggregateComments(
      [publicComment],
      lookup,
      { level: 'off', country: true },
      now,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(off.regions).toStrictEqual({ china: [], world: [] });
    const country = await aggregateComments(
      [publicComment],
      lookup,
      { level: 'country', country: false },
      now,
    );
    expect(country.regions).toStrictEqual({ china: [], world: [{ name: '中国', value: 1 }] });
    const province = await aggregateComments(
      [publicComment],
      lookup,
      { level: 'province', country: false },
      now,
    );
    expect(province.regions).toStrictEqual({ china: [{ name: '北京', value: 1 }], world: [] });
  });

  it('returns an honest empty result and does not create fake dates', async () => {
    const result = await aggregateComments([], vi.fn(), { level: 'off' }, now);
    expect(result).toStrictEqual({
      version: 1,
      total: 0,
      participants: 0,
      trend: [],
      ranking: [],
      content: [],
      regions: { china: [], world: [] },
    });
  });

  it('paginates public comments and filters contributors without exposing their identity', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      ...publicComment,
      objectId: i + 1,
      url: i % 2 ? '/guestbook/' : '/posts/1.html',
    }));
    rows.push({ ...publicComment, objectId: 26, visibility: 'private' });
    const result = commentList(rows, { author: authorKey(publicComment), page: 2, pageSize: 20 });
    expect(result.total).toBe(25);
    expect(result.items.map((item) => item.id)).toStrictEqual(['5', '4', '3', '2', '1']);
    expect(result.hasMore).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/mail|user_id|192\.0\.2/u);
    expect(commentList(rows, { url: '/guestbook/' }).total).toBe(12);
    expect(commentList(rows, { author: 'a'.repeat(64) }).total).toBe(0);
  });

  it('returns all contributors so the client can select TOP 10, 20, 50 or all', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      ...publicComment,
      user_id: i + 1,
      url: '/guestbook/',
    }));
    const result = await aggregateComments(rows, vi.fn(), { level: 'off' }, now);
    expect(result.ranking).toHaveLength(60);
    expect(result.content).toStrictEqual([{ name: '/guestbook/', value: 60 }]);
  });
});
