# IPv4 region database

`ip2region-v4.db` is generated from the upstream ip2region IPv4 source at commit
`c1a1fc7d5941760db3f8431dc05c48cf7f0e30a1` using `scripts/build-ipv4-database.py`.

Source: https://github.com/lionsoul2014/ip2region/blob/c1a1fc7d5941760db3f8431dc05c48cf7f0e30a1/data/ipv4_source.txt

- Source SHA-256: `050b9c7539b77f1d7e8af02b96258e4dd131e9555a95ff07d5df4f59965b5aa2`
- Database SHA-256: `8b457f3eae5d6a27f845796fd67ff1580f074fb856a22c3c07148bfb6b4358c3`
- Coverage: 518,279 contiguous ranges covering all IPv4 addresses.

The converter preserves upstream country, province, city and ISP fields and emits
the binary format used by the existing Node reader. No IP-specific overrides are
applied. Upstream foreign region names may be in English.

The reported address `43.132.141.24` resolves to China / Hong Kong Special
Administrative Region. IPv6 continues to use the existing library database or
`IP2REGION_DB_V6`; this update replaces the IPv4 dataset only.

Explicit `IP2REGION_DB_V4` or `IP2REGION_DB` overrides still take precedence.
No external geolocation API is contacted when reading comments.
