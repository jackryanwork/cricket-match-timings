-- Require the CricNivo administrator to complete MFA before reading or
-- modifying matches through an authenticated browser session.
drop policy if exists "Require admin MFA for match management" on public.matches;

create policy "Require admin MFA for match management"
on public.matches
as restrictive
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

grant select, insert, update, delete
on table public.matches
to authenticated;
