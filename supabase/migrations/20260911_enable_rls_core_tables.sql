-- Keep the public database surface protected when this project is recreated
-- or migrations are applied to an existing Supabase project.
alter table public.matches enable row level security;
alter table public.match_reminders enable row level security;
alter table public.telegram_bot_users enable row level security;
alter table public.telegram_broadcasts enable row level security;
alter table public.telegram_mini_app_users enable row level security;
alter table public.telegram_reminder_users enable row level security;
