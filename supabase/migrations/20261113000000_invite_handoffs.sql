-- Invite handoff across a fresh install: the sendlabs.dev join page records "this connection is
-- about to install Bread with invite <code>", and Bread, signed in for the first time on that
-- install, claims it. Only the invite-handoff edge function (service role) touches the table.
-- Rows live an hour. Reference: docs/architecture/navigation-and-routing.md#invite-handoff.

create table public.invite_handoffs (
  id bigint generated always as identity primary key,
  network text not null check (length(network) = 64),
  code text not null check (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now(),
  unique (network, code)
);
create index invite_handoffs_network_created on public.invite_handoffs (network, created_at desc);

alter table public.invite_handoffs enable row level security;
revoke all on public.invite_handoffs from anon, authenticated;
