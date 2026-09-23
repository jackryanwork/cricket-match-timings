-- Authenticated admins need match CRUD, but not table-maintenance privileges.
-- Keep all RLS/MFA policies and SELECT/INSERT/UPDATE/DELETE grants unchanged.
revoke truncate, references, trigger, maintain
  on table public.matches
  from authenticated;
