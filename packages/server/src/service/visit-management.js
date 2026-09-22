const { createHash } = require('node:crypto');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const path = (value) => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.length > 255 ||
    /[?#\\\s]/u.test(value)
  ) {
    throw fail('Invalid page path');
  }
  if (new URL(value, 'https://example.invalid').pathname !== value) {
    throw fail('Noncanonical page path');
  }
  return value;
};
const count = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) {
    throw fail('Invalid page count');
  }
  return value;
};
const validate = (items) => {
  if (!Array.isArray(items) || !items.length || items.length > 5000) {
    throw fail('Expected 1–5000 counters');
  }
  const seen = new Set();
  return items
    .map((item) => {
      const url = path(item?.url);
      if (seen.has(url)) throw fail('Duplicate page path');
      seen.add(url);
      return { url, time: count(item.time) };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
};
const snapshot = async (model) => {
  const rows = await model.select(
    {},
    { field: ['url', 'time'], order: [{ field: 'url', direction: 'asc' }] },
  );
  return rows.map(({ objectId, url, time }) => ({ objectId, url, time: Number(time) || 0 }));
};
const preview = async (model, input) => {
  const items = validate(input);
  const current = await snapshot(model);
  const rows = items.map((item) => {
    const found = current.filter((row) => row.url === item.url);
    if (found.length > 1) throw fail('Duplicate stored paths require reconciliation', 409);
    const before = found[0]?.time || 0;
    return { ...item, before, after: Math.max(before, item.time), exists: Boolean(found.length) };
  });
  return { rows, token: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
};
const apply = async (model, input, token) => {
  if (model.withCounterTransaction && !model.inCounterTransaction) {
    return model.withCounterTransaction((scoped) => apply(scoped, input, token));
  }
  const plan = await preview(model, input);
  if (plan.token !== token) throw fail('Counters changed; preview again', 409);
  for (const row of plan.rows) {
    if (row.exists && row.after === row.before) continue;
    if (row.exists) {
      const changed = await model.update(
        { time: row.after, updatedAt: new Date() },
        { url: row.url, time: row.before },
      );
      if (!changed.length) throw fail('Counters changed; preview again', 409);
    } else {
      await model.add({ url: row.url, time: row.after });
    }
  }
  return { updated: plan.rows.filter((row) => !row.exists || row.before !== row.after).length };
};
const edit = async (model, value) => {
  if (model.withCounterTransaction && !model.inCounterTransaction) {
    return model.withCounterTransaction((scoped) => edit(scoped, value));
  }
  const { url, time, before } = value;
  path(url);
  count(time);
  count(before);
  const rows = await model.select({ url });
  if (rows.length !== 1 || Number(rows[0].time || 0) !== before) {
    throw fail('Counters changed; refresh first', 409);
  }
  const changed = await model.update(
    { time, updatedAt: new Date() },
    { objectId: rows[0].objectId, time: rows[0].time },
  );
  if (!changed.length) throw fail('Counters changed; refresh first', 409);
  return { updated: true };
};
module.exports = { path, count, validate, snapshot, preview, apply, edit };
