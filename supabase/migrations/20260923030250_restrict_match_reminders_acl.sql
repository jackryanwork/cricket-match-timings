-- Match reminders are managed by trusted reminder/Telegram backend functions.
-- Remove unused maintenance privileges from public database roles.
revoke truncate, references, trigger, maintain
  on table public.match_reminders
  from anon, authenticated;
