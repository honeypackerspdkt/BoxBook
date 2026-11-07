-- Storage buckets.
--   public-media/<org_id>/...   logo, product photos (public read, owner writes)
--   private/<org_id>/...        invoice PDFs, artwork uploads (staff; buyers via signed URLs from Netlify functions)

-- Path segment -> uuid, or null when it is not one (so odd paths are denied, not errors).
create or replace function public.try_uuid(t text)
returns uuid
language plpgsql immutable
as $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;

insert into storage.buckets (id, name, public) values
  ('public-media', 'public-media', true),
  ('private', 'private', false)
on conflict (id) do nothing;

create policy "public reads media" on storage.objects
  for select to anon, authenticated using (bucket_id = 'public-media');

create policy "admin writes media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'public-media'
              and public.has_role(public.try_uuid((storage.foldername(name))[1]), array['Administrator']));
create policy "admin updates media" on storage.objects
  for update to authenticated
  using (bucket_id = 'public-media'
         and public.has_role(public.try_uuid((storage.foldername(name))[1]), array['Administrator']));
create policy "admin deletes media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'public-media'
         and public.has_role(public.try_uuid((storage.foldername(name))[1]), array['Administrator']));

create policy "office reads private" on storage.objects
  for select to authenticated
  using (bucket_id = 'private'
         and public.has_role(public.try_uuid((storage.foldername(name))[1]), array['Administrator', 'Sales', 'Accounts']));
create policy "office writes private" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'private'
              and public.has_role(public.try_uuid((storage.foldername(name))[1]), array['Administrator', 'Sales', 'Accounts']));
