const isLoopback = (origin) => {
  try {
    const host = new URL(origin).hostname
      .toLowerCase()
      .replaceAll(/^\[|\]$/gu, '')
      .replace(/\.$/u, '');
    return (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host === '::' ||
      host.startsWith('127.') ||
      /^::ffff:7f[\da-f]{2}:/u.test(host)
    );
  } catch {
    return false;
  }
};
module.exports = { isLoopback };
