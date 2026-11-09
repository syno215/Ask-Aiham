-- Ask Aiham: initial Supabase schema. Run in Supabase SQL Editor.
-- Tables are private by default: no direct client access until policies and API are implemented.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  created_at timestamptz not null default now()
);
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.questions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  guest_token_hash text,
  name text not null check (char_length(name) between 2 and 60),
  title text not null check (char_length(title) between 4 and 130),
  body text not null check (char_length(body) between 8 and 4000),
  visibility text not null check (visibility in ('public','private')),
  status text not null default 'pending' check (status in ('pending','published','hidden')),
  created_at timestamptz not null default now(),
  constraint guest_or_member check ((user_id is null and guest_token_hash is not null) or (user_id is not null and guest_token_hash is null)),
  constraint private_never_published check (visibility <> 'private' or status <> 'published')
);
create table if not exists public.replies (
  id bigint generated always as identity primary key,
  question_id bigint not null references public.questions(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  body text not null check (char_length(body) between 2 and 4000),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists questions_user_id_idx on public.questions(user_id);
create index if not exists questions_public_idx on public.questions(created_at desc) where visibility='public' and status='published';
create index if not exists replies_question_id_idx on public.replies(question_id);

alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.questions enable row level security;
alter table public.replies enable row level security;

-- Restrict access until server-side API and narrowly scoped policies are installed.
revoke all on public.profiles, public.admins, public.questions, public.replies from anon, authenticated;
revoke all on sequence public.questions_id_seq, public.replies_id_seq from anon, authenticated;

-- A member may read their own profile only.
grant select on public.profiles to authenticated;
create policy "Members can read own profile" on public.profiles
for select to authenticated using (id = (select auth.uid()));

-- Public archive is intentionally not exposed yet. Server API must enforce
-- moderation and ownership, including secure guest-token verification.
