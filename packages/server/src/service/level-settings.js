const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const badgeColors = require('./badge-colors.js');

const filename = () =>
  process.env.LEVEL_SETTINGS_FILE || path.resolve(__dirname, '../../runtime/level-settings.json');
const invalid = () => Object.assign(new Error('Invalid level settings'), { status: 400 });
const validate = (value) => {
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.levels) ||
    value.levels.length < 1 ||
    value.levels.length > 20
  )
    {throw invalid();}
  let previous = -1;
  const levels = value.levels.map((row, index) => {
    if (
      !row ||
      !Number.isSafeInteger(row.min) ||
      row.min < 0 ||
      row.min > 1000000000 ||
      row.min <= previous ||
      (index === 0 && row.min !== 0) ||
      typeof row.label !== 'string' ||
      row.label.trim().length > 40 ||
      // Reject control characters in administrator-supplied label text.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001F\u007F]/u.test(row.label)
    )
      {throw invalid();}
    previous = row.min;
    return {
      min: row.min,
      label: row.label.trim(),
      ...(row.colors === undefined ? {} : { colors: badgeColors.validate(row.colors) }),
    };
  });
  return { enabled: value.enabled, levels };
};

const defaults = (thresholds) =>
  Array.isArray(thresholds) && thresholds.length
    ? validate({
        enabled: true,
        // Legacy LEVELS treats counts below its first threshold as level 0.
        levels: thresholds.map((min, index) => ({ min: index === 0 ? 0 : min, label: '' })),
      })
    : {
        enabled: false,
        levels: [0, 2, 10, 30, 100].map((min) => ({ min, label: '' })),
      };

const read = (thresholds, file = filename()) => {
  try {
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (err.code === 'ENOENT') return defaults(thresholds);
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

const apply = (comments, counts, settings) => {
  for (const comment of comments) {
    delete comment.level;
    delete comment.levelLabel;
    delete comment.levelColors;
    if (!settings.enabled) continue;
    // A signed-in user may have used several email addresses over time.
    const count = counts.reduce((total, row) => {
      const matches = comment.user_id
        ? row.user_id === comment.user_id
        : Boolean(comment.mail) && row.mail === comment.mail;
      return total + (matches ? Number(row.count) || 0 : 0);
    }, 0);
    const index = settings.levels.findLastIndex(({ min }) => min <= count);
    comment.level = Math.max(0, index);
    const {label} = settings.levels[comment.level];
    if (label) comment.levelLabel = label;
    const {colors} = settings.levels[comment.level];
    if (colors) comment.levelColors = colors;
  }
};

module.exports = { read, write, validate, apply };
