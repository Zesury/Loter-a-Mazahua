# Feature: ESP32 online boards and round recovery

## Objective

Make the ESP32's digital-board list reflect the real active participants, preserve the local round across a device restart until a game reset or an online lottery win, and make local reset clear the local and cloud called-card history.

## Problem

The device UI currently renders every `players` entry returned in the cloud state. `mazahua_public_state` aggregates every member in the active room without checking recent activity, so old browser identities can appear as connected boards. Firmware round state is held in RAM and is not rehydrated from the cloud snapshot at boot. Reset creates a new room, so active state becomes empty, but prior-room records remain stored.

## Scope

- Add a per-member activity timestamp, refresh it from meaningful board activity, filter the public board list by a two-hour inactivity window, and physically delete stale members from the active room.
- Review table constraints/indexes and RLS policies before producing the database migration.
- Persist and restore the minimum local round state needed to survive a power cycle/reconnect, while respecting online win and local reset boundaries.
- Ensure reset clears local history and causes the cloud called-card/event history to be cleared consistently.
- Correct the digital-board list/count only after confirming the source's active-player semantics.

## Constraints

- The migration is prepared for manual user application only. Do not access Supabase or apply SQL remotely. The web contains a publishable key; firmware also contains a custom device JWT scoped to `loteria_v2_device_api`, not a Supabase administrative key. Never embed an administrative key in the web client.
- Do not change the cloud schema/RPC implementation without reviewing its actual SQL contract.
- Preserve existing user terminology in visible UI: use “Dispositivo”, “lector”, “Datos”, and “Nube” where applicable.
- Existing worktree has unrelated modifications in `app.js`, `index.html`, `proyecto.html`, and `styles.css`; preserve them.
- TDD mode: standard functional verification (user confirmed). No project test runner or Arduino build tool is configured; do not invent a runner.
- Forecast: approximately 180–300 authored changed lines across firmware and validation artifacts; delivery strategy `ask-on-risk` (default); no PR/chain decision required unless the estimate/running branch count exceeds the existing threshold.

## Tasks

- [x] T1. Confirm the board-list behavior and two-hour inactivity window; inspect supplied RPC definitions and verify `mazahua_members.last_seen` is absent. Route: inline investigation. Evidence: `mazahua_public_state` aggregates all current-room members; publishable-key schema check confirms `last_seen` absent and table reads blocked.
- [x] T2. Implement a database migration and web/board activity handling that refreshes member presence, displays only recent members, and permanently removes expired members from the active room. Route: delegated direct writer. Evidence: migration prepared for manual execution; activity is refreshed by `mazahua_public_state`, player output is limited to two hours, and stale deletion is scoped to the active room. Supabase application remains the user's action.
- [ ] T3. Implement reliable local round persistence and boot rehydration with explicit reset/win boundaries; ensure reset clears local called-card history. Route: delegated direct writer after T2. Trigger evidence: multiple non-trivial firmware files (`main_impl.h`, `ui.h`, and persistence/config code).
- [ ] T4. Verify reset/event behavior against the supplied `loteria_v2_device_api` contract; do not delete closed-room history unless explicitly included in the approved policy. Route: inline inspection plus functional checks.
- [ ] T5. Run the available firmware/web functional checks, inspect changed code and persistence/reset behavior, and record every unavailable or unverified check. Route: delegated per-action verification after implementation.

## Acceptance Criteria

- The digital-board count/list excludes boards that are not active participants according to the database contract; a single active board is not shown as six active boards.
- Active board presence is refreshed by board activity; member rows inactive for two hours are removed from the active room.
- After ESP32 reboot/reconnect during an unfinished game, the local UI restores the same called-card history/current card and coherent timer/pause state.
- An online LOTERÍA win or a local reset terminates the resumable local round according to the confirmed game contract.
- Local reset clears local history and the cloud called-card/event history; the UI does not claim remote completion before the cloud operation is confirmed or safely queued with an explicit pending state.
- No unrelated web styling/content changes are lost.

## Verification

