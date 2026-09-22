const BaseRest = require('./rest.js');
const { isLoopback } = require('../service/loopback.js');

module.exports = class extends BaseRest {
  constructor(ctx) {
    super(ctx);
    this.modelInstance = this.getModel('Counter');
  }

  async getAction() {
    this.ctx.set('Cache-Control', 'no-store');
    const { path, type } = this.get();
    const { deprecated } = this.ctx.state;

    if (this.get('site') === '1') {
      const rows = await this.modelInstance.select({}, { field: ['time'] });
      return this.success({
        pageViews: rows.reduce((total, row) => total + (Number(row.time) || 0), 0),
      });
    }

    // path is required
    if (!Array.isArray(path) || path.length === 0) {
      return this.jsonOrSuccess(0);
    }

    const resp = await this.modelInstance.select({ url: ['IN', path] });

    if (think.isEmpty(resp)) {
      const counters = Array.from({ length: path.length }, () =>
        type.length === 1 && deprecated
          ? 0
          : type.reduce((o, field) => {
              o[field] = 0;

              return o;
            }, {}),
      );

      // - deprecated:
      //   - single path and single type: 0
      //   - single path and multiple type: {[type]: 0}
      //   - multiple path and single type: [0, 0]
      //   - multiple path and multiple type: [{[type]: 0},{[type]: 0}]
      // - latest
      //   - single path and single type: [{[type]: 0}]
      //   - single path and multiple type: [{[type]: 0}]
      //   - multiple path and single type: [{[type]: 0}]
      //   - multiple path and multiple type: [{[type]: 0}]
      return this.jsonOrSuccess(path.length === 1 && deprecated ? counters[0] : counters);
    }

    const respObj = resp.reduce((o, n) => {
      o[n.url] = n;

      return o;
    }, {});

    const data = [];

    for (const url of path) {
      let counters = {};

      for (const field of type) {
        counters[field] = respObj[url]?.[field] || 0;
      }

      if (type.length === 1 && deprecated) {
        counters = counters[type[0]];
      }

      data.push(counters);
    }

    return this.jsonOrSuccess(path.length === 1 && deprecated ? data[0] : data);
  }

  async postAction() {
    if (
      (this.post('type') || 'time') === 'time' &&
      (isLoopback(this.ctx.get('Origin')) || isLoopback(this.ctx.get('Referer')))
    )
      {return this.ctx.throw(403);}
    if (this.modelInstance.withCounterTransaction && !this.modelInstance.inCounterTransaction) {
      return this.modelInstance.withCounterTransaction(async (scoped) => {
        const original = this.modelInstance;
        this.modelInstance = scoped;
        try {
          return await this.postAction();
        } finally {
          this.modelInstance = original;
        }
      });
    }
    const { path, type, action } = this.post();
    const resp = await this.modelInstance.select({ url: path });
    const { deprecated } = this.ctx.state;

    if (think.isEmpty(resp)) {
      if (action === 'desc') {
        return this.jsonOrSuccess(deprecated ? 0 : [0]);
      }

      const count = 1;

      await this.modelInstance.add(
        { url: path, [type]: count },
        { access: { read: true, write: true } },
      );

      return this.jsonOrSuccess(deprecated ? count : [{ [type]: count }]);
    }

    const ret = await this.modelInstance.update(
      (counter) => ({
        [type]: action === 'desc' ? (counter[type] || 1) - 1 : (counter[type] || 0) + 1,
        updatedAt: new Date(),
      }),
      { objectId: ['IN', resp.map(({ objectId }) => objectId)] },
    );

    return this.jsonOrSuccess(deprecated ? ret[0][type] : [{ [type]: ret[0][type] }]);
  }
};
