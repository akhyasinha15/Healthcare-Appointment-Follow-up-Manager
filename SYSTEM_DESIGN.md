# System Design Write-up

## 1. Double-booking prevention

The core guarantee is enforced at the database layer, not just in application
code, because application-level "check then write" is inherently racy under
concurrency: two simultaneous requests can both pass a `SELECT ... WHERE slot is
free` check before either has written a row.

The `appointments` table has a **partial unique index** on
`(doctor_id, slot_start)` scoped to rows where `status IN ('held', 'confirmed')`.
Cancelled/completed/no-show rows are excluded, so a slot becomes bookable again
the instant an active appointment leaves that state — without deleting history.
When two patients race for the same slot, both `INSERT` statements reach SQLite,
but only one can satisfy the unique index; the second raises a
`SequelizeUniqueConstraintError`, which the service layer catches and turns into
a clean `409 Conflict — "That slot was just booked by someone else."` The patient
is redirected back to slot selection. This was verified directly: two rapid
`hold` calls for the identical slot resulted in one `201` and one `409`.

Because the constraint lives in the database, this holds even if the app is
horizontally scaled across multiple Node processes/instances — there is no
shared in-memory lock to coordinate, which would fail in a multi-instance
deployment.

## 2. Slot hold mechanism

Booking is two steps: **hold** then **confirm**. When a patient picks a slot,
`POST /appointments/hold` immediately inserts a row with `status='held'` and
`hold_expires_at = now + 5 minutes` (`SLOT_HOLD_TTL_SECONDS`), which occupies the
same unique index as a confirmed booking — so nobody else can take it while the
patient is filling in the symptom form. The frontend shows a live countdown.

Two things can end a hold:
- **Confirm**: `POST /appointments/:id/confirm` flips `status` to `confirmed`
  (only if the hold hasn't expired), attaches the LLM-generated pre-visit
  summary, and clears `hold_expires_at`.
- **Expiry**: a background cron sweep (`releaseExpiredHolds`, runs every
  `REMINDER_CRON` interval, default 10 min, but is cheap enough to run more
  frequently in production) finds `status='held' AND hold_expires_at < now` and
  flips them to `cancelled` with reason `hold_expired`, freeing the slot. This
  avoids leaking slots to abandoned bookings without requiring a per-hold
  `setTimeout` (which wouldn't survive a process restart).

If a patient tries to confirm after expiry, `confirmBooking` re-checks
`hold_expires_at` server-side (never trusts the client) and returns `409`,
telling them to re-select a slot — closing the race between "cron hasn't swept
yet" and "user submits a stale hold."

## 3. Doctor leave conflict handling

When an admin creates a `DoctorLeave` for a date range, `handleLeaveConflicts`
runs synchronously in the same request: it queries all `confirmed` appointments
whose `slot_start` falls inside `[start_date, end_date]`, cancels each one via
the same `cancelAppointment` path used everywhere else (so calendar events are
deleted and the standard cancellation email fires), and additionally enqueues a
dedicated `leave_conflict` email explaining the doctor is unavailable and
inviting the patient to rebook. The admin response includes the list of
affected appointment IDs and a count, so the action is auditable immediately —
this was verified end-to-end: a confirmed appointment on the leave date was
automatically cancelled and a notification enqueued the moment the leave was
created.

Reusing `cancelAppointment` rather than a bespoke leave-cancellation code path
keeps calendar cleanup and notification logic in one place, avoiding drift
between "normal cancel" and "leave cancel" behavior.

## 4. Notification failure handling (email reliability)

Every outbound email follows an **outbox pattern**: a `notifications` row is
written with `status='pending'` *before* any network call is attempted. The
send is then attempted immediately (fire-and-forget, so it never blocks the
HTTP response the patient/doctor is waiting on). If it fails — SMTP down, rate
limited, invalid recipient — the row is marked `failed` with `last_error` and
`attempts` incremented, rather than being lost.

A cron sweep (`retryFailedNotifications`) periodically re-attempts any
`pending`/`failed` row whose `attempts < NOTIFICATION_RETRY_MAX_ATTEMPTS`
(default 5) and whose `scheduled_for` has passed. Once attempts are exhausted
the row is marked `abandoned` instead of retried forever, so a permanently
broken address doesn't spin indefinitely — this is surfaced to admins via the
notifications table for manual follow-up. The same table doubles as the
scheduling mechanism for **future-dated** reminders: appointment reminders
(24h before) and medication reminders (one row per dose per day, computed from
the prescription's `frequency_per_day`/`times`/`duration_days`) are inserted
with a future `scheduled_for` and picked up by the same sweep when due — this
is DB-backed rather than in-memory `setTimeout`, so scheduled reminders survive
a server restart.

## 5. LLM failure handling

Both LLM calls (pre-visit triage, post-visit summary) run through a shared
`callLLM` wrapper with a bounded timeout and exponential-backoff retries. If
all retries fail or the model returns malformed JSON, a safe fallback object is
returned instead of throwing — the booking/visit-completion flow always
succeeds, and `llm_status='failed'` plus the raw error is stored for later
review. Pre-visit fallback urgency defaults to **Medium** rather than "Low," so
a triage failure never silently hides a potentially urgent case from the
doctor.
