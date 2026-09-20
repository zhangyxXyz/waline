import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { formatRegion: format } = require('../src/service/region-format.js');
const china = { country: '中国', province: '浙江省', city: '杭州市', isp: '电信' };

describe('region disclosure limits', () => {
  it('localizes English country names without changing regional or ISP names', () => {
    const usa = {
      country: 'United States',
      province: 'California',
      city: 'Los Angeles',
      isp: 'MULTACOM CORPORATION',
    };
    expect(format(usa, { level: 'country' })).toBe('美国');
    expect(format(usa, { level: 'isp', country: true })).toBe(
      '美国 California Los Angeles MULTACOM CORPORATION',
    );
    expect(format(usa, { level: 'province' })).toBe('California');
    expect(format(usa, { level: 'off', country: true })).toBe('');
    expect(format({ country: 'Japan' }, { level: 'country' })).toBe('日本');
    expect(format({ country: '中国' }, { level: 'country' })).toBe('中国');
    expect(format({ country: 'Unrecognized place' }, { level: 'country' })).toBe('Unrecognized place');
  });

  it('limits precision and optionally prefixes the country', () => {
    expect(format(china)).toBe('浙江省');
    expect(format(china, { level: 'country' })).toBe('中国');
    expect(format(china, { level: 'city', country: true })).toBe('中国 浙江省 杭州市');
    expect(format(china, { level: 'off', country: true })).toBe('');
  });

  it('does not disclose city or ISP when province is absent', () => {
    expect(format({ city: 'Paris', isp: 'Example' })).toBe('');
    expect(format({ country: '法国', city: 'Paris' }, { country: true })).toBe('法国');
  });

  it('removes unknown values and duplicate municipality names', () => {
    expect(
      format(
        { country: '0', province: '上海', city: '上海', isp: '未知' },
        {
          level: 'isp',
          country: true,
        },
      ),
    ).toBe('上海');
    expect(format(null)).toBe('');
  });
});
