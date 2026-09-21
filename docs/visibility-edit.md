# Comment visibility editing

Deploy `assets/migrations/002-visibility-edit.mysql.sql` before this server release.
Back up the database first and adapt `wl_Comment` to the configured prefix. The
migration deliberately leaves historical rows as `legacy`; never mark historical
private comments as author-selected without verified provenance. Other storage
backends do not support this feature.

Authenticated authors can privatize their own leaf comments. Administrators can
also privatize another account's leaf, recording `admin` provenance. Anonymous or
inactive authors cannot supply a valid private audience. Audience accounts are
derived by the server from the original author and existing reply/root, never
from client-supplied participant IDs. Only the author may publish their own
author-selected private leaf. Administrator access does not permit publishing
another author's message. A private parent or root forbids publication. Any
child reply, including private, waiting or spam replies, blocks transitions.

`GET /api/comment/:id?type=visibility` returns authenticated directional
permissions, reason codes and a revision. `PUT /api/comment/:id` accepts
`visibility` and `visibilityRevision` alongside content. The server rechecks
permissions and unscoped reply counts under a MySQL transaction locking the
conversation root, then saves content, audience and visibility together.
Reply inserts use the same root lock and revalidate their audience. Stale
revisions return 409, disallowed transitions 403. No notifications or public
update hooks are emitted for visibility transitions.

The client loads permissions for the active account, displays the restriction
on the control, and explains rejected local actions. Returning to the original
local state is always possible. Edit drafts stay in memory even when switching
to public. Server errors retain the draft. Old servers fail closed: content
editing still works, but visibility cannot be switched. Existing pages do not
poll the policy; submission always rechecks it.

Tests use isolated HTTP controllers and an in-memory SQL transport. Production
MySQL row-lock concurrency requires a separate deployment smoke test; no live
database migration or live visibility changes are performed by the build.
