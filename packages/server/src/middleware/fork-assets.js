const fs = require('node:fs');
const path = require('node:path');

// The Docker image bundles these assets. Never serve arbitrary filesystem paths.
module.exports = () => async (ctx, next) => {
  const files = {
    '/assets/fork/admin.js': ['admin.js', 'application/javascript'],
    '/assets/fork/waline.js': ['waline.js', 'application/javascript'],
    '/assets/fork/waline.css': ['waline.css', 'text/css'],
    '/assets/fork/waline-meta.css': ['waline-meta.css', 'text/css'],
  };
  const file = files[ctx.path];
  if (!file || !['GET', 'HEAD'].includes(ctx.method)) return next();
  const [name, type] = file;
  let filename = path.join(think.ROOT_PATH, 'public', 'fork', name);
  // Only the fixed admin asset may be overridden. Resolve on every request so
  // switching a release symlink takes effect without restarting the container.
  if (name === 'admin.js' && process.env.WALINE_ADMIN_ASSET_DIR) {
    const external = path.join(process.env.WALINE_ADMIN_ASSET_DIR, 'admin.js');
    try {
      const stat = fs.statSync(external);
      if (stat.isFile() && stat.size > 0) filename = external;
    } catch (err) {
      if (!['ENOENT', 'ENOTDIR'].includes(err.code)) throw err;
    }
  }
  if (!fs.existsSync(filename)) return ctx.throw(404);
  ctx.type = type;
  ctx.set('Cache-Control', 'no-cache');
  ctx.set('Access-Control-Allow-Origin', '*');
  ctx.body = fs.createReadStream(filename);
};
