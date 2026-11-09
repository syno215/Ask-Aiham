-- Run AFTER registering your own account and confirming its email.
-- Replace the email below with the exact email used to sign up.
insert into public.admins (user_id)
select id from auth.users where email = 'REPLACE_WITH_YOUR_EMAIL'
on conflict (user_id) do nothing;
-- Check: the query should return 1 row if the account exists.
select count(*) as admin_accounts from public.admins;
