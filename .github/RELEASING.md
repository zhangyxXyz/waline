# Seiun releases

`Release Waline` (`workflows/release.yml`) is the release entry point. Select a
version tag such as `v1.41.6-seiun` when running it manually, then choose `all`,
`client`, `admin`, `server`, or `backend` (admin + server) in `scope`.
The tagged commit must be on `dev`. A `[backend]` commit marker selects backend
on tag pushes while preserving the existing client release assets.

The SMTP and template pages support test emails to an explicit recipient. SMTP
tests use saved settings. Template tests render the current editor content with
sample comments without saving it. Only administrators may use the endpoint,
with a 30-second cooldown per server process. A successful result means the SMTP
server accepted the message, not that it reached the inbox.

- `publish @waline/client` builds and tests the client and returns its archive and
  checksums as a workflow artifact. Its original upstream npm publishing job is
  still limited to `walinejs/waline`.
- `publish @waline/server` tests the packaged server, publishes native amd64 and
  arm64 images, and returns the multi-platform digest.
- `publish @waline/admin` builds a standalone `waline-admin.tar.gz`, containing
  `admin.js`, `version.json`, and the license; verify with `ADMIN-SHA256SUMS`.
- `[docker] CI for test` checks the actual `Dockerfile.fork` on relevant PRs to
  `dev` or manual runs. Server releases call the same build and smoke checks.
  This validation workflow never publishes an image.
- The entry point calls the selected workflows and updates the GitHub Release
  only after they succeed. Existing release notes and client assets are backed up
  as an artifact before replacement. Client-only runs do not publish Docker images.

Tag pushes default to `all`. For compatibility, a tagged commit with
`[client-only]` or `[admin-only]` in its message selects that component. Manual runs use the explicit
scope selection. The reusable workflows have no independent version-tag triggers,
so a tag push cannot start duplicate releases.

Reusing a tag replaces the selected release assets. Check `version.json` and
`SHA256SUMS` for the client; pin the server image digest rather than a mutable tag.
Server images include bundled client/admin assets; publishing only the client
does not update those assets in an already deployed server.

Publishing does not deploy a server or update the blog. Download and verify the
client release before updating the theme snapshot and rebuilding local dev.

## One-container deployment with independent admin assets

The image retains a bundled admin fallback. Configure the existing server with
`WALINE_ADMIN_ASSET_DIR=/app/runtime/admin/current`, using its persistent
`/app/runtime` volume. Keep `WALINE_ADMIN_MODULE_ASSET_URL=/assets/fork/admin.js`.
This initial environment change requires recreating the container once.

For each admin update, verify `ADMIN-SHA256SUMS` and `version.json`, then extract
the archive to `/service/waline/runtime/admin/releases/<commit>/`. Ensure the
container user can read these files. Atomically replace the `current` symlink
with one pointing to `releases/<commit>`. Subsequent requests load that release
without restarting or rebuilding Docker. Retain the previous release and switch
the symlink back to roll back. Never overwrite an active file in place.

Only the fixed `admin.js` route supports this override; arbitrary paths and client
assets are not exposed. Missing/empty external admin assets use the bundled file.
The route sends `Cache-Control: no-cache` so browsers revalidate after updates.
The current admin build is a single JS bundle including its styles.

Back up the compose file and runtime directory before the first deployment. Pin
server images by digest, verify the OCI source revision, then check `/ui`, the
admin asset hash, and the comment API. No database migration is needed for this
asset split. Interface-only updates may deploy admin alone; changes requiring new
server APIs must deploy a compatible server first.
