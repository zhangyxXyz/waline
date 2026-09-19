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
  delete(where) {
    return this.model.delete(this.where(where));
  }
  setSeqId(id) {
    return this.model.setSeqId(id);
  }
};
