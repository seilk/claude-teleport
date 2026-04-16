---
name: teleport-push
description: "Deprecated alias for /teleport-update. Pushes local Claude Code changes to your private hub."
allowed-tools: [Skill]
---

# Teleport Push (Deprecated)

`/teleport-push` is a thin alias for `/teleport-update` — both invoke the same
`hub-push` engine with the same UPSERT semantics. The flows were merged to
avoid drift between two near-identical skills.

`/teleport-update` is a superset: it supports both the private hub and the
public share repo, and it routes the "private hub only" path exactly the
way `/teleport-push` used to.

## Steps

1. Tell the user: `/teleport-push` is deprecated; the same behavior now lives
   in `/teleport-update`. Pick `Private hub only` in its target prompt to get
   the old push semantics.
2. Invoke the `teleport-update` skill via the `Skill` tool to continue.
3. Do not re-implement the push pipeline here — rely entirely on
   `/teleport-update` so there is a single source of truth.

## Migration

- Old muscle memory: `/teleport-push` → `/teleport-update` and choose
  `Private hub only`.
- Scripts or automations invoking `/teleport-push` should migrate to
  `/teleport-update` at their next update.
