create table if not exists public.telegram_mini_app_users (
  telegram_user_id bigint primary key,
  first_name text,
  username text,
  first_opened_at timestamptz not null default now()
);

alter table public.telegram_mini_app_users enable row level security;
revoke all on table public.telegram_mini_app_users from anon, authenticated;
grant all on table public.telegram_mini_app_users to service_role;
