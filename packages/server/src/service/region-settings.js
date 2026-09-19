const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const filename = () =>
  process.env.REGION_SETTINGS_FILE || path.resolve(__dirname, '../../runtime/region-settings.json');
const levels = new Set(['off', 'country', 'province', 'city', 'isp']);
const validate = (value) => {
  if (!value || !levels.has(value.level) || typeof value.country !== 'boolean') {
    throw Object.assign(new Error('Invalid region settings'), { status: 400 });
  }
  return { level: value.level, country: value.country };
};
const read = (defaults, file = filename()) => {
  try {
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (err.code === 'ENOENT') return defaults;
    throw err;
  }
};
const write = (value, file = filename()) => {
  const settings = validate(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return settings;
};
module.exports = { read, write };
