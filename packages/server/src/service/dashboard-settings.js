const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const file = () =>
  process.env.DASHBOARD_SETTINGS_FILE ||
  path.resolve(__dirname, '../../runtime/dashboard-settings.json');
const invalid = () => Object.assign(new Error('Invalid settings'), { status: 400 });
const read = () => {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};
const save = (section, value) => {
  const data = { ...read(), [section]: value };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const temp = `${file()}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temp, file());
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return value;
};
const auth = () => ({ registration: true, email: true, providers: null, ...read().auth });
const comments = () => ({ enabled: true, allowAdmin: false, ...read().comments });
const images = () => ({ enabled: read().images?.enabled !== false });
const saveImages = (value) => {
  if (!value || typeof value.enabled !== 'boolean') throw invalid();
  return save('images', { enabled: value.enabled });
};
const allowed = (user) => {
  const config = comments();
  return config.enabled || (config.allowAdmin && user?.type === 'administrator');
};
const provider = (name, mode) => {
  const config = auth();
  return config.providers === null || config.providers?.[name]?.[mode] === true;
};
const saveAuth = (value, services) => {
  if (
    !value ||
    typeof value.registration !== 'boolean' ||
    typeof value.email !== 'boolean' ||
    !value.providers ||
    typeof value.providers !== 'object' ||
    Array.isArray(value.providers)
  ) {
    throw invalid();
  }
  const providers = {};
  for (const [name, flags] of Object.entries(value.providers)) {
    if (
      !services.some((service) => service.name === name) ||
      !/^[a-z][a-z0-9_-]*$/u.test(name) ||
      !flags ||
      typeof flags.login !== 'boolean' ||
      typeof flags.bind !== 'boolean'
    ) {
      throw invalid();
    }
    providers[name] = { login: flags.login, bind: flags.bind };
  }
  return save('auth', { registration: value.registration, email: value.email, providers });
};
const saveComments = (value) => {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.allowAdmin !== 'boolean') {
    throw invalid();
  }
  return save('comments', { enabled: value.enabled, allowAdmin: value.allowAdmin });
};
module.exports = {
  read,
  save,
  auth,
  comments,
  images,
  saveImages,
  allowed,
  provider,
  saveAuth,
  saveComments,
  invalid,
};
