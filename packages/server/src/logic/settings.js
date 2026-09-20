const Base = require('./base.js');

module.exports = class extends Base {
  check() {
    const user = this.ctx.state.userInfo;
    if (!user?.objectId) return this.ctx.throw(401);
    if (user.type !== 'administrator') return this.ctx.throw(403);
  }
  getAction() {
    this.check();
  }
  putAction() {
    this.check();
  }
  postAction() {
    this.check();
  }
  deleteAction() {
    return this.ctx.throw(405);
  }
};
