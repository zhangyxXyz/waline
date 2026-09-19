import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const IP2Region = require('ip2region').default;
const lookup = new IP2Region({
  ipv4db: path.resolve(import.meta.dirname, '../data/ip2region-v4.db'),
});

describe('bundled IPv4 database', () => {
  it('locates the reported Tencent address in Hong Kong with the bundled database', () => {
    expect(lookup.search('43.132.141.24')).toMatchObject({
      country: '中国',
      province: '香港特别行政区',
    });
    expect(lookup.search('120.24.78.68')).toMatchObject({ province: '广东省', city: '深圳市' });
    expect(lookup.search('8.8.8.8')).toMatchObject({ country: 'United States' });
  });
});