- Run `git diff --check` and `node --check app.js` when applicable; use targeted browser/API smoke checks for web behavior. The user approved standard functional verification, not strict TDD.
- Firmware compilation is currently unavailable: `arduino-cli`, Arduino IDE CLI, and PlatformIO were not found on PATH and the firmware folder has no build configuration. Report this limitation unless an available alternative is discovered.
- Validate persistence across simulated power-cycle/restart, including empty state, active state, paused state, online win, and reset.
- Verify digital-board counts with a one-participant case and stale/inactive assignments based on the real RPC semantics.
- Verify reset ordering against pending cloud events so a delayed event cannot repopulate the cleared round.
- Run `git diff --check` and inspect the final diff; do not commit until each work unit and its checks are complete.

## Progress

- User supplied SQL definitions for `loteria_v2_device_api`, `mazahua_board`, `mazahua_public_state`, and `mazahua_update_board`. `mazahua_public_state` aggregates every `mazahua_members` row in the active room; `mazahua_board` inserts one member per `p_client` if missing. The list has no activity filter, explaining stale clients appearing as connected boards.
- A sanitized, zero-row PostgREST schema check confirmed `mazahua_members.last_seen` does not exist (`42703`); selecting its current columns is denied to the publishable key (`42501`). No member rows were read.
- Device reset closes the previous room and creates a new active room; public state then starts with empty events/players for the new room, while prior-room events/members remain stored.
- User explicitly authorized reading the configured Supabase project and requested stale-board cleanup. A sanitized read-only API check found exactly one `mazahua_rooms` row (`status=active`, `mode=full`, `device_status.kind=heartbeat`); it did not expose board/player assignments.
- The web's configured credential is a publishable key. It can read the room row, but RLS denies reads from `mazahua_events`; PostgREST OpenAPI introspection also requires a secret API key. Firmware has `INITIAL_DEVICE_JWT` and posts `{p_token,p_payload}` to `loteria_v2_device_api` with `heartbeat`, `event`, or `reset` payloads; the server-side function SQL is not in the firmware folder. Its response may rotate `deviceJwt`, which firmware persists. No remote writes or deletes were made; a manual heartbeat was avoided because it changes `last_seen` and may return a rotated token that is not persisted.
- The user-approved stale-member expiration window is two hours. Full `mazahua_members` DDL/RLS details are unavailable through the publishable key. User confirmed standard functional verification; no firmware build tool is available.
- User confirmed a two-hour inactivity window and that boards from before the current match should no longer appear; old-room entries are already excluded by the active-room query, while stale members within the active room need the new activity timestamp and cleanup.

## Progress (2026-11-21)

- Prepared `supabase/migrations/20261121000000_member_activity_expiry.sql` for manual application. It adds `last_seen`, backfills from `joined_at` (then current time), updates the calling member during `mazahua_public_state`, filters public players to two hours, and deletes expired rows only for the currently active room. It does not delete closed-room history. No Supabase connection or execution was performed.
- Prepared local firmware checkpoint/restore in the external `LoteriaMazahuaV2/main_impl.h`, using the existing `Preferences` instance. The snapshot contains version, started/paused state, current card, elapsed time and call history; mutations force writes and active games checkpoint no more often than every 30 seconds. Boot validates saved card IDs against the loaded catalog. Reset clears the snapshot and local history. `/api/start` returns HTTP 409 for an inconsistent inactive-but-nonempty round, and the bundled UI now surfaces non-2xx JSON errors rather than treating them as success.
- The SQL/function contract for conveying a browser-side online LOTERÍA win to the ESP32 is not present locally. Therefore online-win invalidation and its required `/api/start` reset conflict are NOT implemented or verified. Do not guess response fields or invent a device/cloud operation; obtain the authoritative RPC contract before finishing this acceptance criterion.
- The external firmware folder remains outside Git and was not copied or initialized as a repository. Compilation and hardware power-cycle tests remain unavailable/unperformed.

## Next Step

Review the authoritative device RPC response contract to connect online-win invalidation to firmware; then verify on hardware. The user must manually review/apply the migration in Supabase and load the prepared firmware files. No remote actions, Git commit, or push were performed.
