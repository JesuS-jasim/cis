create table if not exists public.app_profiles (
  id bigint generated always as identity primary key,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('admin', 'teacher')),
  teacher_id bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.institute_state (
  id smallint primary key check (id = 1),
  data jsonb not null default '{"teachers": [], "courses": [], "students": [], "att": {}}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.institute_state (id)
values (1)
on conflict (id) do nothing;

alter table public.app_profiles enable row level security;
alter table public.institute_state enable row level security;

revoke all on public.app_profiles from anon, authenticated;
revoke all on public.institute_state from anon, authenticated;
grant all on public.app_profiles to service_role;
grant all on public.institute_state to service_role;
grant usage, select on sequence public.app_profiles_id_seq to service_role;

create or replace function public.save_institute_state(
  p_expected_updated_at timestamptz,
  p_data jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version timestamptz;
begin
  select updated_at into current_version
  from public.institute_state
  where id = 1
  for update;

  if current_version is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'Institute data changed in another session. Reload and try again.';
  end if;

  update public.institute_state
  set data = p_data, updated_at = now()
  where id = 1
  returning updated_at into current_version;

  return current_version;
end;
$$;

revoke all on function public.save_institute_state(timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.save_institute_state(timestamptz, jsonb) to service_role;
