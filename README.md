# staff-apps

A Discord staff application bot with custom forms, reviewer claims, follow-up
questions, final decisions and a SQLite audit trail. Acceptance records a decision;
it does not grant a Discord role automatically.

## Install

Use Node.js 22.13+; Node 24 is recommended.

```sh
npm ci
cp .env.example .env
# Fill in DISCORD_TOKEN, CLIENT_ID and GUILD_ID
node --env-file=.env src/deploy.js
node --env-file=.env src/index.js
```

Invite your Discord application with the `bot` and `applications.commands` scopes.
Give it View Channels, Send Messages, Embed Links and Read Message History in
review and panel channels. No privileged intents or Administrator permission are
needed. Commands register only in GUILD_ID; repeat deploy for other servers.

DATABASE_PATH defaults to `./data/app.sqlite`. Run one process per database.

## Set up a template

Manage Server is required for configuration and panel creation.

1. Create a reviewer role and a private text channel. Deny View Channel to everyone,
   allow the reviewer role and bot, and remove unrelated role/member overrides.
2. `/app-template name:helper reviewer:<role> channel:<private-channel>`
3. Add one to five questions using `/app-question name:helper prompt:<question>`.
   `/app-remove-question name:helper number:2` removes a question.
   `/app-edit-question name:helper number:2 prompt:<replacement>` edits in place;
   existing forms and submitted applications keep their original questions.
4. Optionally set `/app-cooldown name:helper minutes:1440` for a one-day wait before
   reapplying. The default is zero; the maximum is 43200 minutes (30 days).
5. `/app-panel name:helper` posts an **Apply** button in the current text channel.

Repeat for other staff positions. `/app-templates` lists templates, questions and
cooldowns. `/app-toggle name:helper open:false` closes submissions, including forms
that were opened earlier. Removing every question also blocks submissions.
Questions are limited to 100 characters and answers to 1000. A form expires after
20 minutes; opening another invalidates your previous form in that server.

## Review an application

Reviewers are members with the application's saved reviewer role or Manage Server.
Permissions are checked again for each interaction. Nobody can claim, question or
review their own application, including server managers.

- Click **Claim**, or run `/app-claim id:<id>`, to take ownership of a pending review.
- Click **Accept** / **Deny**, or use `/app-review id:<id> decision:<accepted|denied>
  note:<optional note>`, to record a final decision. Review notes are visible to
  the applicant. An unclaimed application is claimed automatically by its reviewer,
  preserving the original direct-review workflow.
- A claimed application can only be decided by its claimant. Server managers must
  release another reviewer's claim before taking over; that handover is audited.
- `/app-unclaim id:<id>` releases your claim. Managers can release any pending
  claim. A former reviewer who lost their role needs a manager to release it.

Claims do not expire automatically. Accepted, denied and withdrawn applications
are final; duplicate or stale buttons cannot change them.

## Find pending reviews

`/app-queue` privately lists five pending applications per page, oldest first.
Filter with `filter:unclaimed`, `filter:mine` or `filter:waiting`, restrict by
`name:<template>`, or choose `page:2`. Only applications matching your current
reviewer roles are included; managers see all except their own applications.
The queue shows ownership and follow-up status, never application answers.
Use Previous/Next buttons to navigate queue and audit pages; every click checks
your current permissions again. Queue buttons preserve the template and filter.

## Ask for more information

1. Claim the application.
2. `/app-followup id:<id> question:<question>` saves a follow-up, up to 300 characters.
3. The applicant sees **awaiting your reply** in `/app-history`. They use
   `/app-followups id:<id>` to read the full question and click **Answer follow-up**.
   `/app-respond id:<id>` also opens the response form. Responses support 1000 characters.
4. The reviewer uses **View follow-ups** or `/app-followups id:<id>` to read the reply,
   then makes the final decision or asks another question.

Only the applicant can answer. A response form is bound to the exact request it
was opened for; it cannot answer a later question. Only one request may be open
at once, and an application supports three requests total, including cancelled
ones. Answered and cancelled requests remain in the conversation history.

Accept and Deny buttons are disabled while a request is open and re-enabled when
it is answered or cancelled. The server also blocks decisions from older buttons.
If the applicant cannot
respond, the claimant can use `/app-followup-cancel id:<id>` before deciding.
Withdrawing an application cancels any open request. Replies to cancelled,
answered or resolved requests are rejected. Follow-ups remain part of the same
pending application, so they cannot bypass the one-pending-application limit.

