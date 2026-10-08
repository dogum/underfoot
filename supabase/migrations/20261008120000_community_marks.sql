-- Community marks (M3): what people share from Underfoot, and nothing else.
--
-- Anyone can add a row that passes the checks below, with the project's
-- publishable key. Nobody but the service role (the refit job) can read,
-- change or delete a row. See docs/community.md for switching it on.
--
-- The columns are io/contribute's SharedRow, and the allowed values are the
-- app's (tests/unit/store.test.ts keeps them in step).

create table public.marks (
  id        text primary key check (char_length(id) between 6 and 64),
  received  timestamptz not null default now(),
  who       text not null check (char_length(who) between 6 and 64),
  version   text not null check (char_length(version) between 1 and 16),
  month     text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  cell      text not null check (cell ~ '^[NS][0-9]{2}[EW][0-9]{3}$'),
  verdict   text not null check (verdict in ('right', 'wrong')),
  call      text not null check (call in ('building', 'paved', 'path', 'rail', 'forest', 'scrub', 'grass', 'crop', 'water', 'wetland', 'bare', 'snow')),
  p_call    real not null check (p_call between 0 and 1),
  truth     text not null check (truth in ('building', 'paved', 'path', 'rail', 'forest', 'scrub', 'grass', 'crop', 'water', 'wetland', 'bare', 'snow')),
  how       text check (how in ('here', 'photo', 'imagery', 'local')),
  prior     text not null check (prior in ('probed', 'land')),
  readings  jsonb not null check (jsonb_typeof(readings) = 'object' and pg_column_size(readings) < 8192),
  lat       double precision check (lat between -90 and 90),
  lon       double precision check (lon between -180 and 180),
  check ((lat is null) = (lon is null)),
  check ((verdict = 'right') = (truth = call))
);

create index marks_received on public.marks (received);
create index marks_who_received on public.marks (who, received);

-- insert-only for the public: row-level security with one policy, for insert
alter table public.marks enable row level security;
revoke all on public.marks from anon, authenticated;
grant insert on public.marks to anon;
create policy "anyone can add a mark" on public.marks for insert to anon with check (true);

-- one browser can add at most 500 marks a day: a cap on storage, not on the
-- fit (the fit caps each person's influence itself, engine/community)
create function public.marks_daily_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.marks where who = new.who and received > now() - interval '1 day') >= 500 then
    raise exception 'too many marks from one browser today';
  end if;
  return new;
end;
$$;
revoke all on function public.marks_daily_limit() from public, anon, authenticated;
create trigger marks_daily_limit before insert on public.marks
  for each row execute function public.marks_daily_limit();
