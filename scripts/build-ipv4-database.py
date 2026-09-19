"""Convert ip2region's seven-column IPv4 source to the legacy Node reader format."""
import hashlib
import ipaddress
import json
from pathlib import Path
import struct
import sys


def build(source, output):
    data = bytearray(8)
    regions = {}
    indexes = []
    previous = -1
    for line in source.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        start, end, country, province, city, isp, _code = line.split('|')
        start, end = int(ipaddress.IPv4Address(start)), int(ipaddress.IPv4Address(end))
        assert start == previous + 1 and start <= end, 'Non-contiguous or overlapping range'
        previous = end
        region = struct.pack('<I', 0) + '|'.join([country, '0', province, city, isp]).encode()
        assert len(region) < 256, 'Legacy region record length exceeded'
        if region not in regions:
            assert len(data) < 2**24, 'Legacy pointer length exceeded'
            regions[region] = len(data) | (len(region) << 24)
            data.extend(region)
        indexes.append(struct.pack('<III', start, end, regions[region]))
    assert previous == 2**32 - 1, 'Incomplete IPv4 coverage'
    first = len(data)
    data.extend(b''.join(indexes))
    struct.pack_into('<II', data, 0, first, len(data) - 12)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    return {'ranges': len(indexes), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'database_sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


if __name__ == '__main__':
    print(json.dumps(build(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
