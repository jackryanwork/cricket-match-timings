-- Track verified Telegram Mini App usage without exposing analytics tables to clients.
create table if not exists public.telegram_mini_app_daily_visits (
  telegram_user_id bigint not null,
  visit_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (telegram_user_id, visit_date)
);

create index if not exists telegram_mini_app_daily_visits_date_idx
  on public.telegram_mini_app_daily_visits (visit_date);

create table if not exists public.telegram_mini_app_presence (
  telegram_user_id bigint primary key,
  last_seen_at timestamptz not null default now()
);

create index if not exists telegram_mini_app_presence_last_seen_idx
  on public.telegram_mini_app_presence (last_seen_at);

alter table public.telegram_mini_app_daily_visits enable row level security;
alter table public.telegram_mini_app_presence enable row level security;

revoke all on table public.telegram_mini_app_daily_visits from anon, authenticated;
revoke all on table public.telegram_mini_app_presence from anon, authenticated;
grant all on table public.telegram_mini_app_daily_visits to service_role;
grant all on table public.telegram_mini_app_presence to service_role;

drop policy if exists "No public access to Mini App daily visits" on public.telegram_mini_app_daily_visits;
create policy "No public access to Mini App daily visits"
  on public.telegram_mini_app_daily_visits
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "No public access to Mini App presence" on public.telegram_mini_app_presence;
create policy "No public access to Mini App presence"
  on public.telegram_mini_app_presence
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.get_telegram_mini_app_analytics(
  p_today date,
  p_active_since timestamptz,
  p_seven_day_start date
)
returns table (
  lifetime_users bigint,
  active_users bigint,
  today_users bigint,
  seven_day_users bigint
)
language sql
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.telegram_mini_app_users),
    (select count(*) from public.telegram_mini_app_presence where last_seen_at >= p_active_since),
    (select count(*) from public.telegram_mini_app_daily_visits where visit_date = p_today),
    (select count(distinct telegram_user_id)
       from public.telegram_mini_app_daily_visits
      where visit_date between p_seven_day_start and p_today);
$$;

revoke all on function public.get_telegram_mini_app_analytics(date, timestamptz, date) from public, anon, authenticated;
grant execute on function public.get_telegram_mini_app_analytics(date, timestamptz, date) to service_role;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'cricnivo-mini-app-analytics-cleanup'
  ) then
    perform cron.schedule(
      'cricnivo-mini-app-analytics-cleanup',
      '30 20 * * *',
      $job$
        delete from public.telegram_mini_app_daily_visits
         where visit_date < ((now() at time zone 'Asia/Kolkata')::date - 90);
        delete from public.telegram_mini_app_presence
         where last_seen_at < now() - interval '10 minutes';
      $job$
    );
  end if;
end;
$$;
