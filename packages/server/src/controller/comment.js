const BaseRest = require('./rest.js');
const levelSettings = require('../service/level-settings.js');
const regionSettings = require('../service/region-settings.js');
const regionDatabase = require('../service/region-database.js');
const dashboard = require('../service/dashboard-settings.js');

const currentRegionSettings = () =>
  regionSettings.read({
    level: think.config('disableRegion') ? 'off' : think.config('regionLevel') || 'province',
    country: Boolean(think.config('regionShowCountry')),
  });
const {
  active,
  same,
  participant,
  isPrivate,
  canRead,
  createAudience,
} = require('../service/comment-privacy.js');
const { getMarkdownParser } = require('../service/markdown/index.js');

const markdownParser = getMarkdownParser(think.config('markdown'));

const formatCmt = async (
  { ua, ip, ...comment },
  { avatarProxy, deprecated },
  loginUser,
  users = [],
) => {
  if (!canRead(loginUser, comment)) {
    throw Object.assign(new Error('Comment not found'), { status: 404 });
  }
  comment.canPrivateReply =
    think.config('storage') === 'mysql' &&
    active(loginUser) &&
    (isPrivate(comment)
      ? participant(loginUser, comment)
      : Boolean(comment.user_id) && !same(comment.user_id, loginUser.objectId));
  comment.canReply = !isPrivate(comment) || participant(loginUser, comment);
  delete comment.private_user_a;
  delete comment.private_user_b;
  delete comment.visibility_source;
  ua = think.uaParser(ua);
  if (!think.config('disableUserAgent')) {
    comment.browser = `${ua.browser.name || ''}${(ua.browser.version || '')
      .split('.')
      .slice(0, 2)
      .join('.')}`;
    comment.os = [ua.os.name, ua.os.version].filter(Boolean).join(' ');
  }

  const user = users.find(({ objectId }) => comment.user_id === objectId);

  if (!think.isEmpty(user)) {
    comment.nick = user.display_name;
    comment.mail = user.email;
    comment.link = user.url;
    comment.type = user.type;
    comment.label = user.label;
  }

  const avatarUrl = user?.avatar || (await think.service('avatar').stringify(comment));

  comment.avatar =
    avatarProxy && !avatarUrl.includes(avatarProxy)
      ? `${avatarProxy}?url=${encodeURIComponent(avatarUrl)}`
      : avatarUrl;

  const isAdmin = loginUser && loginUser.type === 'administrator';

  if (loginUser) {
    comment.orig = comment.comment;
  }

  if (isAdmin) {
    comment.ip = ip;
  } else {
    delete comment.mail;
  }

  // administrator can always show region
  const region = currentRegionSettings();
  if (isAdmin || region.level !== 'off') {
    comment.addr = await think.ip2region(ip, {
      level: isAdmin ? 'isp' : region.level,
      country: isAdmin || region.country,
    });
  }

  comment.comment = (await markdownParser)(comment.comment);
  comment.like = Number(comment.like) || 0;

  // compat sql storage return number flag to string
  if (typeof comment.sticky === 'string') {
    comment.sticky = Boolean(Number(comment.sticky));
  }

  comment.time = new Date(comment.insertedAt).getTime();
  if (!deprecated) {
    delete comment.insertedAt;
  }

  delete comment.createdAt;
  delete comment.updatedAt;

  return comment;
};

