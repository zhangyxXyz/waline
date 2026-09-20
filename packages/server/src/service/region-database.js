const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isIPv4 } = require('node:net');
const downloader = require('./database-download.js');

const directory = () =>
  process.env.REGION_DATABASE_DIR || path.resolve(__dirname, '../../runtime/ip-region');
const settingsFile = () => path.join(directory(), 'settings.json');
const stateFile = () => path.join(directory(), 'state.json');
const bundled = path.resolve(__dirname, '../../data/ip2region-v4.db');
const defaults = {
  source: 'bundled',
  interval: 'off',
  route: 'official',
  customType: 'prefix',
  customURL: '',
};
let running = false;
let timer;

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
};
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
};
const external = () => process.env.IP2REGION_DB_V4 || process.env.IP2REGION_DB;
const settings = () => ({ ...defaults, ...read(settingsFile(), defaults) });
const state = () => read(stateFile(), {});
const activeFile = () => {
  if (external()) return external();
  const current = state();
  if (settings().source === 'official' && /^[a-f0-9]{64}$/.test(current.databaseHash || '')) {
    const file = path.join(directory(), `${current.databaseHash}.db`);
    if (fs.existsSync(file)) return file;
  }
  return bundled;
};
const locked = () => {
  try {
    return Date.now() - fs.statSync(path.join(directory(), 'update.lock')).mtimeMs < 15 * 60_000;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
};
const status = () => ({
  ...settings(),
  ...state(),
  running: running || locked(),
  external: Boolean(external()),
  active: external() ? 'external' : activeFile() === bundled ? 'bundled' : 'official',
});
const save = (value) => {
  if (
    !value ||
    !['bundled', 'official'].includes(value.source) ||
    !['off', 'daily', 'weekly'].includes(value.interval)
  ) {
    throw Object.assign(new Error('Invalid database settings'), { status: 400 });
  }
  if (external())
    {throw Object.assign(new Error('Database is configured by environment'), { status: 409 });}
  const download = downloader.configuration(value);
  if (running || locked()) throw Object.assign(new Error('An update is running'), { status: 409 });
  write(settingsFile(), { source: value.source, interval: value.interval, ...download });
  return status();
};

async function download(config, limit, signal, etag, progress) {
  const headerAbort = new AbortController();
  const headerTimer = setTimeout(
    () => headerAbort.abort(new Error('Connection timed out after 30 seconds')),
    30000,
  );
  let response;
  try {
    response = await downloader.fetchSource(config, {
      signal: AbortSignal.any([signal, headerAbort.signal]),
      headers: {
        'User-Agent': 'Waline-IP-Database-Updater',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    });
  } finally {
    clearTimeout(headerTimer);
  }
  if (response.status === 304) return { unchanged: true };
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  const buffers = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('Upstream file exceeds size limit');
    buffers.push(chunk);
    progress(length, Number(response.headers.get('content-length')) || null);
  }
  return { data: Buffer.concat(buffers), etag: response.headers.get('etag') };
}

// Convert the official seven-column source to the installed Node reader format.
async function convert(source) {
  const records = [Buffer.alloc(8)];
  const indexes = [];
  const pointers = new Map();
  let offset = 8;
  let previous = -1;
  for (const line of source.toString('utf8').split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const fields = line.split('|');
    if (fields.length !== 7 || !isIPv4(fields[0]) || !isIPv4(fields[1]))
      {throw new Error('Invalid upstream row');}
    const integer = (ip) => ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
    const start = integer(fields[0]);
    const end = integer(fields[1]);
    if (start !== previous + 1 || start > end) throw new Error('Invalid IPv4 coverage');
    previous = end;
    const region = [fields[2], '0', fields[3], fields[4], fields[5]].join('|');
    if (!pointers.has(region)) {
      const record = Buffer.concat([Buffer.alloc(4), Buffer.from(region)]);
      if (record.length >= 256 || offset >= 2 ** 24)
        {throw new Error('Database format limit exceeded');}
      pointers.set(region, offset + record.length * 2 ** 24);
      records.push(record);
      offset += record.length;
    }
    const index = Buffer.alloc(12);
    index.writeUInt32LE(start, 0);
    index.writeUInt32LE(end, 4);
    index.writeUInt32LE(pointers.get(region), 8);
    indexes.push(index);
    if (indexes.length % 10_000 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  if (previous !== 2 ** 32 - 1) throw new Error('Incomplete IPv4 coverage');
  records[0].writeUInt32LE(offset, 0);
  records[0].writeUInt32LE(offset + (indexes.length - 1) * 12, 4);
  return { data: Buffer.concat([...records, ...indexes]), ranges: indexes.length };
}

async function update() {
  const previous = state();
  const attemptedAt = new Date().toISOString();
  const config = settings();
  const downloadURL = downloader.address(config);
  write(stateFile(), {
    ...previous,
    attemptedAt,
    phase: 'connecting',
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
  });
  try {
    const signal = AbortSignal.timeout(5 * 60_000);
    const hasPrevious =
      /^[a-f0-9]{64}$/.test(previous.databaseHash || '') &&
      fs.existsSync(path.join(directory(), `${previous.databaseHash}.db`));
    const response = await download(
      config,
      128 * 1024 * 1024,
      signal,
      hasPrevious && previous.downloadURL === downloadURL ? previous.etag : undefined,
      (() => {
        let last = 0;
        return (downloadedBytes, totalBytes) => {
          if (Date.now() - last < 1000 && downloadedBytes !== totalBytes) return;
          last = Date.now();
          write(stateFile(), {
            ...previous,
            attemptedAt,
            phase: 'downloading',
            downloadedBytes,
            totalBytes,
            error: null,
          });
        };
      })(),
    );
    if (response.unchanged) {
      if (!hasPrevious) throw new Error('No local database for unchanged response');
      write(stateFile(), {
        ...previous,
        attemptedAt,
        checkedAt: new Date().toISOString(),
        phase: 'done',
        error: null,
      });
      return;
    }
    const source = response.data;
    const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
    const version = hash(source);
    if (hasPrevious && previous.version === version) {
      write(stateFile(), {
        ...previous,
        etag: response.etag,
        downloadURL,
        attemptedAt,
        checkedAt: new Date().toISOString(),
        phase: 'done',
        error: null,
      });
      return;
    }
    write(stateFile(), {
      ...previous,
      attemptedAt,
      phase: 'validating',
      downloadedBytes: source.length,
      totalBytes: source.length,
      error: null,
    });
    const { data, ranges } = await convert(source);
    const databaseHash = hash(data);
    const target = path.join(directory(), `${databaseHash}.db`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, data);
      const IP2Region = require('ip2region').default;
      const reader = new IP2Region({ ipv4db: temporary });
      if (!reader.search('8.8.8.8')?.country || !reader.search('120.24.78.68')?.country)
        {throw new Error('Database read check failed');}
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    const now = new Date().toISOString();
    write(stateFile(), {
      version,
      downloadURL,
      phase: 'done',
      downloadedBytes: source.length,
      totalBytes: source.length,
      etag: response.etag,
      databaseHash,
      sourceHash: version,
      ranges,
      attemptedAt,
      checkedAt: now,
      updatedAt: now,
      error: null,
    });
    // Retain the previous working generation for recovery; remove older managed files.
    for (const file of fs.readdirSync(directory())) {
      if (
        /^[a-f0-9]{64}\.db$/.test(file) &&
        file !== `${databaseHash}.db` &&
        file !== `${previous.databaseHash}.db`
      ) {
        try {
          fs.unlinkSync(path.join(directory(), file));
        } catch {
          /* A reader may still hold the file. */
        }
      }
    }
  } catch (err) {
    write(stateFile(), {
      ...previous,
      attemptedAt,
      // Keep diagnostics separate from the admin UI's translated failure message.
      phase: 'failed',
      error: `${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`,
    });
  }
}

const startUpdate = () => {
  if (external() || settings().source !== 'official')
    {throw Object.assign(new Error('Select official database first'), { status: 409 });}
  if (running || locked()) return status();
  fs.mkdirSync(directory(), { recursive: true });
  const lockFile = path.join(directory(), 'update.lock');
  try {
    if (Date.now() - fs.statSync(lockFile).mtimeMs >= 15 * 60_000) fs.unlinkSync(lockFile);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let lock;
  try {
    lock = fs.openSync(lockFile, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') return status();
    throw err;
  }
  fs.closeSync(lock);
  running = true;
  void update()
    .catch((err) => console.error('IP database update failed:', err.message))
    .finally(() => {
      running = false;
      try {
        fs.unlinkSync(lockFile);
      } catch {
        /* Already removed. */
      }
    });
  return status();
};
const tick = () => {
  try {
    const config = settings();
    if (external() || config.source !== 'official' || config.interval === 'off') return;
    const period = config.interval === 'daily' ? 86_400_000 : 7 * 86_400_000;
    if (Date.now() - (Date.parse(state().attemptedAt) || 0) >= period) startUpdate();
  } catch (err) {
    console.error('IP database scheduler:', err.message);
  }
};
const startScheduler = () => {
  if (timer) return;
  tick();
  timer = setInterval(tick, 60_000);
  timer.unref();
};

module.exports = {
  status,
  save,
  activeFile,
  startUpdate,
  startScheduler,
  convert,
  testConnection: downloader.test,
};
