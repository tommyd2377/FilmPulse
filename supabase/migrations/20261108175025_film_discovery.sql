-- FilmPulse owns this schema only. Browsers never access these tables directly.
create schema if not exists film_discovery;
revoke all on schema film_discovery from public, anon, authenticated;

create table if not exists film_discovery.movies (
  movie_id bigint primary key check (movie_id > 0),
  title text not null check (length(title) between 1 and 400),
  release_year integer,
  genres integer[] not null,
  popularity double precision not null,
  vote_average double precision not null,
  vote_count bigint not null check (vote_count >= 0),
  data jsonb not null check (jsonb_typeof(data) = 'object')
);
create index if not exists discovery_movie_genres on film_discovery.movies using gin (genres);
create table if not exists film_discovery.catalog_runs (
  run_id uuid primary key,
  catalog_key text not null check (catalog_key ~ '^[A-Z]{2}_[a-z]+$'),
  service text not null,
  region text not null check (region ~ '^[A-Z]{2}$'),
  source text not null check (source in ('sample', 'tmdb')),
  checked_at timestamptz not null,
  completed_at timestamptz not null,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object')
);
create table if not exists film_discovery.catalogs (
  catalog_key text primary key,
  active_run uuid not null references film_discovery.catalog_runs(run_id)
);
create table if not exists film_discovery.availability (
  run_id uuid not null references film_discovery.catalog_runs(run_id) on delete cascade,
  movie_id bigint not null references film_discovery.movies(movie_id),
  primary key (run_id, movie_id)
);
create index if not exists discovery_availability_movie on film_discovery.availability(movie_id);
create table if not exists film_discovery.guests (guest_id uuid primary key);
create table if not exists film_discovery.rounds (
  round_id uuid primary key,
  guest_id uuid not null references film_discovery.guests(guest_id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  selected_id bigint,
  vote_created boolean not null default false,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);
create index if not exists discovery_round_guest on film_discovery.rounds(guest_id, created_at desc);
create table if not exists film_discovery.round_movies (
  round_id uuid not null references film_discovery.rounds(round_id) on delete cascade,
  movie_id bigint not null references film_discovery.movies(movie_id),
  primary key (round_id, movie_id)
);
create table if not exists film_discovery.favorites (
  guest_id uuid not null references film_discovery.guests(guest_id),
  movie_id bigint not null references film_discovery.movies(movie_id),
  origin_round uuid not null,
  created_at timestamptz not null default now(),
  primary key (guest_id, movie_id),
  foreign key (origin_round, movie_id) references film_discovery.round_movies(round_id, movie_id)
);
create index if not exists discovery_favorite_movie on film_discovery.favorites(movie_id, guest_id);
create index if not exists discovery_favorite_recent on film_discovery.favorites(guest_id, created_at desc);
create table if not exists film_discovery.round_limits (
  guest_id uuid primary key references film_discovery.guests(guest_id),
  minute bigint not null,
  requests integer not null check (requests between 1 and 20)
);
create table if not exists film_discovery.migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- Server-only access. There are no permissive browser RLS policies.
alter table film_discovery.movies enable row level security;
alter table film_discovery.catalog_runs enable row level security;
alter table film_discovery.catalogs enable row level security;
alter table film_discovery.availability enable row level security;
alter table film_discovery.guests enable row level security;
alter table film_discovery.rounds enable row level security;
alter table film_discovery.round_movies enable row level security;
alter table film_discovery.favorites enable row level security;
alter table film_discovery.round_limits enable row level security;
alter table film_discovery.migrations enable row level security;
revoke all on all tables in schema film_discovery from public, anon, authenticated;

create or replace function film_discovery.put_movies(p_movies jsonb, p_update boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_movies) <> 'array' or jsonb_array_length(p_movies) > 100000 then raise exception 'Invalid movie batch'; end if;
  insert into film_discovery.movies(movie_id, title, release_year, genres, popularity, vote_average, vote_count, data)
  select (m->>'tmdbId')::bigint, m->>'title', (m->>'releaseYear')::integer,
    array(select jsonb_array_elements_text(m->'genreIds')::integer),
    (m->>'popularity')::double precision, (m->>'voteAverage')::double precision,
    (m->>'voteCount')::bigint, m - array['availableOn', 'reason', 'sample', 'relations']
  from jsonb_array_elements(p_movies) m
  on conflict (movie_id) do update set title = excluded.title, release_year = excluded.release_year,
    genres = excluded.genres, popularity = excluded.popularity, vote_average = excluded.vote_average,
    vote_count = excluded.vote_count, data = excluded.data
  where p_update;
end;
$$;
revoke all on function film_discovery.put_movies(jsonb, boolean) from public, anon, authenticated;

-- The server verifies the Supabase guest before calling this service-role-only
-- RPC. Each write branch is one transaction, including cross-tab pick/undo.
create or replace function public.filmpulse_discovery(p_action text, p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_round film_discovery.rounds%rowtype;
  v_manifest jsonb;
  v_current jsonb;
  v_movies jsonb;
  v_existing jsonb;
  v_movie_id bigint;
  v_round_id uuid;
  v_count integer;
begin
  if p_args is null or jsonb_typeof(p_args) <> 'object' then raise exception 'Invalid repository request'; end if;
  if p_args ? 'uid' then v_uid := (p_args->>'uid')::uuid; end if;

  if p_action = 'catalog_get' then
    return (select r.manifest from film_discovery.catalogs c join film_discovery.catalog_runs r on r.run_id = c.active_run where c.catalog_key = p_args->>'key');

  elsif p_action = 'catalog_candidates' then
    if jsonb_array_length(p_args->'keys') > 12 then raise exception 'Too many catalogs'; end if;
    return (
      with eligible as materialized (
        select m.movie_id, m.data, m.genres, m.popularity, m.vote_average, m.vote_count, m.release_year,
          jsonb_agg(distinct r.service) as services, bool_or(r.source = 'sample') as sample
        from film_discovery.catalogs c
        join film_discovery.catalog_runs r on r.run_id = c.active_run
        join film_discovery.availability a on a.run_id = r.run_id
        join film_discovery.movies m on m.movie_id = a.movie_id
        where c.catalog_key in (select jsonb_array_elements_text(p_args->'keys'))
          and (r.source = 'sample' or r.checked_at >= now() - interval '24 hours')
        group by m.movie_id
      ), popular as (
        select movie_id from eligible order by popularity desc, movie_id limit 48
      ), gems as (
        select movie_id from eligible where vote_count >= 25
          and popularity <= (select percentile_cont(0.5) within group (order by popularity) from eligible)
        order by vote_average * vote_count / (vote_count + 100.0) desc, movie_id limit 48
      ), recent as (
        select movie_id from eligible order by release_year desc nulls last, popularity desc, movie_id limit 48
      ), related as (
        select movie_id from eligible where genres && array(select jsonb_array_elements_text(coalesce(p_args->'genres', '[]'::jsonb))::integer)
        order by vote_average * vote_count / (vote_count + 100.0) desc, movie_id limit 60
      ), explore as (
        select movie_id from eligible order by md5((p_args->>'salt') || ':' || movie_id::text) limit 100
      ), pool as (
        select movie_id from popular union select movie_id from gems union select movie_id from recent
        union select movie_id from related union select movie_id from explore
      )
      select coalesce(jsonb_agg(jsonb_build_object('movie', e.data, 'services', e.services, 'sample', e.sample) order by e.movie_id), '[]'::jsonb)
      from eligible e join pool p using (movie_id)
    );

  elsif p_action = 'catalog_publish' then
    v_manifest := p_args->'manifest'; v_movies := p_args->'movies';
    if jsonb_array_length(v_movies) <> (v_manifest->>'movieCount')::integer then raise exception 'Incomplete catalog'; end if;
    if (select count(distinct (m->>'tmdbId')::bigint) from jsonb_array_elements(v_movies) m) <> jsonb_array_length(v_movies) then raise exception 'Duplicate catalog movies'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_manifest->>'key', 0));
    select r.manifest into v_current from film_discovery.catalogs c join film_discovery.catalog_runs r on r.run_id = c.active_run where c.catalog_key = v_manifest->>'key';
    if v_current is not null and (v_current->>'checkedAt')::timestamptz > (v_manifest->>'checkedAt')::timestamptz then raise exception 'A newer catalog was already published.'; end if;
    select manifest into v_existing from film_discovery.catalog_runs where run_id = (v_manifest->>'id')::uuid;
    if found then
      if v_existing <> v_manifest or exists (
        (select movie_id from film_discovery.availability where run_id = (v_manifest->>'id')::uuid
         except select (m->>'tmdbId')::bigint from jsonb_array_elements(v_movies) m)
        union all
        (select (m->>'tmdbId')::bigint from jsonb_array_elements(v_movies) m
         except select movie_id from film_discovery.availability where run_id = (v_manifest->>'id')::uuid)
      ) then raise exception 'A catalog generation cannot be changed after publication.'; end if;
      return jsonb_build_object('published', true);
    end if;
    perform film_discovery.put_movies(v_movies);
    insert into film_discovery.catalog_runs(run_id, catalog_key, service, region, source, checked_at, completed_at, manifest)
      values ((v_manifest->>'id')::uuid, v_manifest->>'key', v_manifest->>'service', v_manifest->>'region', v_manifest->>'source', (v_manifest->>'checkedAt')::timestamptz, (v_manifest->>'completedAt')::timestamptz, v_manifest)
      on conflict (run_id) do nothing;
    insert into film_discovery.availability(run_id, movie_id)
      select (v_manifest->>'id')::uuid, (m->>'tmdbId')::bigint from jsonb_array_elements(v_movies) m on conflict do nothing;
    insert into film_discovery.catalogs(catalog_key, active_run) values (v_manifest->>'key', (v_manifest->>'id')::uuid)
      on conflict (catalog_key) do update set active_run = excluded.active_run;
    return jsonb_build_object('published', true);

  elsif p_action = 'taste_get' then
    return (select jsonb_build_object(
      'favorites', coalesce(jsonb_agg(f.movie_id order by f.created_at desc, f.movie_id), '[]'::jsonb),
      'history', coalesce(jsonb_agg(jsonb_build_object('movie', m.data - array['availableOn', 'reason', 'sample', 'relations'], 'createdAt', f.created_at) order by f.created_at desc, f.movie_id), '[]'::jsonb)
    ) from film_discovery.favorites f join film_discovery.movies m using (movie_id) where f.guest_id = v_uid);

  elsif p_action = 'favorite_get' then
    return (select jsonb_build_object('movie', m.data - array['availableOn', 'reason', 'sample', 'relations'], 'roundId', f.origin_round, 'createdAt', f.created_at)
      from film_discovery.favorites f join film_discovery.movies m using (movie_id) where f.guest_id = v_uid and f.movie_id = (p_args->>'movieId')::bigint);

  elsif p_action = 'quota_take' then
    insert into film_discovery.guests values (v_uid) on conflict do nothing;
    insert into film_discovery.round_limits(guest_id, minute, requests) values (v_uid, (p_args->>'minute')::bigint, 1)
      on conflict (guest_id) do update set minute = excluded.minute,
        requests = case when film_discovery.round_limits.minute = excluded.minute then film_discovery.round_limits.requests + 1 else 1 end;
    return 'true'::jsonb;

  elsif p_action = 'round_save' then
    v_current := p_args->'round';
    if jsonb_array_length(v_current->'movies') > 10 then raise exception 'Too many offered movies'; end if;
    insert into film_discovery.guests values (v_uid) on conflict do nothing;
    perform film_discovery.put_movies(v_current->'movies');
    insert into film_discovery.rounds(round_id, guest_id, created_at, expires_at, selected_id, vote_created, data)
      values ((v_current->>'id')::uuid, v_uid, (v_current->>'createdAt')::timestamptz, (v_current->>'expiresAt')::timestamptz, null, false, v_current);
    insert into film_discovery.round_movies(round_id, movie_id)
      select (v_current->>'id')::uuid, (m->>'tmdbId')::bigint from jsonb_array_elements(v_current->'movies') m;
    return 'true'::jsonb;

  elsif p_action = 'round_get' then
    return (select data || jsonb_build_object('selectedId', selected_id, 'voteCreated', vote_created) from film_discovery.rounds where round_id = (p_args->>'roundId')::uuid and guest_id = v_uid);

  elsif p_action = 'pick' then
    v_movie_id := (p_args->>'movieId')::bigint; v_round_id := (p_args->>'roundId')::uuid;
    perform 1 from film_discovery.guests where guest_id = v_uid for update;
    select * into v_round from film_discovery.rounds where round_id = v_round_id and guest_id = v_uid for update;
    if not found then raise exception 'This set of movies is no longer available.' using errcode = 'P0404'; end if;
    if v_round.selected_id = v_movie_id then return 'true'::jsonb; end if;
    if v_round.selected_id is not null then raise exception 'Undo your previous pick before changing it.' using errcode = 'P0409'; end if;
    if v_round.expires_at < now() then raise exception 'This set has expired. Start a fresh mix.' using errcode = 'P0409'; end if;
    if not exists (select 1 from film_discovery.round_movies where round_id = v_round_id and movie_id = v_movie_id) then raise exception 'Choose a movie from this set.' using errcode = 'P0400'; end if;
    insert into film_discovery.favorites(guest_id, movie_id, origin_round) values (v_uid, v_movie_id, v_round_id) on conflict do nothing;
    get diagnostics v_count = row_count;
    update film_discovery.rounds set selected_id = v_movie_id, vote_created = (v_count = 1) where round_id = v_round_id;
    return 'true'::jsonb;

  elsif p_action = 'undo' then
    v_round_id := (p_args->>'roundId')::uuid;
    perform 1 from film_discovery.guests where guest_id = v_uid for update;
    select * into v_round from film_discovery.rounds where round_id = v_round_id and guest_id = v_uid for update;
    if not found then raise exception 'This set of movies is no longer available.' using errcode = 'P0404'; end if;
    if v_round.selected_id is null then return 'true'::jsonb; end if;
    if v_round.vote_created then delete from film_discovery.favorites where guest_id = v_uid and movie_id = v_round.selected_id and origin_round = v_round_id; end if;
    update film_discovery.rounds set selected_id = null, vote_created = false where round_id = v_round_id;
    return 'true'::jsonb;

  elsif p_action = 'stats_get' then
    return jsonb_build_object('picks', (select count(*) from film_discovery.favorites where movie_id = (p_args->>'movieId')::bigint));

  elsif p_action = 'claim_legacy_guest' then
    perform pg_advisory_xact_lock(hashtextextended(p_args->>'oldUid', 0));
    insert into film_discovery.guests values (v_uid) on conflict do nothing;
    update film_discovery.rounds set guest_id = v_uid where guest_id = (p_args->>'oldUid')::uuid;
    insert into film_discovery.favorites(guest_id, movie_id, origin_round, created_at)
      select v_uid, movie_id, origin_round, created_at from film_discovery.favorites where guest_id = (p_args->>'oldUid')::uuid on conflict do nothing;
    delete from film_discovery.favorites where guest_id = (p_args->>'oldUid')::uuid and guest_id <> v_uid;
    return 'true'::jsonb;
  end if;
  raise exception 'Unknown discovery operation';
end;
$$;
revoke all on function public.filmpulse_discovery(text, jsonb) from public, anon, authenticated;
grant execute on function public.filmpulse_discovery(text, jsonb) to service_role;
