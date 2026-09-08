alter table public.matches
  add column if not exists match_start_at timestamptz,
  add column if not exists match_timezone text not null default 'Asia/Kolkata';

update public.matches
set match_start_at = (
  (match_date::date + match_time::time) at time zone match_timezone
)
where match_start_at is null
  and match_date is not null
  and match_time is not null
  and match_timezone is not null;

alter table public.match_reminders
  add column if not exists reminder_minutes smallint not null default 30,
  add column if not exists processing_at timestamptz;

alter table public.match_reminders
  drop constraint if exists match_reminders_reminder_minutes_check;

alter table public.match_reminders
  add constraint match_reminders_reminder_minutes_check
  check (reminder_minutes in (5, 15, 30, 120));

create unique index if not exists match_reminders_user_match_uidx
  on public.match_reminders (telegram_user_id, match_id);

create index if not exists match_reminders_due_idx
  on public.match_reminders (remind_at);

create or replace function public.reschedule_match_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.match_start_at is null or new.match_start_at <= now() then
    delete from public.match_reminders
    where match_id = new.id;
  else
    update public.match_reminders
    set remind_at = new.match_start_at - (reminder_minutes * interval '1 minute'),
        processing_at = null
    where match_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists matches_reschedule_reminders on public.matches;

create trigger matches_reschedule_reminders
after update of match_start_at on public.matches
for each row
when (old.match_start_at is distinct from new.match_start_at)
execute function public.reschedule_match_reminders();
