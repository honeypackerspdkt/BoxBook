-- Hardening after the Supabase security advisor (first real project, 9 Nov 2026).
-- 1. Helper functions pin an empty search_path (they only use pg_catalog and schema-qualified names).
alter function public.fy_label(date) set search_path = '';
alter function public.sync_stamp() set search_path = '';
alter function public.touch_updated_at() set search_path = '';
alter function public.spec_without_prices(jsonb) set search_path = '';
alter function public.try_uuid(text) set search_path = '';
alter function public.phone10(text) set search_path = '';

-- 2. Not callable by visitors who are not signed in. has_role stays executable by anon on purpose:
--    the public price-list / delivery-zone policies call it for anonymous website visitors (it returns false for them).
revoke execute on function public.my_org() from public, anon;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_org(), public.my_role() to authenticated, service_role;
-- Trigger function: never called directly (trigger execution does not need EXECUTE).
revoke execute on function public.keep_an_admin() from public, anon, authenticated;

-- Left as designed (advisor notes):
-- * counters: RLS on, no policies; only next_number() / set_counter() / web_create_order() (SECURITY DEFINER) touch it.
-- * orders_production / order_items_production: definer views whose WHERE clause checks has_role(...Production);
--   Production staff have no direct access to orders, so invoker views would show them nothing.
-- * public_business: public company details for the website (no bank or invoice set-up columns).
-- * SECURITY DEFINER RPCs for signed-in users (create_organization, assign_*_no, set_order_status, buyer_link,
--   my_invitation, accept_invitation, next_number, set_counter) each check the caller's role themselves.
