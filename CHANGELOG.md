# Changelog

## Unreleased

- Add a private, role-filtered pending review queue with template, claim and follow-up filters.

- Edit template questions in place without rewriting open forms or submitted applications.

- Distinguish active and expired reapplication cooldowns in application history, including the exact expiry boundary.

## 1.2.1

- Disable Accept and Deny buttons while a follow-up request is awaiting a reply.
- Re-enable decisions after the request is answered or cancelled. Server-side checks continue to reject stale buttons.
- Add a message-delivery regression test for these button state transitions.

### Upgrade

Restart after pulling and installing dependencies. No command or schema changes. Refresh existing review messages with `/app-post` to apply the updated buttons immediately.

## 1.2.0

- Add reviewer claims and explicit, audited claim releases. Managers can release another reviewer's claim; self-review remains blocked.
- Add follow-up questions and private response forms bound to individual requests, with one open request and three total per application.
- Block final decisions while a follow-up is open, and cancel outstanding requests on withdrawal.
- Add configurable per-template reapplication cooldowns after acceptance, denial and withdrawal. Existing deadlines survive later setting changes.
- Add reviewer-only paginated audit trails, written transactionally with workflow changes. Legacy events are not reconstructed.
- Serialize review-message publishing and refresh from saved state; preserve data and provide retry instructions after delivery failures.
- Show all ten history records with full notes and follow-up/cooldown information within Discord's payload limits.
- Add interaction, workflow, permission, rollback, message-delivery and legacy-migration regression tests.

### Upgrade

Stop and back up the bot, install dependencies, re-register guild commands and restart. The database migrates automatically, preserving existing applications and valid drafts. Existing cooldowns default to zero and earlier events are not backfilled. Restore the pre-upgrade backup to roll back; older releases do not enforce the new workflow.

## 1.1.0

- Add `/app-withdraw` for applicants to withdraw their own pending applications.
- Preserve withdrawn answers and history, remove review buttons and permit reapplication.
- Block stale reviews and withdrawal of applications that already have a decision.
- Expand `npm run check` to syntax-check source, browser code, tests and scripts.

### Upgrade

Re-register guild commands with `node --env-file=.env src/deploy.js`, then restart the bot. Existing SQLite data is preserved.
