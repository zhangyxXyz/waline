// Per-request wrapper: do not put viewer state on ThinkJS's cached service instance.
module.exports = class PrivateCommentModel {
  constructor(model, viewer) {
    this.model = model;
    this.viewer = viewer;
  }
  where(where = {}) {
    return { ...where, _privateViewer: this.viewer || {} };
  }
  select(where, options = {}) {
    const field = options.field && [
      ...new Set([...options.field, 'visibility', 'private_user_a', 'private_user_b']),
    ];
    return this.model.select(this.where(where), { ...options, ...(field ? { field } : {}) });
  }
  count(where, options) {
    return this.model.count(this.where(where), options);
  }
  add(data, options) {
    return this.model.add(data, options);
  }
  update(data, where) {
    return this.model.update(data, this.where(where));
  }
  visibilityPolicy(users, id) {
    return this.model.visibilityPolicy(users, this.viewer, id);
  }
  changeVisibility(users, id, data, revision) {
    return this.model.changeVisibility(users, this.viewer, id, data, revision);
  }
  delete(where) {
    return this.model.delete(this.where(where));
  }
  setSeqId(id) {
    return this.model.setSeqId(id);
  }
};
