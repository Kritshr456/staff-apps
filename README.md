# staff-apps

A Discord staff application bot with configurable questions, modal forms,
private review messages, accept/deny buttons and persistent application history.
Acceptance records a decision; it does not grant a Discord role automatically.

## Install

Use Node.js 22.13+ (24 recommended).

```sh
npm ci
cp .env.example .env
# Fill in DISCORD_TOKEN, CLIENT_ID and GUILD_ID
node --env-file=.env src/deploy.js
node --env-file=.env src/index.js
```

Invite a Discord application with `bot` and `applications.commands` scopes.
Grant View Channels, Send Messages, Embed Links and Read Message History in
its review channel and panel channels. No privileged intents are needed.
Commands are registered only in GUILD_ID; repeat deploy for other servers.

## Configure and use

Manage Server is required for configuration and panel creation.

1. Create a reviewer role and a private text channel. Deny View Channel to everyone,
   allow the reviewer role and bot, and remove unrelated role/member overrides.
2. `/app-template name:helper reviewer:<role> channel:<private-channel>`
3. Add up to five questions with `/app-question name:helper prompt:<question>`.
   `/app-remove-question name:helper number:2` removes a question.
4. `/app-panel name:helper` posts an **Apply** button in the current channel.
5. Applicants complete the form. Reviewers accept or deny with message buttons,
   or use `/app-review id:<id> decision:<accepted|denied> note:<optional note>`.
6. `/app-history` shows your last ten applications and review notes.
   `/app-view id:<id>` shows full answers to the applicant or reviewers privately.

`/app-toggle name:helper open:false` closes submissions, including already-open
forms. `/app-templates` lists templates and questions. Repeat configuration for
other staff positions. Questions are limited to 100 characters, answers to 1000.
Forms expire after 20 minutes; opening a new form invalidates your previous draft.
One pending application per person per template is allowed. Reapplication after
a decision is permitted. There is no automated rejection cooldown in v1.

## Review reliability and privacy

The database snapshots questions, answers, reviewer role and review channel for
each submission. Changing a template does not rewrite submitted applications.
Self-review is blocked even for server managers. Decisions can only be recorded
once. Reviewer permissions are fetched when the interaction is handled.

Submissions are saved before messages are posted. If delivery or message refresh
fails, use `/app-post id:<id>` as a reviewer to retry; reviewed applications show
no buttons. Duplicate or stale buttons cannot change an existing decision. After
a crash between sending and saving a message ID, reposting can leave duplicate
messages, but both buttons resolve the same application. Applicants can check
their status without relying on DMs.

The bot verifies that everyone cannot view the review channel, that the reviewer
role can view it and that the bot has its required permissions. Administrators
bypass channel restrictions. Other explicitly allowed roles can still see the
channel: server operators must review those overrides. Application answers are
private user data; do not request passwords, tokens or unnecessary personal details.

DATABASE_PATH defaults to `./data/app.sqlite`. Run one process per database,
restrict host access, and establish a retention policy with your server. Automated
retention and user deletion commands are not included. Stop the bot before manual
maintenance and back up with SQLite backup tooling or copy all SQLite files while
stopped. Never commit the database or .env file.

## Tests

```sh
npm test
npm run check
npm audit --omit=dev
```

Tests cover stable question snapshots, form ownership and expiry, paused templates,
answer validation, duplicate submissions, review permissions, self-review,
one-time decisions and Discord payload limits. Gateway delivery and channel
permissions still need a live Discord test server.
