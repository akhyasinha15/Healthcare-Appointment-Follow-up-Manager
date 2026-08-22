# Healthcare Appointment & Follow-up Manager

A full-stack appointment platform with separate **patient**, **doctor**, and **admin**
portals. Patients book slots and describe symptoms in advance; an LLM produces a
pre-visit triage summary for the doctor; after the visit the doctor's notes are
turned into a patient-friendly summary with a medication schedule. Both sides get
email confirmations/reminders and Google Calendar invites.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | Simple, well understood, fast to build role-based REST APIs |
| Database | SQLite via Sequelize ORM | Zero external setup for grading/local dev; Sequelize makes swapping to Postgres/MySQL a one-line config change |
| Auth | JWT + bcrypt | Stateless, role claims embedded in the token |
| Email | Nodemailer (SMTP/SendGrid/Mailgun compatible) | Works with any SMTP provider; dry-run mode for local dev |
| Calendar | Google Calendar API (OAuth 2.0, googleapis) | Native calendar invites; dry-run mode for local dev |
| Background jobs | node-cron | Releases expired slot holds, retries failed notifications, fires due reminders |
| Frontend | Plain HTML/CSS/vanilla JS (3 pages) | Keeps the reference implementation dependency-free and easy to read; a production build would likely use React, but the API is framework-agnostic |

---

## 2. Project structure

```
healthcare-appointment-manager/
├── backend/
│   ├── src/
│   │   ├── config/db.js              # Sequelize/SQLite setup
│   │   ├── models/                   # User, Doctor, DoctorLeave, Appointment,
│   │   │                             # SymptomSummary, PostVisitSummary, Notification
│   │   ├── middleware/                # auth (JWT), error handler
│   │   ├── services/
│   │   │   ├── appointmentService.js  # slot generation, hold/confirm, leave conflicts
│   │   │   ├── llmService.js          # pre/post-visit LLM calls, retries, fallback
│   │   │   ├── emailService.js        # nodemailer + templates
│   │   │   ├── calendarService.js     # Google Calendar OAuth + CRUD
│   │   │   ├── notificationService.js # outbox pattern + retry sweep
│   │   │   ├── reminderService.js     # medication & appointment reminder scheduling
│   │   │   └── backgroundJobs.js      # cron entrypoint
│   │   ├── controllers/               # thin HTTP handlers per role
│   │   ├── routes/                    # /api/auth, /admin, /patient, /appointments, /doctor, /calendar
│   │   ├── utils/seed.js              # demo admin/doctor/patient
│   │   ├── app.js / server.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── index.html      # login / register
│   ├── patient.html    # search doctors, book, symptom form, my appointments
│   ├── doctor.html     # appointment list, AI pre-visit summary, post-visit notes
│   ├── admin.html      # add doctors, manage leave
│   ├── css/style.css
│   └── js/api.js       # thin fetch wrapper + session helpers
├── README.md
└── SYSTEM_DESIGN.md
```

---

## 3. Setup guide

### Prerequisites
- Node.js 18+
- npm

### Steps

```bash
cd backend
cp .env.example .env      # fill in real values (see section 4)
npm install
npm run seed               # creates the SQLite schema + a demo admin/doctor/patient
npm start                  # or `npm run dev` with nodemon
```

The server starts on `http://localhost:5000` and also serves the frontend
(`/index.html`, `/patient.html`, `/doctor.html`, `/admin.html`) as static files, so
**one process runs the whole app** — no separate frontend server needed for local
dev/grading. (For a real deployment you would typically host the frontend
separately, e.g. on Vercel, and point `CLIENT_URL`/CORS at it.)

### Demo accounts (created by `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Admin | admin@clinic.example.com | Password123! |
| Doctor | dr.sharma@clinic.example.com | Password123! |
| Patient | patient@example.com | Password123! |

### Quick walkthrough
1. Log in as **admin** → add a doctor (or use the seeded one) → mark a leave day to see patient notification in action.
2. Log in as **patient** → search doctors → pick a slot → the slot is *held* for 5 minutes → fill in symptoms → confirm (triggers the LLM pre-visit summary + email + calendar dry-run).
3. Log in as **doctor** → see the appointment with the AI-generated urgency/chief-complaint/suggested-questions → after the visit, submit clinical notes + prescription → the LLM turns this into a patient-friendly summary and medication reminders are scheduled.

---

## 4. Environment variables (`.env`)

See `backend/.env.example` for the full annotated list. Key ones:

```
PORT=5000
JWT_SECRET=replace_with_a_long_random_string
DB_STORAGE_PATH=./data/healthcare.sqlite

LLM_PROVIDER=anthropic            # or "openai"
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...

EMAIL_DRY_RUN=true                # set false + fill SMTP_* to send real emails
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=...

CALENDAR_DRY_RUN=true             # set false + fill GOOGLE_* to use real Calendar API
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5000/api/calendar/oauth/callback
```

