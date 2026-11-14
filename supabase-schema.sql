-- TRACKTOR / Aspksa — Supabase PostgreSQL schema
-- Run the whole file in Supabase SQL Editor. Safe to re-run.
-- All user-owned rows are protected by Row Level Security.
create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, monthly_fee numeric(12,2), description text not null default '',
  status text not null default 'active' check (status in ('active','attention','paused')),
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, file_count integer not null default 0 check (file_count >= 0),
  color_index smallint not null default 0 check (color_index between 0 and 5),
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, description text not null default '', model text not null default 'SONNET',
  mode text not null default 'СРЕДНИЙ', enabled boolean not null default true, sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,name)
);
create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, detail text not null default '', scheduled_at timestamptz,
  status text not null default 'В ОЧЕРЕДИ', is_next boolean not null default false, enabled boolean not null default true,
  sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null, description text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  due_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, body text not null default '', source text not null default 'TRACKTOR',
  read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);

create index if not exists clients_owner_sort_idx on public.clients(owner_id,sort_order);
create index if not exists projects_owner_sort_idx on public.projects(owner_id,sort_order);
create index if not exists skills_owner_sort_idx on public.skills(owner_id,sort_order);
create index if not exists routines_owner_schedule_idx on public.routines(owner_id,scheduled_at);
create index if not exists tasks_owner_due_idx on public.tasks(owner_id,due_at);
create index if not exists notifications_owner_created_idx on public.notifications(owner_id,created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;
drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at before update on public.clients for each row execute function public.set_updated_at();
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();
drop trigger if exists skills_set_updated_at on public.skills;
create trigger skills_set_updated_at before update on public.skills for each row execute function public.set_updated_at();
drop trigger if exists routines_set_updated_at on public.routines;
create trigger routines_set_updated_at before update on public.routines for each row execute function public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.skills enable row level security;
alter table public.routines enable row level security;
alter table public.tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.user_preferences enable row level security;

drop policy if exists "Users manage own clients" on public.clients;
create policy "Users manage own clients" on public.clients for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users manage own projects" on public.projects;
create policy "Users manage own projects" on public.projects for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users manage own skills" on public.skills;
create policy "Users manage own skills" on public.skills for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users manage own routines" on public.routines;
create policy "Users manage own routines" on public.routines for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users manage own tasks" on public.tasks;
create policy "Users manage own tasks" on public.tasks for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users manage own notifications" on public.notifications;
create policy "Users manage own notifications" on public.notifications for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences" on public.user_preferences for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

grant usage on schema public to authenticated;
grant select,insert,update,delete on public.clients,public.projects,public.skills,public.routines,public.tasks,public.notifications,public.user_preferences to authenticated;
