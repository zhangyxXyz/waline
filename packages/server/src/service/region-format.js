const clean = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return ['0', '未知', 'unknown'].includes(text.toLowerCase()) ? '' : text;
};

// Use Node's locale data rather than guessing translations of database names.
const englishRegions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const chineseRegions = new Intl.DisplayNames(['zh-CN'], { type: 'region', fallback: 'none' });
const countryNames = new Map();
for (let first = 65; first <= 90; first++) {
  for (let second = 65; second <= 90; second++) {
    const code = String.fromCharCode(first, second);
    const english = englishRegions.of(code);
    const chinese = chineseRegions.of(code);
    if (english && chinese) {
      countryNames.set(english.toLowerCase(), chinese);
      countryNames.set(code.toLowerCase(), chinese);
    }
  }
}

const localizeCountry = (value) => {
  const name = clean(value);
  return countryNames.get(name.toLowerCase()) || name;
};

// Never fall back to a more precise field than the configured level.
const formatRegion = (result, { level = 'province', country = false } = {}) => {
  if (!result || level === 'off') return '';
  const fields = {
    country: ['country'],
    province: ['province'],
    city: ['province', 'city'],
    isp: ['province', 'city', 'isp'],
  }[level] || ['province'];
  const keys = country ? ['country', ...fields] : fields;
  return [
    ...new Set(
      keys
        .map((key) => (key === 'country' ? localizeCountry(result[key]) : clean(result[key])))
        .filter(Boolean),
    ),
  ].join(' ');
};

module.exports = { formatRegion };
