# Seiun releases

`Release Waline` (`workflows/release.yml`) is the release entry point. Select a
version tag such as `v1.41.6-seiun` when running it manually, then choose `all`,
`client`, or `server` in `scope`. The tagged commit must be on `dev`.

- `publish @waline/client` builds and tests the client and returns its archive and
  checksums as a workflow artifact. Its original upstream npm publishing job is
  still limited to `walinejs/waline`.
- `publish @waline/server` tests the packaged server, publishes native amd64 and
  arm64 images, and returns the multi-platform digest.
- The entry point calls the selected workflows and updates the GitHub Release
  only after they succeed. Existing release notes and client assets are backed up
  as an artifact before replacement. Client-only runs do not publish Docker images.

Tag pushes default to `all`. For compatibility, a tagged commit with
`[client-only]` in its message selects `client`. Manual runs use the explicit
scope selection. The reusable workflows have no independent version-tag triggers,
so a tag push cannot start duplicate releases.

Reusing a tag replaces the selected release assets. Check `version.json` and
`SHA256SUMS` for the client; pin the server image digest rather than a mutable tag.
Server images include bundled client/admin assets; publishing only the client
does not update those assets in an already deployed server.

Publishing does not deploy a server or update the blog. Download and verify the
client release before updating the theme snapshot and rebuilding local dev.
