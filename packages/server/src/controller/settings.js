const Base = require('./rest.js');
const settings = require('../service/dashboard-settings.js');
const mail = require('../service/mail-templates.js');
const smtp = require('../service/smtp-settings.js');

module.exports = class extends Base {
  check() {
    if (this.ctx.state.userInfo?.type !== 'administrator') return this.ctx.throw(403);
    this.ctx.set('Cache-Control', 'private, no-store');
  }
  async getAction() {
    this.check();
    switch (this.get('section')) {
      case 'smtp': {
        return this.success(smtp.publicSettings());
      }
      case 'auth': {
        return this.success({
          ...settings.auth(),
          services: this.ctx.state.oauthServices.map(({ name }) => ({ name })),
        });
      }
      case 'comments': {
        return this.success(settings.comments());
      }
      case 'images': {
        return this.success(settings.images());
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
      case 'smtp': {
        return this.success(smtp.save(this.post()));
      }
      case 'auth': {
        return this.success(settings.saveAuth(this.post(), this.ctx.state.oauthServices));
      }
      case 'comments': {
        return this.success(settings.saveComments(this.post()));
      }
      case 'images': {
        return this.success(settings.saveImages(this.post()));
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
    if (this.get('section') === 'download-test') {
      return this.success(
        await require('../service/region-database.js').testConnection(this.post()),
      );
    }
    if (this.get('section') === 'mail-preview') return this.success(mail.preview(this.post()));
    return this.ctx.throw(400);
  }
};
