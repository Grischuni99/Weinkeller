-- Weinkeller: Datenbank und Foto-Speicher
-- Im Supabase-Dashboard unter "SQL Editor" einfügen und "Run" klicken.

create table if not exists public.wines (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  producer     text default '',
  name         text default '',
  vintage      text default '',
  color        text default '',
  grape        text default '',
  appellation  text default '',
  region       text default '',
  country      text default '',
  alcohol      text default '',
  volume       text default '',
  price        text default '',
  drink_from   text default '',
  drink_to     text default '',
  profile      jsonb default '{}'::jsonb,
  pairings     text[] default '{}',
  description  text default '',
  source       text default '',
  notes        text default '',
  rating       int  default 0,
  bottles      int  default 0 check (bottles >= 0),
  photo_path   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.wines enable row level security;

drop policy if exists "eigene Weine lesen" on public.wines;
drop policy if exists "eigene Weine anlegen" on public.wines;
drop policy if exists "eigene Weine ändern" on public.wines;
drop policy if exists "eigene Weine löschen" on public.wines;
create policy "eigene Weine lesen"   on public.wines for select using (auth.uid() = user_id);
create policy "eigene Weine anlegen" on public.wines for insert with check (auth.uid() = user_id);
create policy "eigene Weine ändern"  on public.wines for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigene Weine löschen" on public.wines for delete using (auth.uid() = user_id);

create or replace function public.wines_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists wines_touch on public.wines;
create trigger wines_touch before update on public.wines for each row execute function public.wines_touch();

-- Foto-Speicher (privat): jede Person sieht nur ihren eigenen Ordner <user-id>/...
insert into storage.buckets (id, name, public)
values ('wine-photos', 'wine-photos', false)
on conflict (id) do nothing;

drop policy if exists "eigene Fotos lesen" on storage.objects;
drop policy if exists "eigene Fotos hochladen" on storage.objects;
drop policy if exists "eigene Fotos löschen" on storage.objects;
create policy "eigene Fotos lesen" on storage.objects for select
  using (bucket_id = 'wine-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "eigene Fotos hochladen" on storage.objects for insert
  with check (bucket_id = 'wine-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "eigene Fotos löschen" on storage.objects for delete
  using (bucket_id = 'wine-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Für die automatische "Wach-halten"-Aufgabe auf GitHub (gibt keine Daten preis)
create or replace function public.ping() returns text language sql security definer as $$ select 'ok' $$;
grant execute on function public.ping() to anon;
