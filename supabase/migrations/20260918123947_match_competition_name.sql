-- Keep a match's display name separate from its format.
alter table public.matches
    add column if not exists competition_name text;