**Dry-run modes**: `EMAIL_DRY_RUN` and `CALENDAR_DRY_RUN` default to `true` so the
entire booking flow — including "sending" confirmation emails and "creating"
calendar events — runs and can be graded/tested end-to-end **without any real
credentials**. Every dry-run action is logged to the console and still recorded in
the `notifications` table. Flip both to `false` and supply real credentials to go
live.

---

## 5. Google Calendar OAuth setup (for real use, `CALENDAR_DRY_RUN=false`)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen (External, add your test users while in testing mode).
3. Create an **OAuth 2.0 Client ID** (type: Web application).
   - Authorized redirect URI: `http://localhost:5000/api/calendar/oauth/callback` (match `GOOGLE_REDIRECT_URI`).
4. Copy the generated **Client ID** and **Client Secret** into `.env`.
5. A logged-in user calls `GET /api/calendar/oauth/url` to get a Google consent URL, visits it, and Google redirects back to `/api/calendar/oauth/callback?code=...`, which exchanges the code for tokens.
6. In this reference implementation the returned `refresh_token` is logged rather
   than persisted (see "Known simplifications" below) — in a production build you
   would add a `google_refresh_token` column (encrypted) to the `users` table and
   pass it into `calendarService.createEvent/updateEvent/deleteEvent`.

---

## 6. Database schema

```
users
  id (uuid, pk), name, email (unique), password_hash, role (patient|doctor|admin),
  phone, is_active, created_at, updated_at

doctors
  id (uuid, pk), user_id (fk -> users, unique), specialisation,
  slot_duration_minutes, working_hours (json: {"mon":[["09:00","13:00"]], ...}),
  bio, consultation_fee

doctor_leaves
  id (uuid, pk), doctor_id (fk), start_date, end_date, reason, created_by (fk -> users)

appointments
  id (uuid, pk), patient_id (fk -> users), doctor_id (fk -> doctors),
  slot_start, slot_end, status (held|confirmed|cancelled|completed|no_show),
  hold_expires_at, cancelled_reason, cancelled_by,
  google_calendar_event_id_patient, google_calendar_event_id_doctor
  -- UNIQUE partial index (doctor_id, slot_start) WHERE status IN (held, confirmed)
  --   -> this is what makes double-booking impossible at the DB layer

symptom_summaries        (1:1 with appointments)
  id, appointment_id (fk, unique), raw_symptoms, duration_days,
  urgency_level (Low|Medium|High), chief_complaint, suggested_questions (json array),
  llm_status (pending|success|failed|fallback), llm_error, llm_raw_response

post_visit_summaries     (1:1 with appointments)
  id, appointment_id (fk, unique), clinical_notes, diagnosis,
  prescription (json array of {drug, dosage, frequency_per_day, times, duration_days}),
  follow_up_date, patient_summary, medication_schedule_text, follow_up_steps (json),
  llm_status, llm_error

notifications             (outbox / audit log for every email)
  id, type (booking_confirmation|reminder_appointment|reminder_medication|
            cancellation|reschedule|leave_conflict),
  channel (email|calendar), recipient_user_id (fk), recipient_email,
  appointment_id (fk, nullable), subject, body,
  status (pending|sent|failed|abandoned), attempts, last_error,
  scheduled_for, sent_at
```

Relationships: `User 1—1 Doctor` (role=doctor) · `Doctor 1—N DoctorLeave` ·
`User(patient) 1—N Appointment` · `Doctor 1—N Appointment` ·
`Appointment 1—1 SymptomSummary` · `Appointment 1—1 PostVisitSummary` ·
`Appointment 1—N Notification`.

---

## 7. API reference

All endpoints are prefixed with `/api`. Authenticated endpoints require
`Authorization: Bearer <jwt>`.

### Auth
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Patient self-registration |
| POST | `/auth/login` | public | Returns `{ user, token }` |
| GET | `/auth/me` | any | Current user |

### Admin
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/admin/doctors` | admin | Create doctor user + profile (specialisation, working_hours, slot duration) |
| GET | `/admin/doctors` | admin | List all doctors |
| PATCH | `/admin/doctors/:doctorId` | admin | Update doctor profile |
| DELETE | `/admin/doctors/:doctorId` | admin | Deactivate doctor |
| POST | `/admin/doctors/:doctorId/leaves` | admin | Mark leave for a date range — **cancels overlapping confirmed appointments and emails affected patients** |
| GET | `/admin/doctors/:doctorId/leaves` | admin | List leave records |

### Patient
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/patient/doctors?specialisation=&q=` | any authenticated | Search doctors |
| GET | `/patient/me/appointments` | patient | My appointments (with symptom + post-visit summaries) |

