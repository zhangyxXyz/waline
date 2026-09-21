// Public aggregates only: never return comment bodies, account IDs, email or IP.
const {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} = require('node:crypto');

const key = createHash('sha256')
  .update(process.env.JWT_TOKEN || randomBytes(32))
  .digest();
const publicRow = (row) => row.visibility !== 'private' && row.status === 'approved';
// Authenticated opaque tokens allow indexed server-side filtering without publishing email/account IDs.
const authorKey = (row) => {
  const identity = row.user_id
    ? `user:${row.user_id}`
    : row.mail
      ? `mail:${row.mail.trim().toLowerCase()}`
      : `nick:${row.nick || ''}`;
  const iv = createHmac('sha256', key).update(identity).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(identity, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('hex');
};
const authorWhere = (token) => {
  try {
    const bytes = Buffer.from(token, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const identity = Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
    const split = identity.indexOf(':');
    const type = identity.slice(0, split);
    const value = identity.slice(split + 1);
    if (type === 'user') return { user_id: value };
    // Only static SQL is used here; values go through the model's parameter escaping.
    if (type === 'mail') {
      return { mail: value, _complex: { _string: '(user_id IS NULL OR user_id = 0)' } };
    }
    if (type === 'nick') {
      return {
        nick: value,
        _complex: { _string: "(user_id IS NULL OR user_id = 0) AND (mail IS NULL OR mail = '')" },
      };
    }
    throw new Error();
  } catch {
    throw Object.assign(new Error('Invalid contributor; refresh statistics'), { status: 400 });
  }
};
const commentList = (rows, { author, url, page = 1, pageSize = 20 }) => {
  const matches = rows.filter(
    (row) => publicRow(row) && (!author || authorKey(row) === author) && (!url || row.url === url),
  );
  matches.sort(
    (a, b) =>
      (new Date(b.insertedAt).getTime() || 0) - (new Date(a.insertedAt).getTime() || 0) ||
      String(b.objectId).localeCompare(String(a.objectId), 'en', { numeric: true }),
  );
  const offset = (page - 1) * pageSize;
  return {
    total: matches.length,
    page,
    pageSize,
    hasMore: offset + pageSize < matches.length,
    items: matches.slice(offset, offset + pageSize).map((row) => ({
      id: String(row.objectId),
      url: row.url || '',
      nick: row.nick || '',
      time: row.insertedAt,
    })),
  };
};
const aggregateComments = async (rows, resolveRegion, settings, now = new Date()) => {
  const months = new Map();
  const people = new Map();
  const content = new Map();
  const china = new Map();
  const world = new Map();
  const regions = new Map();
  let total = 0;
  const add = (map, name) => {
    if (name) map.set(name, (map.get(name) || 0) + 1);
  };
  for (const row of rows) {
    if (!publicRow(row)) continue;
    total++;
    add(content, row.url);
    const date = new Date(row.insertedAt);
    if (Number.isFinite(date.getTime()) && date <= now) add(months, date.toISOString().slice(0, 7));
    const identity = authorKey(row);
    const person = people.get(identity) || { key: identity, name: row.nick || '', value: 0 };
    person.value++;
    people.set(identity, person);
    if (settings.level === 'off' || !row.ip) continue;
    if (!regions.has(row.ip)) {
      const country = await resolveRegion(row.ip, { level: 'country', country: true });
      const province =
        settings.level === 'country' ? '' : await resolveRegion(row.ip, { level: 'province' });
      regions.set(row.ip, { country, province });
    }
    const { country, province } = regions.get(row.ip);
    if (settings.country || settings.level === 'country') add(world, country);
    if (country === '中国' && province) {
      add(
        china,
        province.replace(/省$|市$|壮族自治区$|回族自治区$|维吾尔自治区$|自治区$|特别行政区$/u, ''),
      );
    }
  }
  const trend = [];
  const first = [...months.keys()].sort()[0];
  if (first) {
    const cursor = new Date(`${first}-01T00:00:00Z`);
    while (cursor <= now) {
      const name = cursor.toISOString().slice(0, 7);
      trend.push({ name, value: months.get(name) || 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const points = (map) => [...map].map(([name, value]) => ({ name, value }));
  return {
    version: 1,
    total,
    participants: people.size,
    trend,
    content: points(content),
    ranking: [...people.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
    regions: { china: points(china), world: points(world) },
  };
};
// Enrich only the already-filtered public page; never serialize mail or account IDs.
const withAvatars = async (result, rows, users, resolveAvatar, proxy) => {
  const comments = new Map(rows.map((row) => [String(row.objectId), row]));
  const accounts = new Map(users.map((user) => [String(user.objectId), user]));
  return {
    ...result,
    items: await Promise.all(
      result.items.map(async (item) => {
        const row = comments.get(item.id);
        if (!row) return item;
        const user = accounts.get(String(row.user_id));
        const avatar =
          user?.avatar ||
          (await resolveAvatar({
            nick: user?.display_name || row.nick || '',
            mail: user?.email || row.mail || '',
          }));
        return {
          ...item,
          avatar:
            proxy && avatar && !avatar.includes(proxy)
              ? `${proxy}?url=${encodeURIComponent(avatar)}`
              : avatar,
        };
      }),
    ),
  };
};
module.exports = { aggregateComments, commentList, authorKey, authorWhere, withAvatars };
