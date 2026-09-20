const https = require('node:https');
const dns = require('node:dns');
const { Readable } = require('node:stream');

const official =
  'https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ipv4_source.txt';
const validateURL = (value) => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    url.href.length > 2048
  )
    {throw new Error('Use a public HTTPS URL without credentials');}
  if (
    require('node:net').isIP(url.hostname.replaceAll(/^\[|\]$/gu, '')) ||
    url.hostname === 'localhost'
  )
    {throw new Error('Use a public hostname');}
  return url;
};
const publicIP = (ip) => {
  if (ip.includes(':'))
    {return /^[23][0-9a-f]{3}:/iu.test(ip) && !ip.toLowerCase().startsWith('2001:db8:');}
  const [a, b] = ip.split('.').map(Number);
  return (
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && (b === 18 || b === 19))
  );
};
// Resolve at connection time and pin the checked address: no DNS rebinding into private networks.
const safeFetch = async (address, options, redirects = 0) => {
  const url = validateURL(address);
  const response = await new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        signal: options.signal,
        headers: options.headers,
        lookup(host, opts, callback) {
          dns.lookup(host, { all: true }, (error, addresses) => {
            if (error) return callback(error);
            if (!addresses.length || addresses.some(({ address }) => !publicIP(address)))
              {return callback(new Error('Private network addresses are not allowed'));}
            if (opts.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        },
      },
      resolve,
    );
    request.on('error', reject);
  });
  // Literal IPs bypass lookup in Node.
  if (
    response.socket.remoteAddress &&
    !publicIP(response.socket.remoteAddress.replace(/^::ffff:/u, ''))
  ) {
    response.destroy();
    throw new Error('Private network addresses are not allowed');
  }
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.destroy();
    if (redirects >= 3 || !response.headers.location) throw new Error('Too many redirects');
    return safeFetch(new URL(response.headers.location, url).href, options, redirects + 1);
  }
  return new Response([204, 304].includes(response.statusCode) ? null : Readable.toWeb(response), {
    status: response.statusCode,
    headers: Object.fromEntries(
      Object.entries(response.headers).filter(([, value]) => typeof value === 'string'),
    ),
  });
};
const configuration = (value) => {
  const route = value.route || 'official';
  const customType = value.customType || 'prefix';
  const customURL = value.customURL || '';
  if (
    !['official', 'ghproxy', 'custom'].includes(route) ||
    !['prefix', 'url'].includes(customType) ||
    typeof customURL !== 'string'
  )
    {throw new Error('Invalid download route');}
  if (route === 'custom') {
    const url = validateURL(customURL);
    if (
      require('node:net').isIP(url.hostname.replaceAll(/^\[|\]$/gu, '')) ||
      url.hostname === 'localhost'
    )
      {throw new Error('Use a public hostname');}
  }
  return { route, customType, customURL };
};
const address = (value) => {
  const config = configuration(value);
  if (config.route === 'official') return official;
  if (config.route === 'ghproxy') return `https://gh-proxy.org/${official}`;
  return config.customType === 'url'
    ? config.customURL
    : `${config.customURL.replace(/\/$/u, '')}/${official}`;
};
const fetchSource = (value, options) =>
  value.route === 'custom'
    ? safeFetch(address(value), options)
    : fetch(address(value), { ...options, redirect: 'error' });
const test = async (value) => {
  const start = Date.now();
  const response = await fetchSource(configuration(value), {
    signal: AbortSignal.timeout(20000),
    headers: { Range: 'bytes=0-1023', 'User-Agent': 'Waline-IP-Database-Updater' },
  });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  const reader = response.body.getReader();
  try {
    const { value: bytes } = await reader.read();
    if (!bytes?.length || !/^\d+\.\d+\.\d+\.\d+\|/u.test(new TextDecoder().decode(bytes)))
      {throw new Error('Response is not IPv4 source data');}
    return { status: response.status, elapsed: Date.now() - start, bytes: bytes.length };
  } finally {
    await reader.cancel();
  }
};
module.exports = { configuration, address, fetchSource, test, publicIP, validateURL };
