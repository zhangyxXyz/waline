const Base = require('./base.js');
const { normalizeOrder, toSqlOrder } = require('./order.js');
const { readPredicate } = require('../comment-privacy.js');
const visibilityEdit = require('../visibility-edit.js');

module.exports = class extends Base {
  async withThreadLock(id, run) {
    const transaction = this.model(this.tableName);
    return transaction.transaction(async () => {
      const scoped = Object.create(this);
      scoped.inCommentTransaction = true;
      scoped.model = (name) => this.model(name).db(transaction.db());
      if (id) await scoped.model(this.tableName).where({ id }).lock(true).select();
      return run(scoped);
    });
  }

  visibilityPolicy(users, user, id) {
    return visibilityEdit.policy(this, users, user, id);
  }

  async changeVisibility(users, user, id, data, revision) {
    const [before] = await this.select({ objectId: id });
    if (!before) throw visibilityEdit.fail('Comment not found', 404);
    return this.withThreadLock(before.rid || before.objectId, async (scoped) => {
      // Share the transaction connection with account reads, including with a one-connection pool.
      const scopedUsers = Object.create(users);
      scopedUsers.model = scoped.model;
      const policy = await scoped.visibilityPolicy(scopedUsers, user, id);
      if (!revision || revision !== policy.revision) {
        throw visibilityEdit.fail('visibilityStale', 409);
      }
      const target = data.visibility;
      if (!['public', 'private'].includes(target)) {
        throw visibilityEdit.fail('Invalid comment visibility', 400);
      }
      if (target !== (policy.comment.visibility || 'public')) {
        if (!policy[target].allowed) throw visibilityEdit.fail(policy[target].reason);
        Object.assign(
          data,
          target === 'private' ? policy.audience : { private_user_a: null, private_user_b: null },
        );
        data.visibility_source =
          String(user.objectId) === String(policy.comment.user_id) ? 'author' : 'admin';
      }
      return scoped.update(data, { objectId: id });
    });
  }
  mapOrderField(field) {
    return field === 'objectId' ? 'id' : field;
  }

  getOrder(order, desc) {
    return normalizeOrder(order, desc, (field) => this.mapOrderField(field));
  }

  getSqlOrder(order) {
    return toSqlOrder(order);
  }

  parseWhere(filter) {
    const where = {};

    if (think.isEmpty(filter)) {
      return where;
    }

    for (const k in filter) {
      if (k === '_privateViewer') {
        // ThinkJS raw SQL condition, generated only from authenticated numeric IDs.
        // oxlint-disable-next-line no-underscore-dangle
        where._string = readPredicate(filter[k]);
        continue;
      }
      if (k === 'objectId' || k === 'objectid') {
        where.id = filter[k];
        continue;
      }

      if (k === '_complex') {
        where[k] = this.parseWhere(filter[k]);
        continue;
      }

      if (filter[k] === undefined) {
        where[k] = null;
        continue;
      }

      if (Array.isArray(filter[k])) {
        if (filter[k][0] === 'IN' && filter[k][1].length === 0) {
          continue;
        }

        if (think.isDate(filter[k][1])) {
          filter[k][1] = think.datetime(filter[k][1]);
        }
      }

      where[k] = filter[k];
    }

    return where;
  }

  async select(where, { desc, field, limit, offset, order } = {}) {
    const instance = this.model(this.tableName);

    instance.where(this.parseWhere(where));
    const normalizedOrder = this.getOrder(order, desc);

    if (normalizedOrder.length > 0) {
      instance.order(this.getSqlOrder(normalizedOrder));
    }

    if (limit || offset) {
      instance.limit(offset ?? 0, limit);
    }

    if (field) {
      field.push('id');
      instance.field(field);
    }

    const data = await instance.select();

    return data.map(({ id, ...cmt }) => ({ ...cmt, objectId: id }));
  }

  async count(where = {}, { group } = {}) {
    const instance = this.model(this.tableName);

    instance.where(this.parseWhere(where));
    if (!group) {
      return instance.count();
    }

    instance.field([...group, 'COUNT(*) as count'].join(','));
    instance.group(group);

    return instance.select();
  }

  async add(data) {
    if (this.tableName === 'Comment' && data.pid && !this.inCommentTransaction) {
      return this.withThreadLock(data.rid || data.pid, async (scoped) => {
        const [parent] = await scoped.select({ objectId: data.pid });
        const [root] = await scoped.select({ objectId: data.rid });
        if (
          !parent ||
          !root ||
          parent.url !== data.url ||
          root.url !== data.url ||
          String(parent.rid || parent.objectId) !== String(root.objectId) ||
          ([parent, root].some((c) => c.visibility === 'private') &&
            (data.visibility !== 'private' ||
              String(data.private_user_a) !== String(parent.private_user_a) ||
              String(data.private_user_b) !== String(parent.private_user_b)))
        ) {
          throw visibilityEdit.fail('visibilityStale', 409);
        }
        return scoped.add(data);
      });
    }
    if (data.objectId) {
      data.id = data.objectId;
      delete data.objectId;
    }
    const date = new Date();

    data.createdAt ??= date;
    data.updatedAt ??= date;

    const instance = this.model(this.tableName);
    const id = await instance.add(data);

    return { ...data, objectId: id };
  }

  async update(data, where) {
    if (this.tableName === 'Comment' && !this.inCommentTransaction) {
      const list = await this.select(where);
      const result = [];
      for (const item of list) {
        result.push(
          ...(await this.withThreadLock(item.rid || item.objectId, (scoped) =>
            scoped.update(data, { ...where, objectId: item.objectId }),
          )),
        );
      }
      return result;
    }
    const list = await this.model(this.tableName).where(this.parseWhere(where)).select();

    return Promise.all(
      list.map(async (item) => {
        const updateData = typeof data === 'function' ? data(item) : data;

        await this.model(this.tableName).where({ id: item.id }).update(updateData);

        return { ...item, ...updateData, objectId: item.id };
      }),
    );
  }

  async delete(where) {
    const instance = this.model(this.tableName);

    return instance.where(this.parseWhere(where)).delete();
  }

  async setSeqId(id) {
    const instance = this.model(this.tableName);

    return instance.query(`ALTER TABLE ${instance.tableName} AUTO_INCREMENT = ${id};`);
  }
};
