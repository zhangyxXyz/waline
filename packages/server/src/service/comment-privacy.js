// Account IDs, never nicknames or email addresses, define a private conversation.
const active = (user) => Boolean(user?.objectId) && ['guest', 'administrator'].includes(user.type);
const same = (a, b) => a != null && b != null && String(a) === String(b);
const participant = (user, comment) =>
  active(user) &&
  [comment.private_user_a, comment.private_user_b].some((id) => same(id, user.objectId));
const isPrivate = (comment) => comment?.visibility === 'private';
const canRead = (user, comment) =>
  !isPrivate(comment) ||
  (active(user) && (user.type === 'administrator' || participant(user, comment)));

const error = (message, status = 400) => Object.assign(new Error(message), { status });

// The parent and root must have been loaded through the viewer-scoped model.
const createAudience = (user, input, { parent, root, owner }) => {
  if (input.visibility !== undefined && !['public', 'private'].includes(input.visibility)) {
    throw error('Invalid comment visibility');
  }
  if ('private_user_a' in input || 'private_user_b' in input || 'user_id' in input) {
    throw error('Comment ownership cannot be supplied by the client');
  }
  if (input.pid) {
    if (
      !parent ||
      !root ||
      parent.url !== input.url ||
      root.url !== input.url ||
      root.rid ||
      !same(parent.rid || parent.objectId, root.objectId) ||
      !same(input.rid, root.objectId)
    ) {
      throw error('Invalid reply target');
    }
  } else if (input.rid) {
    throw error('Invalid reply target');
  }
  if (!input.pid && input.visibility === 'private') {
    if (!active(user)) throw error('Login required', 401);
    if (!active(owner) || owner.type !== 'administrator' || same(owner.objectId, user.objectId)) {
      throw error('A private message requires a distinct site administrator');
    }
    return {
      visibility: 'private',
      private_user_a: String(user.objectId),
      private_user_b: String(owner.objectId),
    };
  }
  if (
    parent &&
    [parent, root].some(
      (c) =>
        ['waiting', 'spam'].includes(c.status) &&
        user?.type !== 'administrator' &&
        !same(c.user_id, user?.objectId),
    )
  ) {
    throw error('Invalid reply target');
  }
  if (isPrivate(parent)) {
    if (!participant(user, parent)) throw error('Only conversation participants may reply', 403);
    if (input.visibility === 'public') throw error('A private conversation cannot become public');
    return {
      visibility: 'private',
      private_user_a: parent.private_user_a,
      private_user_b: parent.private_user_b,
    };
  }
  if (input.visibility !== 'private') return { visibility: 'public' };
  if (!active(user)) throw error('Login required', 401);
  if (!parent?.user_id || same(parent.user_id, user.objectId)) {
    throw error('Private replies require another account-owned comment');
  }
  return {
    visibility: 'private',
    private_user_a: String(user.objectId),
    private_user_b: String(parent.user_id),
  };
};

// Only numeric MySQL IDs enter SQL, with strict validation rather than interpolation
// of arbitrary request values. Unknown/malformed identities fail closed.
const readPredicate = (viewer) => {
  if (active(viewer) && viewer.type === 'administrator') return '1=1';
  const publicOnly = "`visibility` = 'public'";
  if (!active(viewer) || !/^[1-9][0-9]*$/u.test(String(viewer.objectId))) return publicOnly;
  const id = String(viewer.objectId);
  return `(${publicOnly} OR (\`visibility\` = 'private' AND (\`private_user_a\` = '${id}' OR \`private_user_b\` = '${id}')))`;
};

module.exports = { active, same, participant, isPrivate, canRead, createAudience, readPredicate };
