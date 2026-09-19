import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    'cache_cleanup', Path(__file__).resolve().parents[1] / 'cleanup-release-caches.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class CacheCleanupTests(unittest.TestCase):
    def test_wrapped_tag_refs_from_real_cache_api(self):
        entries = [
            {'id': 1, 'ref': 'refs/heads/refs/tags/vnew', 'key': 'index-waline-fork-1'},
            {'id': 2, 'ref': 'refs/heads/refs/tags/vnew', 'key': 'buildkit-blob-1'},
            {'id': 3, 'ref': 'refs/heads/refs/tags/vold', 'key': 'index-waline-fork-1'},
            {'id': 4, 'ref': 'refs/tags/vold', 'key': 'buildkit-blob-1'},
        ]
        self.assertEqual([e['id'] for e in cleanup.candidates(entries, 'refs/tags/vnew')], [3, 4])

    def test_preserves_all_current_layers_and_other_caches(self):
        entries = [
            {'id': 1, 'ref': 'refs/tags/vnew', 'key': 'index-waline-fork-1'},
            {'id': 2, 'ref': 'refs/tags/vnew', 'key': 'buildkit-blob-1'},
            {'id': 3, 'ref': 'refs/tags/vold', 'key': 'index-waline-fork-1'},
            {'id': 4, 'ref': 'refs/tags/vold', 'key': 'buildkit-blob-1'},
            {'id': 5, 'ref': 'refs/heads/dev', 'key': 'buildkit-blob-1'},
            {'id': 6, 'ref': 'refs/tags/vold', 'key': 'node-cache-test'},
        ]
        self.assertEqual([e['id'] for e in cleanup.candidates(entries, 'refs/tags/vnew')], [3, 4])

    def test_no_new_index_preserves_previous_cache(self):
        with self.assertRaises(RuntimeError):
            cleanup.candidates([], 'refs/tags/vnew')

    def test_rejects_branch_execution(self):
        with self.assertRaises(ValueError):
            cleanup.candidates([], 'refs/heads/dev')


if __name__ == '__main__':
    unittest.main()
