const dashboard = require('./dashboard-settings.js');

const validate = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw dashboard.invalid();
  const result = {};
  for (const mode of Object.keys(value)) {
    if (!['light', 'dark'].includes(mode)) throw dashboard.invalid();
    const palette = value[mode];
    if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
      throw dashboard.invalid();
    }
    result[mode] = {};
    for (const key of Object.keys(palette)) {
      if (!['text', 'background', 'border'].includes(key)) throw dashboard.invalid();
      const color = palette[key];
      if (color === '') continue;
      if (
        typeof color !== 'string' ||
        !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(color)
      ) {
        throw dashboard.invalid();
      }
      result[mode][key] = color;
    }
  }
  return result;
};

// Keep optional presentation settings alongside the other dashboard settings.
// Existing SQL and hosted-storage user schemas do not need migration.
const read = (id, label) => {
  const entry = dashboard.read().labelColors?.[String(id)];
  return label && entry?.label === label ? validate(entry.colors) : {};
};
const save = (id, label, colors) => {
  const entries = { ...dashboard.read().labelColors };
  if (label) entries[String(id)] = { label, colors: validate(colors) };
  else Reflect.deleteProperty(entries, String(id));
  dashboard.save('labelColors', entries);
};
module.exports = { validate, read, save };
