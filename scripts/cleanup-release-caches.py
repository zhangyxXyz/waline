"""Remove previous release cache groups only after a new image is published."""

import json
import os
import subprocess


def normalize_ref(ref):
    # Cache API may wrap tag refs in refs/heads/.
    if ref.startswith('refs/heads/refs/tags/'):
        return ref[len('refs/heads/'):]
    return ref


def release_cache(entry):
    return normalize_ref(entry['ref']).startswith('refs/tags/v') and (
        entry['key'].startswith('buildkit-blob-')
        or entry['key'].startswith('index-waline-fork-')
    )


def candidates(entries, keep_ref):
    if not keep_ref.startswith('refs/tags/v'):
        raise ValueError('Expected a release tag ref')
    # A complete cache is an index plus multiple layer blobs, not one entry.
    if not any(normalize_ref(e['ref']) == keep_ref and e['key'].startswith('index-waline-fork-')
               for e in entries):
        raise RuntimeError('New cache index missing; retaining previous caches')
    return [e for e in entries if release_cache(e) and normalize_ref(e['ref']) != keep_ref]


def main():
    repo = os.environ['GH_REPO']
    pages = json.loads(subprocess.check_output([
        'gh', 'api', f'repos/{repo}/actions/caches?per_page=100', '--paginate', '--slurp'
    ], text=True))
    entries = [entry for page in pages for entry in page['actions_caches']]
    selected = candidates(entries, os.environ['KEEP_CACHE_REF'])
    for entry in selected:
        subprocess.run(['gh', 'api', '--method', 'DELETE',
                        f"repos/{repo}/actions/caches/{entry['id']}"], check=True)
    print(f'Removed {len(selected)} old release cache entries; kept current group.')


if __name__ == '__main__':
    main()