### Appointments (booking flow)
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/appointments/doctors/:doctorId/slots?date=YYYY-MM-DD` | any authenticated | Available slots for a date (excludes leave days, taken/held slots) |
| POST | `/appointments/hold` | patient | Step 1: place a 5-min hold on a slot. Body: `{ doctorId, slotStart }` |
| POST | `/appointments/:id/confirm` | patient | Step 2: submit symptoms → LLM pre-visit summary → confirms booking, sends emails + calendar invites. Body: `{ symptoms, durationDays }` |
| POST | `/appointments/:id/cancel` | patient/doctor/admin | Cancel; releases the slot, deletes calendar events, emails both parties |

### Doctor
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/doctor/me/profile` | doctor | My doctor profile |
| GET | `/doctor/me/appointments` | doctor | My appointments incl. AI pre-visit summaries |
| POST | `/doctor/appointments/:id/post-visit` | doctor | Submit clinical notes + prescription → LLM patient-friendly summary → schedules medication reminders. Body: `{ clinical_notes, diagnosis, prescription: [{drug,dosage,frequency_per_day,times,duration_days}], follow_up_date }` |

### Calendar
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/calendar/oauth/url` | any authenticated | Get Google consent URL |
| GET | `/calendar/oauth/callback` | public (Google redirect) | Exchanges `code` for tokens |

---

## 8. LLM prompts used

**Pre-visit summary** (called on `POST /appointments/:id/confirm`):
```
System: You are a clinical triage assistant helping a doctor prepare for a
patient visit. Respond with STRICT JSON ONLY ... {"urgency_level": "Low"|"Medium"|"High",
"chief_complaint": "...", "suggested_questions": ["q1","q2","q3"]}

User: Analyse these symptoms and return: urgency level (Low / Medium / High),
chief complaint, and three suggested questions for the doctor. Symptoms: <symptoms>
```

**Post-visit summary** (called on `POST /doctor/appointments/:id/post-visit`):
```
System: You are a medical communication assistant that turns clinical notes into
a clear, friendly summary for a patient with no medical background. Respond with
STRICT JSON ONLY ... {"patient_summary": "...", "medication_schedule_text": "...",
"follow_up_steps": ["..."]}

User: Convert these clinical notes into a patient-friendly summary with medication
schedule and follow-up steps: <notes>
Prescription: <formatted prescription>
Follow-up date: <date>
```

Both prompts force strict JSON output, which is parsed defensively
(`llmService.js`); malformed/missing output is treated as a failure and triggers
the fallback path below.

### LLM failure handling
- Bounded per-call timeout (`LLM_TIMEOUT_MS`, default 15s)
- Up to `LLM_MAX_RETRIES` retries with exponential backoff
- On exhausted retries or malformed JSON: the request **never throws up to the
  booking/visit flow** — a safe fallback object is returned instead
  (`llm_status: 'failed'`), the appointment still confirms/completes normally, and
  the fallback + error message are stored on `symptom_summaries.llm_error` /
  `post_visit_summaries.llm_error` so staff can spot and review it later. For
  pre-visit triage specifically, the fallback urgency defaults to **Medium**
  (never silently downgraded) so a doctor always sees a flagged case rather than
  an unnoticed blank field.

---

## 9. Known simplifications (documented on purpose, not oversights)

- **Google refresh tokens are not persisted** in this reference build (they're
  logged after OAuth exchange). Production: add an encrypted
  `google_refresh_token` column to `users` and thread it through
  `calendarService.*`. `CALENDAR_DRY_RUN=true` keeps the booking flow fully
  functional without this.
- **SQLite** is used instead of Postgres for zero-setup grading; the Sequelize
  models are dialect-agnostic, so switching is a one-line change in `config/db.js`
  plus running `sequelize.sync()`/migrations against the new DB.
- **Migrations**: `sequelize.sync()` is used for simplicity instead of versioned
  migration files; a production project would use `sequelize-cli` migrations.
- **Frontend** is intentionally plain HTML/JS (three role-based pages) rather than
  a full SPA framework, to keep the reference implementation short and dependency
  free while still exercising every API endpoint end-to-end.

---

## 10. Deployment

Any Node-friendly host works (Render, Railway, Fly.io, a VM, etc.):
1. Set all `.env` variables in the host's dashboard (especially `JWT_SECRET`,
   and real LLM/SMTP/Google credentials if not using dry-run mode).
2. Build command: `npm install`. Start command: `npm start` (this also serves the
   frontend as static files, so no separate frontend deploy is required).
3. Run `npm run seed` once (e.g. via a one-off job/shell) to create demo accounts,
   or skip it and register a patient normally + have an admin create doctors via
   the UI.

If deploying frontend and backend separately, set `CLIENT_URL` to the frontend's
origin so CORS allows it.
