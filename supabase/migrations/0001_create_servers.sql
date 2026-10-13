-- Homelab dashboard: servers table with per-user Row Level Security.

create type public.server_type as enum ('physical', 'vm', 'container', 'other');
create type public.server_status as enum ('online', 'offline', 'unknown');

create table public.servers (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  hostname    text not null check (char_length(hostname) between 1 and 255),
  os          text check (char_length(os) <= 100),
  type        public.server_type not null default 'other',
  description text check (char_length(description) <= 1000),
  status      public.server_status not null default 'unknown',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index servers_owner_id_idx on public.servers (owner_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger servers_set_updated_at
  before update on public.servers
  for each row execute function public.set_updated_at();

alter table public.servers enable row level security;

create policy "Users can view their own servers"
  on public.servers for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Users can insert their own servers"
  on public.servers for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Users can update their own servers"
  on public.servers for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Users can delete their own servers"
  on public.servers for delete to authenticated
  using (owner_id = (select auth.uid()));
