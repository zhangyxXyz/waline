const Base = require('./base.js');
const { isLoopback } = require('../service/loopback.js');

module.exports = class ArticleLogic extends Base {
  referrerCheck() {
    // Public read-only counters remain available to IPv4/IPv6 loopback previews.
    if (
      ['GET', 'HEAD'].includes(this.ctx.method) &&
      isLoopback(this.ctx.get('Origin') || this.ctx.get('Referer'))
    )
      {return true;}
    return super.referrerCheck();
  }
  getAction() {
    this.rules = {
      path: { array: true },
      type: { array: true, default: ['time'] },
    };
  }

  postAction() {
    this.rules = {
      path: {
        string: true,
      },
      type: {
        string: true,
        default: 'time',
      },
      action: {
        string: true,
        in: ['inc', 'desc'],
        default: 'inc',
      },
    };
  }
};
