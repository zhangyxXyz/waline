const { createHash } = require('node:crypto');
const { active, same, canRead, isPrivate, createAudience } = require('./comment-privacy.js');

const fail = (reason, status = 403) => Object.assign(new Error(reason), { status });
const revision = (comment) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        comment.objectId,
        comment.comment,
        comment.visibility || 'public',
        comment.visibility_source,
        comment.pid,
        comment.rid,
        comment.user_id,
        comment.private_user_a,
        comment.private_user_b,
      ]),
    )
    .digest('hex');

// Uses the unscoped model: hidden/moderated replies must also prevent a transition.
async function policy(model, users, user, id) {
  const [comment] = await model.select({ objectId: id });
  if (!comment || !canRead(user, comment)) throw fail('Comment not found', 404);
  if (!active(user) || (user.type !== 'administrator' && !same(user.objectId, comment.user_id))) {
    throw fail('visibilityPermission');
  }
  const [parent] = comment.pid ? await model.select({ objectId: comment.pid }) : [];
  const [root] = comment.rid ? await model.select({ objectId: comment.rid }) : [];
  const children = await model.count({ _complex: { _logic: 'or', pid: id, rid: id } });
  const structural = children
    ? 'visibilityReplies'
    : comment.pid && (!parent || !root)
      ? 'visibilityParent'
      : isPrivate(parent) || isPrivate(root)
        ? 'visibilityParent'
        : '';
  let publicReason = structural;
  if (!publicReason && !same(user.objectId, comment.user_id)) publicReason = 'visibilityOther';
  if (!publicReason && comment.visibility_source !== 'author') publicReason = 'visibilityOrigin';
  let privateReason = structural;
  let audience;
  if (!privateReason) {
    const [author] = await users.select({ objectId: comment.user_id });
    if (active(author)) {
      const owners = await users.select({ type: 'administrator' });
      const owner = process.env.PRIVATE_MESSAGE_ADMIN_ID
        ? owners.find((account) => same(account.objectId, process.env.PRIVATE_MESSAGE_ADMIN_ID))
        : owners.length === 1
          ? owners[0]
          : undefined;
      try {
        audience = createAudience(
          author,
          { visibility: 'private', pid: comment.pid, rid: comment.rid, url: comment.url },
          { parent, root, owner },
        );
        const ids = [audience.private_user_a, audience.private_user_b].filter((id) => id != null);
        if (
          ids.length &&
          (await users.select({ objectId: ['IN', ids], type: ['IN', ['guest', 'administrator']] }))
            .length !== ids.length
        )
          privateReason = 'visibilityAudience';
      } catch {
        privateReason = 'visibilityAudience';
      }
    }
    else {privateReason = 'visibilityAudience';}
  }
  return {
    comment,
    audience,
    revision: revision(comment),
    public: { allowed: !publicReason, reason: publicReason },
    private: { allowed: !privateReason, reason: privateReason },
  };
}

module.exports = { policy, revision, fail };
