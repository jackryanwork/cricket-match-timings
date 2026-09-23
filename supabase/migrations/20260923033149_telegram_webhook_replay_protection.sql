-- Deduplicate Telegram webhook deliveries before any bot side effects run.
-- The update ID is sufficient; no message content or user metadata is stored.
create table if not exists public.telegram_webhook_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

create index if not exists telegram_webhook_updates_received_at_idx
  on public.telegram_webhook_updates (received_at);

alter table public.telegram_webhook_updates enable row level security;

revoke all on table public.telegram_webhook_updates from public, anon, authenticated;
grant all on table public.telegram_webhook_updates to service_role;

drop policy if exists "No public access to Telegram webhook updates"
  on public.telegram_webhook_updates;
create policy "No public access to Telegram webhook updates"
  on public.telegram_webhook_updates
  for all
  to anon, authenticated
  using (false)
  with check (false);
