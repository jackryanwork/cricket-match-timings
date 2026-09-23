-- Reminder user preferences are managed by trusted Telegram backend functions.
-- Remove unused maintenance privileges from public database roles.
revoke truncate, references, trigger, maintain
  on table public.telegram_reminder_users
  from anon, authenticated;
