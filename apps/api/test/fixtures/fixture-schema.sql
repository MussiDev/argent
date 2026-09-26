-- Test-only tables for the access-control fixture resource (spec DISC-001-01a, Block 6).
-- Applied to the test database by the tests that need them; never part of production migrations.
create table if not exists test_fixture_resources (
  id uuid primary key,
  owner_id uuid not null references users (id) on delete cascade,
  group_id uuid null,
  name text not null
);

-- Every scoped table indexes its owner and group columns (list queries filter on them).
create index if not exists test_fixture_resources_owner_id_idx on test_fixture_resources (owner_id);
create index if not exists test_fixture_resources_group_id_idx on test_fixture_resources (group_id);

create table if not exists test_fixture_group_members (
  group_id uuid not null,
  user_id uuid not null references users (id) on delete cascade,
  primary key (group_id, user_id)
);
