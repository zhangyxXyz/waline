const fs = require('node:fs');
const path = require('node:path');

// The Docker image bundles these assets. Never serve arbitrary filesystem paths.
module.exports = () => async (ctx, next) => {
  const files = {
    '/assets/fork/admin.js': ['admin.js', 'application/javascript'],
    '/assets/fork/waline.js': ['waline.js', 'application/javascript'],
    '/assets/fork/waline.css': ['waline.css', 'text/css'],
  };
  const file = files[ctx.path];
  if (!file || !['GET', 'HEAD'].includes(ctx.method)) return next();
  const [name, type] = file;
  const filename = path.join(think.ROOT_PATH, 'public', 'fork', name);
  if (!fs.existsSync(filename)) return ctx.throw(404);
  ctx.type = type;
  ctx.set('Cache-Control', 'no-cache');
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.body = fs.createReadStream(filename);
};
