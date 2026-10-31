-- Владелец определяется по user_id, а не по почте: в проекте выключено подтверждение почты,
-- поэтому адрес в аккаунте сам по себе ничего не доказывает.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.admins enable row level security;

create policy "admins: read self" on public.admins for select to authenticated using (user_id = auth.uid());

create function public.is_admin() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "jobs: admin read" on public.jobs for select to authenticated using (public.is_admin());

create policy "uploads: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and public.is_admin());

alter table public.jobs add column customer_email text;

update public.jobs as job set customer_email = account.email
  from auth.users as account where account.id = job.user_id;
