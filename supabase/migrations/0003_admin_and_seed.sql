-- =============================================================
-- 0003 — profiller, admin rolü ve tohum kullanıcı
-- =============================================================

create type user_role as enum ('admin', 'viewer');

create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       user_role not null default 'viewer',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy profiles_self_read on profiles
  for select using (user_id = auth.uid());

-- Rol kontrolü tek yerden. Politikalarda ve API'de aynı fonksiyon kullanılır.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- Provider ayarları yalnız admin'e açık. Anahtarları yöneten yüzey bu.
drop policy if exists providers_owner_all on providers;
create policy providers_admin_all on providers
  for all
  using (owner_id = auth.uid() and is_admin())
  with check (owner_id = auth.uid() and is_admin());

drop policy if exists provider_models_owner_all on provider_models;
create policy provider_models_admin_all on provider_models
  for all
  using (owner_id = auth.uid() and is_admin())
  with check (owner_id = auth.uid() and is_admin());

drop policy if exists model_routes_owner_all on model_routes;
create policy model_routes_admin_all on model_routes
  for all
  using (owner_id = auth.uid() and is_admin())
  with check (owner_id = auth.uid() and is_admin());

-- Yeni kullanıcı geldiğinde profil otomatik oluşsun.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =============================================================
-- Tohum admin
--
-- crypt/gen_salt pgcrypto'dan gelir. Supabase'de bu uzantı genelde
-- "extensions" şemasındadır; aşağıdaki çağrılar hata verirse
-- crypt(...) yerine extensions.crypt(...) yazıp tekrar çalıştır.
-- =============================================================

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where email = 'ertekin456@gmail.com';

  if v_user_id is null then
    v_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated', 'authenticated',
      'ertekin456@gmail.com',
      crypt('123456', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '', '', '', ''
    );

    insert into auth.identities (
      user_id, provider, provider_id, identity_data,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_user_id, 'email', v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', 'ertekin456@gmail.com', 'email_verified', true),
      now(), now(), now()
    );
  end if;

  insert into profiles (user_id, email, role)
  values (v_user_id, 'ertekin456@gmail.com', 'admin')
  on conflict (user_id) do update set role = 'admin';
end $$;

-- Varsayılan model profili
insert into model_presets (owner_id, name, is_default)
select user_id, 'Varsayılan', true from profiles where role = 'admin'
on conflict (owner_id, name) do nothing;