No DMs are sent. Applicants need to check `/app-history`; the panel explains this.
Reading follow-ups and original answers always produces a private reply.

## Applicant history and reapplication

`/app-history` shows your ten most recent applications, full review notes, open
follow-up notices and recorded cooldown deadlines. `/app-view id:<id>` shows your
original answers privately. Reviewers can view the same records.

`/app-withdraw id:<id>` withdraws your own pending application and preserves its
answers, follow-ups and history. You can reapply after any configured cooldown,
provided the template is open. There is one pending application per person per
template per server.

Cooldowns start on acceptance, denial **and withdrawal**, preventing withdrawal
from bypassing the wait. The template's setting at completion determines the
recorded deadline. Later changes apply to future completions and do not shorten
an existing deadline. Cooldowns are scoped to the server, applicant and template;
legacy decisions have no retroactive cooldown.

## Audit trail and delivery failures

`/app-audit id:<id> page:1` is restricted to reviewers and server managers. It shows
ten events per page, newest first: submissions, claims, releases, follow-up
requests, answers, cancellations, withdrawals and decisions. Events contain actor
IDs, timestamps and relevant request IDs or cooldown deadlines. Answers are kept
in the application and conversation records, rather than duplicated in audit text.

Audit events and state changes share a database transaction. Failed operations do
not leave successful-looking events or partially claimed applications. The bot
has no command to edit audit events; a host operator with database access can still
change the file. This is an operational record, not a tamper-proof ledger.
Auditing begins with v1.2.0. Earlier events are not reconstructed or backdated.

Data is saved before Discord messages are delivered. If a post or refresh fails,
`/app-post id:<id>` lets a reviewer retry without resubmitting the application or
repeating a decision. Per-application publishing is serialized and reads fresh
state, so overlapping interactions leave the review message in its latest state.
A crash between sending and saving the message ID can still leave a duplicate
message; both copies refer to the same saved application and cannot decide it twice.

## Privacy and operations

Questions, answers, follow-ups, Discord IDs, timestamps and audit events are private
server data. Do not ask applicants for passwords, tokens or unnecessary personal
information. Restrict database and backup access, explain your retention policy,
and never commit the runtime database or .env file. Automated retention and user
deletion commands are not included in this release.

The reviewer role and channel are snapshotted when a form is opened. Editing a
template does not move or rewrite existing applications. The bot checks that
everyone cannot view the review channel, that the reviewer role can view it and
that the bot has its required permissions before delivery. Administrators bypass
channel restrictions, and other explicitly allowed roles can still see the
channel: review those overrides yourself. User mentions do not send notifications.

## Checks

```sh
npm test
npm run check
npm audit --omit=dev
```

Tests cover the interaction handler from form submission through a follow-up and
final decision, role revocation, claim conflicts and manager handovers, form
ownership, stale replies, cooldown boundaries, audit pagination, transaction
rollback, maximum Discord payloads, queued message delivery, permission checks,
failed delivery retries and migration of an existing database.

Tests use in-memory or temporary SQLite files and fake Discord interactions.
Discord gateway delivery, real member roles and channel permission behavior still
need a live test server and bot token. Automated checks do not log in to Discord.

## Upgrade from 1.0.x or 1.1.x

1. Stop the bot and back up the database and any WAL files. SQLite backup tooling
   is also suitable; do not copy a changing database without its WAL.
2. Run `git pull --ff-only` and `npm ci`.
3. Re-register guild commands: `node --env-file=.env src/deploy.js`.
4. Restart the bot. A transactional migration adds the workflow tables and fields.

Existing questions, answers, decisions, message IDs and unexpired drafts are
preserved. Existing applications start unclaimed, cooldowns default to zero, and
no historical audit events are invented. No manual SQL or reset is required.
Restore the pre-upgrade backup to roll back; older releases do not enforce claims,
follow-ups or cooldowns. See [CHANGELOG.md](CHANGELOG.md) for release changes.

### Updating from 1.2.0

Pull the update, run `npm ci` and restart. No command re-registration or database
migration is needed for this patch. Use `/app-post id:<id>` to refresh an existing
review message; later workflow changes also refresh its buttons automatically.

Temporary review-message fetch failures preserve the saved message ID. Staff can
retry with /app-post. A replacement is created when Discord confirms the saved
message was deleted.

Confirmed message deletion is recovered even when it occurs between fetch and
edit. Replacement messages use the latest saved application state. Network or
permission errors still preserve the saved message ID and do not trigger reposts.
