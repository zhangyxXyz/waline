const store = require('./dashboard-settings.js');

const read = () => {
  const saved = store.read().smtp;
  if (saved && saved.useEnvironment === false) return saved;
  const { env } = process;
  return {
    useEnvironment: true,
    enabled: Boolean(env.SMTP_HOST || env.SMTP_SERVICE),
    host: env.SMTP_HOST || '',
    service: env.SMTP_SERVICE || '',
    port: Number(env.SMTP_PORT) || (env.SMTP_SECURE && env.SMTP_SECURE !== 'false' ? 465 : 587),
    secure: Boolean(env.SMTP_SECURE && env.SMTP_SECURE !== 'false'),
    user: env.SMTP_USER || '',
    password: env.SMTP_PASS || '',
    senderEmail: env.SENDER_EMAIL || '',
    senderName: env.SENDER_NAME || '',
    authorEmail: env.AUTHOR_EMAIL || '',
  };
};
const publicSettings = () => {
  const { password, ...value } = read();
  return { ...value, passwordConfigured: Boolean(password) };
};
const save = (value) => {
  if (!value || typeof value.useEnvironment !== 'boolean') throw store.invalid();
  if (value.useEnvironment) {
    store.save('smtp', { useEnvironment: true });
    return publicSettings();
  }
  if (
    typeof value.enabled !== 'boolean' ||
    typeof value.secure !== 'boolean' ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535
  ) {
    throw store.invalid();
  }
  const next = {
    useEnvironment: false,
    enabled: value.enabled,
    secure: value.secure,
    port: value.port,
  };
  for (const key of ['host', 'user', 'senderEmail', 'senderName', 'authorEmail']) {
    if (typeof value[key] !== 'string' || value[key].length > 320 || /[\r\n\0]/u.test(value[key])) {
      throw store.invalid();
    }
    next[key] = value[key].trim();
  }
  if (value.enabled && (!next.host || /[\s/:?#]/u.test(next.host))) throw store.invalid();
  for (const key of ['senderEmail', 'authorEmail']) {
    if (next[key] && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(next[key])) throw store.invalid();
  }
  if (typeof value.password !== 'string' || value.password.length > 4096) throw store.invalid();
  next.password = value.password || read().password;
  if (value.clearPassword === true) next.password = '';
  store.save('smtp', next);
  return publicSettings();
};
const enabled = () => {
  const value = read();
  return value.enabled && Boolean(value.host || value.service);
};
const transport = () => {
  const value = read();
  if (!enabled()) return null;
  return {
    ...(value.service
      ? { service: value.service }
      : {
          host: value.host,
          port: value.port,
          secure: value.secure,
          ...(value.useEnvironment ? {} : { requireTLS: !value.secure }),
        }),
    ...(value.user ? { auth: { user: value.user, pass: value.password } } : {}),
  };
};
const from = () => {
  const value = read();
  return { name: value.senderName, address: value.senderEmail || value.user };
};
module.exports = { read, publicSettings, save, enabled, transport, from };
