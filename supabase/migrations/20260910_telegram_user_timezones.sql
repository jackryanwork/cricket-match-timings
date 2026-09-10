alter table public.telegram_reminder_users
  add column if not exists timezone text;

alter table public.telegram_bot_users
  add column if not exists timezone text;
