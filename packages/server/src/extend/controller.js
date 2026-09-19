const nunjucks = require('nunjucks');
const { PasswordHash } = require('phpass');
const PrivateCommentModel = require('../service/private-comment-model.js');

const defaultLocales = require('../locales/index.js');

const defaultLang = 'en-us';

module.exports = {
  success(...args) {
    this.ctx.success(...args);

    return think.prevent();
  },
  fail(...args) {
    this.ctx.fail(...args);

    return think.prevent();
  },
  jsonOrSuccess(...args) {
    return this[this.ctx.state.deprecated ? 'json' : 'success'](...args);
  },
  locale(message, variables) {
    const { lang: userLang } = this.get();
    const lang = (userLang || defaultLang).toLowerCase();

    const customLocales = this.config('locales');
    const locales = customLocales || defaultLocales;

    const localMessage =
      locales?.[lang]?.[message] ||
      defaultLocales?.[lang]?.[message] ||
      defaultLocales[defaultLang][message];

    if (localMessage) {
      message = localMessage;
    }

    return nunjucks.renderString(message, variables);
  },
  getModel(modelName, { publicOnly = false } = {}) {
    const { storage, customModel } = this.config();

    if (typeof customModel === 'function') {
      const modelInstance = customModel(modelName, this);

      if (modelInstance) {
        return modelName === 'Comment' && storage === 'mysql'
          ? new PrivateCommentModel(modelInstance, publicOnly ? {} : this.ctx.state.userInfo)
          : modelInstance;
      }
    }

    const model = this.service(`storage/${storage}`, modelName);
    return modelName === 'Comment' && storage === 'mysql'
      ? new PrivateCommentModel(model, publicOnly ? {} : this.ctx.state.userInfo)
      : model;
  },
  hashPassword(password) {
    const PwdHash = this.config('encryptPassword') || PasswordHash;
    const pwdHash = new PwdHash();

    return pwdHash.hashPassword(password);
  },
  checkPassword(password, storeHash) {
    const PwdHash = this.config('encryptPassword') || PasswordHash;
    const pwdHash = new PwdHash();

    return pwdHash.checkPassword(password, storeHash);
  },
};
