-- facility@onparbar.com (singular) auto-admin; distinct from facilities@onparbar.com

insert into public.signup_allowlist (local_part, auto_admin) values
  ('facility', true)
on conflict (local_part) do update set auto_admin = true;
