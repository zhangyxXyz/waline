const clean = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return ['0', '未知', 'unknown'].includes(text.toLowerCase()) ? '' : text;
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
  return [...new Set(keys.map((key) => clean(result[key])).filter(Boolean))].join(' ');
};

module.exports = { formatRegion };
