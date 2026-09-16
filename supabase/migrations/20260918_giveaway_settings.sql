-- Store the single text-only giveaway shown by the Telegram bot.
create table if not exists public.giveaway_settings (
  id integer primary key default 1 check (id = 1),
  message text not null default '' check (char_length(message) <= 4000),
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.giveaway_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.giveaway_settings enable row level security;

revoke all on table public.giveaway_settings from anon, authenticated;

grant select, insert, update on table public.giveaway_settings to authenticated;
grant all on table public.giveaway_settings to service_role;

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
