-- Solo para pruebas locales: en Supabase auth.uid() ya existe.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('test.player', true), '')::uuid $$;
