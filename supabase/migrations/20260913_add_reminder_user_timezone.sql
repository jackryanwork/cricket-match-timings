alter table public.telegram_reminder_users
  add column if not exists timezone text;
