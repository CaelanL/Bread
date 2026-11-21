begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- Handoff rows are only for the invite-handoff edge function (service role): clients can't read
-- or write them, so nobody can list who is about to install with which invite.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.invite_handoffs'::regclass),
  'invite_handoffs has RLS on'
);
select ok(not has_table_privilege('anon', 'public.invite_handoffs', 'select'), 'anon cannot read handoffs');
select ok(not has_table_privilege('authenticated', 'public.invite_handoffs', 'select'), 'a signed-in user cannot read handoffs');
select ok(not has_table_privilege('authenticated', 'public.invite_handoffs', 'insert'), 'a signed-in user cannot write handoffs');
select throws_ok(
  $$ insert into public.invite_handoffs (network, code) values (repeat('a', 64), 'bad code') $$,
  '23514', null,
  'a code must be 8 upper-case letters or digits'
);

select * from finish();
rollback;
