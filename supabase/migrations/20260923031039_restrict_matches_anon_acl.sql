-- Public clients only need to read match data.
-- Keep authenticated admin CRUD and RLS/MFA policies unchanged.
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.matches
  from anon;
