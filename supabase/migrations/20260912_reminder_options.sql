-- Keep the reminder choices aligned with the Mini App UI.
update public.match_reminders
set reminder_minutes = 30
where reminder_minutes = 15;

alter table public.match_reminders
  drop constraint if exists match_reminders_reminder_minutes_check;

alter table public.match_reminders
  add constraint match_reminders_reminder_minutes_check
  check (reminder_minutes in (5, 30, 60, 120));
