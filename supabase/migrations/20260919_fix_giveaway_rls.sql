-- A permissive policy is required for authenticated writes; keep the same
-- administrator and MFA checks on both the using and check expressions.
drop policy if exists "Require admin MFA for giveaway settings" on public.giveaway_settings;

create policy "Require admin MFA for giveaway settings"
on public.giveaway_settings
as permissive
for all
to authenticated
using (
  auth.uid() = '749c0b4a-ae6d-41cc-b046-1695089f191c'::uuid
  and (auth.jwt() ->> 'aal') = 'aal2'
)
with check (
  auth.uid() = '749c0b4a-ae6d-41cc-b046-1695089f191c'::uuid
  and (auth.jwt() ->> 'aal') = 'aal2'
);
