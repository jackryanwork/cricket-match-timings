-- Public clients only need to read active tournaments.
-- Authenticated admins retain tournament CRUD through existing RLS/MFA policies.
revoke truncate, references, trigger, maintain
  on table public.tournaments
  from anon, authenticated;
