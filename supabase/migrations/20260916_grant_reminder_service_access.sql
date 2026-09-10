grant select, insert, update, delete
  on table public.match_reminders
  to service_role;

grant usage, select
  on sequence public.match_reminders_id_seq
  to service_role;
