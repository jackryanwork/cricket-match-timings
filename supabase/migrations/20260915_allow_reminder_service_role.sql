create policy "Service role manages match reminders"
  on public.match_reminders
  for all
  to service_role
  using (true)
  with check (true);
