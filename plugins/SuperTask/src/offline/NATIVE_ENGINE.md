# Native interaction engine

All location and bulk mutations use the existing serialized private-store CAS
transaction. Optional schema 2 fields preserve exact previous disk bytes during
loading and add validated project overlays, mutation receipts, scope proofs,
archived-project scope and acknowledged dependency UUIDs. Keep each service
request object until local persistence is confirmed; uncertain retries reuse
its UUID pool and cannot substitute a different mutation.

`offlineData()` is the committed authority; UI intent overlays remain separate
until commit/reconciliation. `subscribeOffline()` emits committed raw stores.
Canonical project/section rows expose `localId` after switching `id` to the
acknowledged remote identifier. Task lists sort `order_key` within matching
project/section/parent sibling scopes. Null keys use cached legacy order for
display only; manual synchronized reordering requires migrated keys.

Todoist's current API v1 deprecates `item_reorder` / `child_order` writes in
favor of `item_update {id, order_key}`. Up/Down changes one fractional key and
checks a fresh sibling membership/order baseline; unrelated remote title/date
changes survive that preflight. Already attempted commands replay frozen UUIDs
before evaluating conflicts on dependent intents.

Container inspection is advisory. Deletion captures its scope token, recovery
metadata, chosen mode and minimum/known count in the durable transaction.
Keep tasks requires complete historical scope. Never-sent local containers have
provable scope. Explicit `verifyOfflineContainer` performs only an advisory
account-lifetime completion-history scan in 89-day windows, paginates, and
performs at most 30 history requests by default. `{maxPages:120}` can explicitly
raise that finite budget. `joined_at` does not prove a lower bound for imported,
backdated or shared historical completions, so even an exhausted dated range
cannot enable remote Keep tasks. Exact documented server totals would be needed
for that proof and are currently unavailable. Missing `joined_at`, exhausted budgets,
outside-parent subtasks, recurring occurrence history and descendant projects
produce actionable restrictions rather than claimed retention.

Keep mode moves roots and preserves cached descendant parent identities. Parent
deletion waits for durable successful move receipts. Failed/cancelled/conflicted
moves cannot unblock it. Immediately before sending, complete history and active
contents must both be empty. Explicit cascade mode requires `includeUncached`
when its count is a minimum; fresh active content, archived-descendant,
permission/identity and completion-since-intent checks reject a stale scope.

Known restrictions: remote Keep tasks is unavailable until full scope can be
proved; descendant projects must be managed separately rather than
flattened; workspace project deletion requires Todoist's administrator/archive
flow; unknown shared permissions stay disabled; account-lifetime scans can exceed
the request budget. Todoist exposes no conditional container delete, so a remote
change between the final scope read and the server command remains a race that
cannot be eliminated by a client transaction. Device/API readback is pending;
deterministic tests do not establish live hardware or server behavior.
