# PS QuickIt  System (Flowable 6.8 + Hybrid NLP/Claude)

Auto-creates a support ticket for every unread mail in `urcsupportotp@gmail.com`,
using a hybrid NLP + Claude pipeline to extract subject, description, customer
details, category, urgency, and sentiment. Admins log in, review tickets, add
comments, and move status through OPEN → IN_PROGRESS → RESOLVED → CLOSED —
backed by a Flowable 6.8 BPMN process, one instance per ticket.

```
MailManagement/
├── bpmn/emailTicketWorkflow.bpmn20.xml   ← deploy this to Flowable
├── backend/                              ← Node/Express: ingestion + Flowable proxy + ticket API
└── frontend/                             ← Vite/React admin UI (same theme as your audit app)
```

## 1. Deploy the BPMN process to Flowable 6.8

Easiest path — Flowable Modeler UI (bundled with `flowable-ui`):
1. Open `http://localhost:8080/flowable-ui`, log in as `admin`.
2. **App → Modeler → Import** and upload `bpmn/emailTicketWorkflow.bpmn20.xml`.
3. Open it, click **Deploy**.

Or via REST (same effect, scriptable):
```bash
curl -u admin:test -F "file=@bpmn/emailTicketWorkflow.bpmn20.xml" \
  http://localhost:8080/flowable-ui/process-api/repository/deployments
```

Confirm the `admin` candidate group used in the BPMN (`flowable:candidateGroups="admin"`)
exists in Flowable's Identity Management and your logged-in Flowable user is a member —
otherwise `reviewTicket` tasks won't show up under that candidate group query.

## 2. Gmail setup

1. Enable **2-Step Verification** on `urcsupportotp@gmail.com`.
2. Generate an **App Password**: https://myaccount.google.com/apppasswords
3. IMAP must be enabled: Gmail → Settings → Forwarding and POP/IMAP → Enable IMAP.

## 3. Backend

```bash
cd backend
npm install
cp .env.example .env
# fill in: EMAIL, EMAIL_APP_PASSWORD, ANTHROPIC_API_KEY, FLOWABLE_BASE/USER/PASS
npm start
```
Runs on `http://localhost:4000`. Polls the inbox every 2 minutes (`INGEST_CRON`),
or trigger a one-off check with `POST /api/ingest/run` (there's also a "Check mail
now" button in the frontend).

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
```
Runs on Vite's default port (5173) and proxies `/api` + `/flowable-api` to the
backend on 4000 (see `vite.config.ts`) — no `VITE_API_BASE` needed in dev.

Sign in with any name/email (this is a placeholder local admin identity used to
attribute comments/status changes — see the note in `Loginpage.tsx` about wiring
up real auth before production).

## How a ticket is created

1. `backend/mailIngest.js` polls Gmail via IMAP, fetches unread mail.
2. `backend/nlpExtract.js` runs the hybrid pipeline:
   - **Layer 1 (local, free):** strips quoted replies/signatures, pulls
     sender name/email from headers, cheap keyword urgency pre-flag.
   - **Layer 2 (Claude Haiku 4.5, escalates to Sonnet 5 for long/ambiguous
     mail):** turns the cleaned body into strict JSON — subject, description,
     category, urgency, sentiment.
3. `flowableClient.startTicketProcess()` starts `emailTicketWorkflow` with
   those fields as process variables, using the mail's `Message-Id` as the
   Flowable `businessKey` so re-polling never double-creates a ticket.
4. The process lands on the `reviewTicket` user task (candidate group `admin`)
   and stays there — comments and status changes read/write process
   variables directly; the task only *completes* when status is set to
   `CLOSED`, which is what advances the BPMN token to the end event.

## Extending

- **Assignment / routing by category:** add an exclusive gateway after
  `startEvent` in the BPMN that reads `productOrCategory` and routes to
  category-specific candidate groups (e.g. `billing`, `technical`) instead
  of one shared `admin` task.
- **SLA escalation:** add a boundary timer event on `reviewTicket` that fires
  if `urgency == 'HIGH'` and the task isn't claimed within N minutes.
- **Gmail API instead of IMAP:** see the comment block at the bottom of
  `backend/mailIngest.js` for the OAuth/push-notification alternative.


node seedSuperAdmin.js "Admin" admin2@test.com "Admin@12345"


can createthe ticket on hishown on behl od customer,


updated to not creta te ticket for mail unasgned 