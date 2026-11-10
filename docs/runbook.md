# DScott OS · Runbook

For the person operating this thing — which is Devon — at the moment something is wrong, rather
than for a developer reading from the top. **Symptom first, then the fix.** Each section stands
alone.

If you are deploying for the first time, start at §7.

---

## 1. What this is and where it runs

| Piece | Where | What happens if it stops |
| --- | --- | --- |
| The app | Vercel, from `CollectiveAi1/DScott-OS` `main` | Nothing works. `/api/health` is the first check |
| The database | Supabase Postgres, pooled connection on port 6543 | The app returns 503 from `/api/health`; every page errors |
| The scheduler | One Vercel cron a day, `0 11 * * *` UTC | Nothing updates by itself. **Settings → Run now** does any job on demand |
| Google Calendar | Read-only OAuth, tokens encrypted in the database | Family events stop updating. Command says "Reconnect Google Calendar" |
| The model | Anthropic API | The Operator closes; briefs and reviews fall back to a plain template. **Nothing else is affected** |

**One cron a day** is the Vercel Hobby limit. `0 11 * * *` is 06:00 in New York in winter and
07:00 in summer; the morning brief's window starts at 05:00 so both land inside it. Every job
runs on that one tick if it is due, and **Run now** covers everything in between.

If you move to the Pro plan, change `vercel.json` to `*/5 * * * *` and the schedule each job
already declares starts being respected on its own. **Do this before any real email or text
provider is connected** — delivery is checked every 5 minutes by design, and on a daily cron an
approved message would wait up to a day.

---

## 2. Environment variables

Set in Vercel → Project → Settings → Environment Variables. All of them are server-side; none
reaches the browser.

| Variable | What it is | Without it |
| --- | --- | --- |
| `DATABASE_URL` | Supabase **pooled** connection string, port **6543** | The app refuses to start in production |
| `AUTH_SECRET` | 32 random bytes, base64. Signs the session cookie | Sign-in fails |
| `ENCRYPTION_KEY` | 32 random bytes, base64. AES-256-GCM for stored OAuth tokens | Google connect and sync fail |
| `CRON_SECRET` | 32 random bytes, base64. Vercel sends it as a bearer token | `/api/cron/tick` returns 503 and nothing is scheduled |
| `APP_URL` | The deployed origin, e.g. `https://dscott-os.vercel.app` | The Google OAuth callback does not come back |
| `OS_TIMEZONE` | IANA zone used the first time settings are created, e.g. `America/New_York` | Defaults to `America/New_York`. Changeable later in Settings, which wins after first run |
| `ANTHROPIC_API_KEY` | Anthropic API key | The Operator is closed; briefs and reviews use the plain template |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client (web application) | The Connections panel says not configured |
| `OPERATOR_MODEL` | Optional. Default `claude-sonnet-5` | — |
| `SUMMARY_MODEL` | Optional. Default `claude-haiku-4-5-20251001` | — |

Generate any of the three secrets with:

```bash
openssl rand -base64 32
```

**Nothing is stored in the repository.** `.env.local` is git-ignored and is for this laptop only.

---

## 3. Rotating a secret

One at a time, and redeploy after each. Changing a Vercel environment variable does **not**
affect the running deployment until you redeploy.

| Rotating | What breaks the moment you do | What to do |
| --- | --- | --- |
| `AUTH_SECRET` | Every signed-in device is signed out | Sign in again. Nothing is lost |
| `ENCRYPTION_KEY` | **Stored Google tokens become unreadable, permanently** | Settings → Connections → Disconnect, then connect Google again. Do this deliberately, not by accident |
| `CRON_SECRET` | The next cron tick returns 401 | Set the new value in Vercel and redeploy. Vercel sends the current value automatically |
| `GOOGLE_CLIENT_SECRET` | Google sync fails on its next refresh | Set it, redeploy, then Disconnect and reconnect Google |
| `ANTHROPIC_API_KEY` | The Operator stops; briefs fall back to the template | Set it and redeploy |
| `DATABASE_URL` | Everything, immediately | Only change this when moving database |

**`ENCRYPTION_KEY` is the one to be careful with.** There is no recovery for tokens encrypted
under a key you no longer have. They are not in the export (§4) on purpose — they are rotated,
not restored.

---

## 4. Restoring from an export

Settings → **Export my data** downloads every table as one JSON file.

**It contains** every task, event, contact, deal, timeline entry, approval, skill, practice row,
digest, operator thread and job run, plus your settings.

**It deliberately does not contain** your password hash or `settings.encrypted_keys`. So a
restore gives you your data back, and then:

1. Go to `/setup` and create the owner account again — a new password.
2. Settings → Connections → connect Google again.
3. Check Settings → time zone and protected time, which do come back from the export.

There is no import button. Restoring means loading the JSON into Postgres by hand, table by
table, respecting foreign keys — orgs and pipelines and boards before contacts, deals and tasks.
**For a true disaster, Supabase's own point-in-time backup is the better tool**; the export is
for taking your data elsewhere, and for reading it.

---

## 5. Needs attention, row by row

Command shows this panel only when there is something in it, worst first.

| Row | What it means | What clears it |
| --- | --- | --- |
| **Reconnect Google Calendar** | The refresh token was revoked or expired. Family events have stopped updating | Settings → Connections → connect again. If this happens weekly, see §6 |
| **Failed approval** | Something was approved for delivery and could not be sent | `/approvals` → Failed → **Back to Waiting** to try again, or Reject. In v1 this always says "No provider connected", which is expected |
| **Failed job** | A scheduled job errored in the last 24 hours. One row per job | Fix the cause, then Settings → **Run now**. `approvals-deliver` failing while no provider is connected is normal |
| **Untriaged capture** | A quick capture has sat in the Misc inbox for over 7 days | `/work` → Misc inbox → file it, finish it, or delete it |
| **No next step** / **Overdue next step** | A deal has nothing scheduled, or something that should have happened | `/pipelines` → open the deal → set a next step and a date |

---

## 6. When something is wrong

**Start here:** open `https://<your-app>/api/health`.

- `{"status":"ok"}` — the app and the database are fine. The problem is in a feature; carry on
  below.
- `503` — the database did not answer in 3 seconds. Check the Supabase project is awake and
  `DATABASE_URL` is the **pooled** string on port 6543.
- Nothing at all — the deployment is down. Check Vercel.

**Then:** Settings → Scheduled jobs shows the last 10 runs of each job with the reason for each.
That is where most answers are.

### Three things that have actually happened

**Google says "Reconnect" again a week after reconnecting.**
The Google Cloud OAuth app is still in **Testing**, and test-mode refresh tokens expire after 7
days. Publish the app in Google Cloud Console → OAuth consent screen. A single-user unverified
app is fine for your own account — you will see a warning screen when you connect, which you can
pass.

**Everything stopped updating overnight.**
Check the job history. If the last run of every job is yesterday, the cron did not fire: check
Vercel → Project → Cron Jobs, and that `CRON_SECRET` is set in the environment the deployment is
actually using. Use **Run now** to catch up in the meantime — it does not wait for the schedule.

**An approval is stuck saying "sending".**
It was claimed by a delivery that died. It returns to Failed automatically after 15 minutes, with
the reason "interrupted", and then **Back to Waiting** puts it back in your queue. Nothing was
sent.

### What is normal and not worth chasing

- `approvals-deliver` reporting `error` — v1 has no email or text provider, so every delivery
  fails by design. Going live is blocked until one exists.
- `google-sync` reporting `skipped` with "No calendars are feeding Family yet" — nothing has been
  ticked in Settings → Connections.
- The Operator being closed with no `ANTHROPIC_API_KEY`. Briefs still get written, from a
  template.

---

## 7. First deploy, as a checklist

Do these in order, in one sitting. Steps 1–3 need accounts only you have.

1. **Supabase**: create a project. Copy the connection string from Connect → **Transaction
   pooler** (port 6543), not the direct one.
2. **Vercel**: import `CollectiveAi1/DScott-OS`. Framework is detected; no build settings to
   change.
3. **Environment variables**: set everything in §2. Generate the three secrets with
   `openssl rand -base64 32`. Set `APP_URL` to the deployment URL once you have it, and redeploy
   after.
4. **Database**: from your machine, once:

   ```bash
   DATABASE_URL='<the pooled url>' npm run db:migrate && DATABASE_URL='<the pooled url>' npm run db:seed
   ```

5. **Google OAuth**: in Google Cloud Console, create an OAuth client (web application) with the
   redirect URI `${APP_URL}/api/google/callback`. **Publish the consent screen** — see §6.
6. **Check it**, in this order:
   - `/api/health` returns ok.
   - The deployed URL sends you to `/setup`. Create the owner account.
   - Settings → Connections → connect Google, tick the calendars that feed Family, Sync now.
   - Settings → Scheduled jobs → **Run now** on `daily-brief`. Command should show this
     morning's brief.
   - Confirm the delivery mode says **Sandbox**. It should. Leave it there.

7. **Then run it for a week.** That is the gate to v2: use it with real data, in sandbox, and
   write down what broke, what you changed, and what you never opened. The last of those is the
   most useful.