module.exports = class CommentController extends BaseRest {
  constructor(ctx) {
    super(ctx);
    this.modelInstance = this.getModel('Comment');
  }

  async getAction() {
    this.ctx.set('Cache-Control', 'private, no-store');
    if (this.get('type') === 'visibility') {
      if (this.config('storage') !== 'mysql') return this.ctx.throw(400, 'visibilityUnsupported');
      const policy = await this.modelInstance.visibilityPolicy(this.getModel('Users'), this.id);
      return this.success({
        public: policy.public,
        private: policy.private,
        revision: policy.revision,
        original: policy.comment.comment,
        visibility: policy.comment.visibility || 'public',
      });
    }
    if (this.get('type') === 'image-upload') return this.success(dashboard.images());
    if (this.get('type') === 'service-status') {
      return this.success({ enabled: dashboard.allowed(this.ctx.state.userInfo) });
    }
    if (['statistics', 'statistics-comments'].includes(this.get('type'))) {
      // Public statistics have the same audience even when requested by an admin.
      if (!dashboard.allowed({})) return this.ctx.throw(403);
      const {
        aggregateComments,
        commentList,
        authorWhere,
      } = require('../service/comment-statistics.js');
      const rows = [];
      const where = {
        status: 'approved',
        ...(this.config('storage') === 'mysql' ? { visibility: 'public' } : {}),
      };
      if (this.get('type') === 'statistics-comments' && this.config('storage') === 'mysql') {
        const { author, url, page, pageSize } = this.get();
        if (url) where.url = url;
        if (author) Object.assign(where, authorWhere(author));
        const total = await this.modelInstance.count(where);
        const items = await this.modelInstance.select(where, {
          field: ['url', 'nick', 'insertedAt'],
          order: [
            { field: 'insertedAt', direction: 'desc' },
            { field: 'objectId', direction: 'desc' },
          ],
          offset: (page - 1) * pageSize,
          limit: pageSize,
        });
        return this.success({
          total,
          page,
          pageSize,
          hasMore: page * pageSize < total,
          items: items.map((row) => ({
            id: String(row.objectId),
            url: row.url || '',
            nick: row.nick || '',
            time: row.insertedAt,
          })),
        });
      }
      for (let offset = 0; ; offset += 500) {
        if (offset >= 100000) return this.ctx.throw(503, 'Statistics limit exceeded');
        const batch = await this.modelInstance.select(where, {
          field: [
            'nick',
            'mail',
            'user_id',
            'url',
            'insertedAt',
            ...(this.get('type') === 'statistics' ? ['ip'] : []),
            'status',
            ...(this.config('storage') === 'mysql' ? ['visibility'] : []),
          ],
          order: [{ field: 'objectId', direction: 'asc' }],
          limit: 500,
          offset,
        });
        rows.push(...batch);
        if (batch.length < 500) break;
      }
      if (this.get('type') === 'statistics-comments') {
        return this.success(commentList(rows, this.get()));
      }
      return this.success(await aggregateComments(rows, think.ip2region, currentRegionSettings()));
    }
    if (this.get('type') === 'level-settings') {
      if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
      this.ctx.set('Cache-Control', 'private, no-store');
      return this.success(levelSettings.read(this.config('levels')));
    }
    if (this.get('type') === 'region-database') {
      if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
      this.ctx.set('Cache-Control', 'private, no-store');
      return this.success(regionDatabase.status());
    }
    if (this.get('type') === 'region-settings') {
      if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
      this.ctx.set('Cache-Control', 'private, no-store');
      return this.success(currentRegionSettings());
    }
    this.ctx.set('Cache-Control', 'private, no-store');
    const { type } = this.get();

    if (!['list', 'region-audit'].includes(type) && !dashboard.allowed(this.ctx.state.userInfo)) {
      const urls = this.get('url');
      const data =
        type === 'count'
          ? Array.isArray(urls) && urls.length
            ? this.ctx.state.deprecated && urls.length === 1
              ? 0
              : urls.map(() => 0)
            : 0
          : type === 'recent'
            ? []
            : {
                page: Number(this.get('page')) || 1,
                pageSize: Number(this.get('pageSize')) || 10,
                totalPages: 0,
                count: 0,
                data: [],
                closed: true,
              };
      return this.jsonOrSuccess(data);
    }

    const fnMap = {
      recent: this['getRecentCommentList'],
      count: this['getCommentCount'],
      list: this['getAdminCommentList'],
      'region-audit': this['getRegionAudit'],
    };

    const fn = fnMap[type] || this['getCommentList'];
    const data = await fn.call(this);

    return this.jsonOrSuccess(data);
  }

  async getRegionAudit() {
    if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
    const page = Number(this.get('page')) || 1;
    const pageSize = 100;
    const total = await this.modelInstance.count({});
    const rows = await this.modelInstance.select(
      {},
      {
        field: ['ip'],
        order: [{ field: 'objectId', direction: 'asc' }],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
    );
    const result = {
      total,
      scanned: rows.length,
      resolved: 0,
      missingIP: 0,
      unmatched: 0,
      nextPage: page * pageSize < total ? page + 1 : null,
    };
    for (const row of rows) {
      if (!row.ip) result.missingIP += 1;
      else if (await think.ip2region(row.ip, { level: 'isp', country: true })) result.resolved += 1;
      else result.unmatched += 1;
    }
    return result;
  }

  async postAction() {
    if (this.get('type') === 'region-database-update') {
      if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
      return this.success(regionDatabase.startUpdate());
    }
    if (!dashboard.allowed(this.ctx.state.userInfo)) {
      return this.ctx.throw(403, this.locale('Comments are closed'));
    }
    think.logger.debug('Post Comment Start!');

    const { comment, link, mail, nick, pid, rid, ua, url, at } = this.post();
    const data = {
      link,
      mail,
      nick,
      pid,
      rid,
      ua,
      url,
      comment,
      ip: this.ctx.ip,
      insertedAt: new Date(),
      user_id: this.ctx.state.userInfo.objectId,
    };

    const input = this.post();
    let parentTarget, rootTarget;
    if (
      (pid != null && !/^[a-zA-Z0-9_-]+$/u.test(String(pid))) ||
      (rid != null && !/^[a-zA-Z0-9_-]+$/u.test(String(rid))) ||
      (pid != null && typeof pid === 'object') ||
      (rid != null && typeof rid === 'object')
    ) {
      return this.ctx.throw(400, 'Invalid reply ID');
    }
    if (pid) {
      [parentTarget] = await this.modelInstance.select({ objectId: pid });
      [rootTarget] = await this.modelInstance.select({ objectId: rid });
    }
    let owner;
    if (
      !pid &&
      input.visibility === 'private' &&
      this.ctx.state.userInfo?.type !== 'administrator'
    ) {
      const owners = await this.getModel('Users').select({ type: 'administrator' });
      owner = process.env.PRIVATE_MESSAGE_ADMIN_ID
        ? owners.find((account) => same(account.objectId, process.env.PRIVATE_MESSAGE_ADMIN_ID))
        : owners.length === 1
          ? owners[0]
          : undefined;
    }
    const audience = createAudience(this.ctx.state.userInfo, input, {
      parent: parentTarget,
      root: rootTarget,
      owner,
    });
    if (isPrivate(audience)) {
      if (this.config('storage') !== 'mysql') {
        return this.ctx.throw(400, 'Private replies require MySQL');
      }
      const ids = [audience.private_user_a, audience.private_user_b].filter((id) => id != null);
      const accounts = ids.length
        ? await this.getModel('Users').select({
            objectId: ['IN', ids],
            type: ['IN', ['guest', 'administrator']],
          })
        : [];
      if (accounts.length !== ids.length) {
        return this.ctx.throw(400, 'Both participants need active accounts');
      }
    }
    if (this.config('storage') === 'mysql') {
      Object.assign(data, audience, { visibility_source: 'author' });
    }

    if (pid && this.ctx.state.deprecated) {
      data.comment = `[@${at}](#${pid}): ${data.comment}`;
    }

    // Never log comment bodies or private participants.

    const { userInfo } = this.ctx.state;

    if (!userInfo || userInfo.type !== 'administrator') {
      /** IP disallowList */
      const { disallowIPList } = this.config();

      if (
        think.isArray(disallowIPList) &&
        disallowIPList.length > 0 &&
        disallowIPList.includes(data.ip)
      ) {
        think.logger.debug(`Comment IP ${data.ip} is in disallowIPList`);

        return this.ctx.throw(403);
      }

      think.logger.debug(`Comment IP ${data.ip} check OK!`);

      /** Duplicate content detect */
      const duplicate = await this.modelInstance.select({
        url,
        mail: data.mail,
        nick: data.nick,
        link: data.link,
        comment: data.comment,
      });

      if (!think.isEmpty(duplicate)) {
        think.logger.debug('The comment author had post same comment content before');

        return this.fail(this.locale('Duplicate Content'));
      }

      think.logger.debug('Comment duplicate check OK!');

      /** IP frequency */
      const { IPQPS = 60 } = process.env;

      const recent = await this.modelInstance.select({
        ip: this.ctx.ip,
        insertedAt: ['>', new Date(Date.now() - IPQPS * 1000)],
      });

      if (!think.isEmpty(recent)) {
        think.logger.debug(`The author has posted in ${IPQPS} seconds.`);

        return this.fail(this.locale('Comment too fast!'));
      }

      think.logger.debug(`Comment post frequency check OK!`);

      /** Akismet */
      data.status = this.config('audit') ? 'waiting' : 'approved';

      think.logger.debug(`Comment initial status is ${data.status}`);

      if (data.status === 'approved' && !isPrivate(data)) {
        const spam = await this.service('akismet', this.ctx.serverURL)
          .check(data)
          .catch((err) => {
            console.log(err);
          }); // ignore akismet error

        if (spam === true) {
          data.status = 'spam';
        }
      }

      think.logger.debug(`Comment akismet check result: ${data.status}`);

      if (data.status !== 'spam') {
        /** KeyWord Filter */
        const { forbiddenWords } = this.config();

        if (!think.isEmpty(forbiddenWords)) {
          const regexp = new RegExp(`(${forbiddenWords.join('|')})`, 'igu');

          if (regexp.test(comment)) {
            data.status = 'spam';
          }
        }
      }

      think.logger.debug(`Comment keyword check result: ${data.status}`);
    } else {
      data.status = 'approved';
    }

    const preSaveResp = !isPrivate(data) && (await this.hook('preSave', data));

    if (preSaveResp) {
      return this.fail(preSaveResp.errmsg);
    }

    think.logger.debug(`Comment post hooks preSave done!`);

    const resp = await this.modelInstance.add(data);

    think.logger.debug(`Comment have been added to storage.`);

    let parentComment, parentUser;

    if (pid) {
      parentComment = await this.modelInstance.select({ objectId: pid });
      [parentComment] = parentComment;
      if (parentComment.user_id) {
        parentUser = await this.getModel('Users').select({
          objectId: parentComment.user_id,
        });
        [parentUser] = parentUser;
      }
    }

    if (!isPrivate(resp)) {
      await this.ctx.webhook('new_comment', {
        comment: { ...resp, rawComment: comment },
        reply: parentComment,
      });
    }

    const cmtReturn = await formatCmt(
      resp,
      { ...this.config(), deprecated: this.ctx.state.deprecated },
      userInfo,
      [userInfo],
    );
    const parentReturn = parentComment
      ? await formatCmt(
          parentComment,
          { ...this.config(), deprecated: this.ctx.state.deprecated },
          userInfo,
          parentUser ? [parentUser] : [],
        )
      : undefined;

    if (data.status !== 'spam' && !isPrivate(data)) {
      const notify = this.service('notify', this);

      await notify.run(
        { ...cmtReturn, mail: resp.mail, rawComment: comment },
        parentReturn ? { ...parentReturn, mail: parentComment.mail } : undefined,
      );
    }

    think.logger.debug(`Comment notify done!`);

    if (!isPrivate(resp)) await this.hook('postSave', resp, parentComment);

    think.logger.debug(`Comment post hooks postSave done!`);

    return this.success(
      await formatCmt(resp, { ...this.config(), deprecated: this.ctx.state.deprecated }, userInfo, [
        userInfo,
      ]),
    );
  }

  async putAction() {
    if (this.get('type') === 'level-settings') {
      if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
      return this.success(levelSettings.write(this.post()));
    }
    if (this.get('type') === 'region-database') {
      if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
      return this.success(regionDatabase.save(this.post()));
    }
    if (this.get('type') === 'region-settings') {
      if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
      return this.success(regionSettings.write(this.post()));
    }
    const { userInfo } = this.ctx.state;
    if (userInfo?.type !== 'administrator' && !dashboard.allowed(userInfo)) {
      return this.ctx.throw(403, this.locale('Comments are closed'));
    }
    const isAdmin = userInfo.type === 'administrator';
    // Ownership/audience/topology are server-owned; visibility has a dedicated policy.
    const data = isAdmin
      ? this.post('comment,like,status,sticky,nick,mail,link,visibility')
      : this.post('comment,like,visibility');
    let oldData = await this.modelInstance.select({ objectId: this.id });

    if (think.isEmpty(oldData) || think.isEmpty(data)) {
      return this.success();
    }

    [oldData] = oldData;
    if ('visibility' in data && !['public', 'private'].includes(data.visibility)) {
      return this.ctx.throw(400, 'Invalid comment visibility');
    }
    const changingVisibility =
      'visibility' in data && data.visibility !== (oldData.visibility || 'public');
    if (!changingVisibility) delete data.visibility;
    if (changingVisibility && this.config('storage') !== 'mysql') {
      return this.ctx.throw(400, 'visibilityUnsupported');
    }
    if (think.isBoolean(data.like)) {
      const likeIncMax = this.config('LIKE_INC_MAX') || 1;

      data.like =
        (Number(oldData.like) || 0) + (data.like ? Math.ceil(Math.random() * likeIncMax) : -1);
      data.like = Math.max(data.like, 0);
    }

    const preUpdateResp =
      !changingVisibility &&
      !isPrivate(oldData) &&
      (await this.hook('preUpdate', {
        ...data,
        objectId: this.id,
      }));

    if (preUpdateResp) {
      return this.fail(preUpdateResp);
    }

    const newData = changingVisibility
      ? await this.modelInstance.changeVisibility(
          this.getModel('Users'),
          this.id,
          data,
          this.post('visibilityRevision'),
        )
      : await this.modelInstance.update(data, {
          objectId: this.id,
        });

    let cmtUser;

    if (!think.isEmpty(newData) && newData[0].user_id) {
      cmtUser = await this.getModel('Users').select({
        objectId: newData[0].user_id,
      });
      [cmtUser] = cmtUser;
    }
    const cmtReturn = await formatCmt(
      newData[0],
      { ...this.config(), deprecated: this.ctx.state.deprecated },
      userInfo,
      cmtUser ? [cmtUser] : [],
    );

    if (
      !isPrivate(oldData) &&
      !isPrivate(newData[0]) &&
      !changingVisibility &&
      oldData.status === 'waiting' &&
      data.status === 'approved' &&
      oldData.pid
    ) {
      let pComment = await this.modelInstance.select({
        objectId: oldData.pid,
      });

      [pComment] = pComment;

      let pUser;

      if (pComment.user_id) {
        pUser = await this.getModel('Users').select({
          objectId: pComment.user_id,
        });
        [pUser] = pUser;
      }

      const notify = this.service('notify', this);
      const pcmtReturn = await formatCmt(
        pComment,
        { ...this.config(), deprecated: this.ctx.state.deprecated },
        userInfo,
        pUser ? [pUser] : [],
      );

      await notify.run(
        { ...cmtReturn, mail: newData[0].mail },
        { ...pcmtReturn, mail: pComment.mail },
        true,
      );
    }

    if (!isPrivate(oldData) && !isPrivate(newData[0]) && !changingVisibility) {
      await this.hook('postUpdate', data);
    }

    return this.success(cmtReturn);
  }

  async deleteAction() {
    const preDeleteResp = await this.hook('preDelete', this.id);

    if (preDeleteResp) {
      return this.fail(preDeleteResp);
    }

    await this.modelInstance.delete({
      _complex: {
        _logic: 'or',
        objectId: this.id,
        pid: this.id,
        rid: this.id,
      },
    });
    await this.hook('postDelete', this.id);

    return this.success();
  }

  async getCommentList() {
    const { userInfo } = this.ctx.state;
    const { path: url, page, pageSize, sortBy } = this.get();
    const where = { url };

    if (think.isEmpty(userInfo)) {
      where.status = ['NOT IN', ['waiting', 'spam']];
    } else if (userInfo.type !== 'administrator') {
      where._complex = {
        _logic: 'or',
        status: ['NOT IN', ['waiting', 'spam']],
        user_id: userInfo.objectId,
      };
    }

    const pageOffset = Math.max((page - 1) * pageSize, 0);
    const [sortField, sortDirection] = sortBy.split('_');
    const selectOptions = {
      field: [
        'status',
        'comment',
        'insertedAt',
        'link',
        'mail',
        'nick',
        'pid',
        'rid',
        'ua',
        'ip',
        'user_id',
        'sticky',
        'like',
      ],
    };

    if (sortDirection === 'desc') selectOptions.desc = sortField;

    const rootWhere = { ...where, rid: undefined };
    const [totalCount, rootCount] = await Promise.all([
      this.modelInstance.count(where),
      this.modelInstance.count(rootWhere),
    ]);
    const rootComments = await this.modelInstance.select(rootWhere, {
      ...selectOptions,
      limit: pageSize,
      offset: pageOffset,
      order: [
        { field: 'sticky', direction: 'desc', nulls: 'last' },
        { field: sortField, direction: sortDirection },
        { field: 'objectId', direction: sortDirection },
      ],
    });
    const rootIds = rootComments.map(({ objectId }) => objectId);
    const children =
      rootIds.length > 0
        ? await this.modelInstance.select(
            {
              ...where,
              rid: ['IN', rootIds],
            },
            selectOptions,
          )
        : [];
    const comments = [...rootComments, ...children];

    const userModel = this.getModel('Users');
    const user_ids = [...new Set(comments.map(({ user_id }) => user_id).filter(Boolean))];
    let users = [];

    if (user_ids.length > 0) {
      users = await userModel.select(
        { objectId: ['IN', user_ids] },
        {
          field: ['display_name', 'email', 'url', 'type', 'avatar', 'label'],
        },
      );
    }

    const currentLevels = levelSettings.read(this.config('levels'));
    if (currentLevels.enabled) {
      const countWhere = {
        ...(this.config('storage') === 'mysql' ? { visibility: 'public' } : {}),
        status: ['NOT IN', ['waiting', 'spam']],
        _complex: {},
      };

      if (user_ids.length > 0) {
        countWhere._complex.user_id = ['IN', user_ids];
      }

      const mails = [...new Set(comments.map(({ mail }) => mail).filter(Boolean))];

      if (mails.length > 0) {
        countWhere._complex.mail = ['IN', mails];
      }

      if (think.isEmpty(countWhere._complex)) {
        delete countWhere._complex;
      } else {
        countWhere._complex._logic = 'or';
      }

      const counts = await this.modelInstance.count(countWhere, {
        group: ['user_id', 'mail'],
      });

      levelSettings.apply(comments, counts || [], currentLevels);
    }

    return {
      page,
      totalPages: Math.ceil(rootCount / pageSize),
      pageSize,
      count: totalCount,
      data: await Promise.all(
        rootComments.map(async (comment) => {
          const cmt = await formatCmt(
            comment,
            { ...this.config(), deprecated: this.ctx.state.deprecated },
            userInfo,
            users,
          );

          cmt.children = await Promise.all(
            comments
              .filter(({ rid }) => rid === cmt.objectId)
              .map((cmt) =>
                formatCmt(
                  cmt,
                  {
                    ...this.config(),
                    deprecated: this.ctx.state.deprecated,
                  },
                  userInfo,
                  users,
                ),
              )
              .reverse(),
          );

          const childCommentsMap = new Map([[cmt.objectId, cmt]]);

          cmt.children.forEach((child) => childCommentsMap.set(child.objectId, child));

          cmt.children.forEach((child) => {
            const parent = childCommentsMap.get(child.pid);

            // fix https://github.com/walinejs/waline/issues/2518 avoid some abnormal comment data
            if (!parent) {
              return;
            }

            child.reply_user = {
              nick: parent?.nick,
              link: parent?.link,
              avatar: parent?.avatar,
            };
          });

          return cmt;
        }),
      ),
    };
  }

  async getAdminCommentList() {
    const { userInfo } = this.ctx.state;
    const { page, pageSize, owner, status, keyword } = this.get();
    const where = {};

    if (owner === 'mine') {
      const { userInfo } = this.ctx.state;

      where.mail = userInfo.email;
    }

    if (status) {
      where.status = status;

      // compat with valine old data without status property
      if (status === 'approved') {
        where.status = ['NOT IN', ['waiting', 'spam']];
      }
    }

    if (keyword) {
      where.comment = ['LIKE', `%${keyword}%`];
    }

    const count = await this.modelInstance.count(where);
    const spamCount = await this.modelInstance.count({ status: 'spam' });
    const waitingCount = await this.modelInstance.count({
      status: 'waiting',
    });
    const comments = await this.modelInstance.select(where, {
      desc: 'insertedAt',
      limit: pageSize,
      offset: Math.max((page - 1) * pageSize, 0),
    });

    const userModel = this.getModel('Users');
    const user_ids = [...new Set(comments.map(({ user_id }) => user_id).filter(Boolean))];

    let users = [];

    if (user_ids.length > 0) {
      users = await userModel.select(
        { objectId: ['IN', user_ids] },
        {
          field: ['display_name', 'email', 'url', 'type', 'avatar', 'label'],
        },
      );
    }

    return {
      page,
      totalPages: Math.ceil(count / pageSize),
      pageSize,
      spamCount,
      waitingCount,
      data: await Promise.all(
        comments.map((cmt) =>
          formatCmt(
            cmt,
            { ...this.config(), deprecated: this.ctx.state.deprecated },
            userInfo,
            users,
          ),
        ),
      ),
    };
  }

  async getRecentCommentList() {
    const { count } = this.get();
    const { userInfo } = this.ctx.state;
    const where = {};

    if (think.isEmpty(userInfo)) {
      where.status = ['NOT IN', ['waiting', 'spam']];
    } else {
      where._complex = {
        _logic: 'or',
        status: ['NOT IN', ['waiting', 'spam']],
        user_id: userInfo.objectId,
      };
    }

    const comments = await this.modelInstance.select(where, {
      desc: 'insertedAt',
      limit: count,
      field: [
        'status',
        'comment',
        'insertedAt',
        'link',
        'mail',
        'nick',
        'url',
        'pid',
        'rid',
        'ua',
        'ip',
        'user_id',
        'sticky',
        'like',
      ],
    });

    const userModel = this.getModel('Users');
    const user_ids = [...new Set(comments.map(({ user_id }) => user_id).filter(Boolean))];

    let users = [];

    if (user_ids.length > 0) {
      users = await userModel.select(
        { objectId: ['IN', user_ids] },
        {
          field: ['display_name', 'email', 'url', 'type', 'avatar', 'label'],
        },
      );
    }

    return Promise.all(
      comments.map((cmt) =>
        formatCmt(
          cmt,
          { ...this.config(), deprecated: this.ctx.state.deprecated },
          userInfo,
          users,
        ),
      ),
    );
  }

  async getCommentCount() {
    const { url } = this.get();
    const { userInfo } = this.ctx.state;
    const where = Array.isArray(url) && url.length > 0 ? { url: ['IN', url] } : {};

    if (think.isEmpty(userInfo)) {
      where.status = ['NOT IN', ['waiting', 'spam']];
    } else {
      where._complex = {
        _logic: 'or',
        status: ['NOT IN', ['waiting', 'spam']],
        user_id: userInfo.objectId,
      };
    }

    if (Array.isArray(url) && url.length === 1) {
      const count = await this.modelInstance.count(where);

      return this.ctx.state.deprecated ? count : [count];
    }

    if (Array.isArray(url) && url.length > 1) {
      const counts = await this.modelInstance.count(where, { group: ['url'] });
      const countByUrl = new Map(counts.map(({ url, count }) => [url, count]));

      return url.map((item) => countByUrl.get(item) ?? 0);
    }
    const data = await this.modelInstance.count(where);

    return data;
  }
};
