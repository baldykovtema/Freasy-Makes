create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null check (plan in ('free', 'pro', 'max')),
  status text not null check (status in ('awaiting_payment', 'queued', 'generating', 'building', 'done', 'failed')),
  request jsonb not null,
  formats text[] not null,
  checkout_url text,
  payment_ref text,
  paid_at timestamptz,
  title text,
  how_to_play text,
  artifacts jsonb not null default '[]',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_user_created on public.jobs (user_id, created_at desc);

-- Одна бесплатная игра в сутки (UTC). Упавшая сборка не считается.
create unique index jobs_one_free_per_day on public.jobs (user_id, ((created_at at time zone 'utc')::date))
  where plan = 'free' and status <> 'failed';

alter table public.jobs enable row level security;

-- Пользователь только читает свои заказы. Создаёт и меняет их сервер (service role).
create policy "jobs: read own" on public.jobs for select to authenticated using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('uploads', 'uploads', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']),
  ('games', 'games', false, 52428800, null);

create policy "uploads: write own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads: read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "games: read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'games' and (storage.foldername(name))[1] = auth.uid()::text);
