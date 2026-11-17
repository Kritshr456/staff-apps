# Changelog

## 1.1.0

- Add `/app-withdraw` for applicants to withdraw their own pending applications.
- Preserve withdrawn answers and history, remove review buttons and permit reapplication.
- Block stale reviews and withdrawal of applications that already have a decision.
- Expand `npm run check` to syntax-check source, browser code, tests and scripts.

### Upgrade

Re-register guild commands with `node --env-file=.env src/deploy.js`, then restart the bot. Existing SQLite data is preserved.
