const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const middleware = require('../src/middleware/fork-assets.js');

describe('independent admin assets', () => {
  let root,
   previousRoot,
   previousDir;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-assets-'));
    previousRoot = think.ROOT_PATH;
    previousDir = process.env.WALINE_ADMIN_ASSET_DIR;
    think.ROOT_PATH = root;
    fs.mkdirSync(path.join(root, 'public/fork'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/fork/admin.js'), 'bundled');
    fs.writeFileSync(path.join(root, 'public/fork/waline.js'), 'client');
    process.env.WALINE_ADMIN_ASSET_DIR = path.join(root, 'external');
    fs.mkdirSync(process.env.WALINE_ADMIN_ASSET_DIR);
  });
  afterEach(() => {
    think.ROOT_PATH = previousRoot;
    if (previousDir === undefined) delete process.env.WALINE_ADMIN_ASSET_DIR;
    else process.env.WALINE_ADMIN_ASSET_DIR = previousDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const read = async (url) => {
    const ctx = {
      path: url,
      method: 'GET',
      set: () => {},
      throw: () => {
        throw new Error('404');
      },
    };
    await middleware()(ctx, () => {});
    if (!ctx.body) return null;
    let text = '';
    for await (const chunk of ctx.body) text += chunk;
    return text;
  };

  it('falls back when external admin is missing or empty and picks up replacements', async () => {
    await expect(read('/assets/fork/admin.js')).resolves.toBe('bundled');
    const file = path.join(process.env.WALINE_ADMIN_ASSET_DIR, 'admin.js');
    fs.writeFileSync(file, 'new admin');
    await expect(read('/assets/fork/admin.js')).resolves.toBe('new admin');
    fs.writeFileSync(file, 'next admin');
    await expect(read('/assets/fork/admin.js')).resolves.toBe('next admin');
    fs.writeFileSync(file, '');
    await expect(read('/assets/fork/admin.js')).resolves.toBe('bundled');
  });

  it('never overrides client files or serves arbitrary paths', async () => {
    fs.writeFileSync(path.join(process.env.WALINE_ADMIN_ASSET_DIR, 'waline.js'), 'wrong');
    await expect(read('/assets/fork/waline.js')).resolves.toBe('client');
    await expect(read('/assets/fork/../secret')).resolves.toBeNull();
  });
});
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
