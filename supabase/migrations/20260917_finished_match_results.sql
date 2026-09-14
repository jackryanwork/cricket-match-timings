-- Store match lifecycle and result details without changing existing match IDs.
alter table public.matches
  add column if not exists match_status text not null default 'scheduled',
  add column if not exists result_type text,
  add column if not exists result_summary text,
  add column if not exists finished_at timestamptz;

alter table public.matches
  drop constraint if exists matches_match_status_check;

alter table public.matches
  add constraint matches_match_status_check
  check (match_status in ('scheduled', 'live', 'finished'));

alter table public.matches
  drop constraint if exists matches_result_type_check;

alter table public.matches
  add constraint matches_result_type_check
  check (result_type is null or result_type in ('team1', 'team2', 'tie', 'draw', 'no_result', 'abandoned'));

create index if not exists matches_status_start_idx
  on public.matches (match_status, match_start_at);

create or replace function public.clear_finished_match_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.match_status = 'finished' and old.match_status is distinct from new.match_status then
    delete from public.match_reminders where match_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists matches_clear_finished_reminders on public.matches;

create trigger matches_clear_finished_reminders
after update of match_status on public.matches
for each row
when (new.match_status = 'finished' and old.match_status is distinct from new.match_status)
execute function public.clear_finished_match_reminders();
