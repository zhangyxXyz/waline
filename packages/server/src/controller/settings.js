const Base = require('./rest.js');
const settings = require('../service/dashboard-settings.js');
const mail = require('../service/mail-templates.js');

module.exports = class extends Base {
  check() {
    if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
    this.ctx.set('Cache-Control', 'private, no-store');
  }
  async getAction() {
    this.check();
    switch (this.get('section')) {
      case 'auth': {
        return this.success({
          ...settings.auth(),
          services: this.ctx.state.oauthServices.map(({ name }) => ({ name })),
        });
      }
      case 'comments': {
        return this.success(settings.comments());
      }
      case 'mail': {
        return this.success(mail.get(this.get('language'), this.get('kind'), this.config()));
      }
      default: {
        return this.ctx.throw(400);
      }
    }
  }
  async putAction() {
    this.check();
    switch (this.get('section')) {
      case 'auth': {
        return this.success(settings.saveAuth(this.post(), this.ctx.state.oauthServices));
      }
      case 'comments': {
        return this.success(settings.saveComments(this.post()));
      }
      case 'mail': {
        return this.success(mail.save(this.post(), this.config()));
      }
      default: {
        return this.ctx.throw(400);
      }
    }
  }
  async postAction() {
    this.check();
    if (this.get('section') === 'mail-preview') return this.success(mail.preview(this.post()));
    return this.ctx.throw(400);
  }
};
