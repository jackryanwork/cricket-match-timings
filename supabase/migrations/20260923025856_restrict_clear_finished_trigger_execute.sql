-- The finished-match reminder cleanup trigger is internal database behavior,
-- not a public RPC endpoint.
revoke execute on function public.clear_finished_match_reminders() from public, anon, authenticated;
grant execute on function public.clear_finished_match_reminders() to service_role;
