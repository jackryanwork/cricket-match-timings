-- The reminder reschedule trigger is internal database behavior, not a public RPC.
-- Keep backend service-role compatibility while removing direct public execution.
revoke execute on function public.reschedule_match_reminders() from public, anon, authenticated;
grant execute on function public.reschedule_match_reminders() to service_role;
