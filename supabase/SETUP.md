# Supabase setup

## 1. Create the database tables

Open the Supabase SQL Editor and run `supabase/schema.sql`.

## 2. Configure email links and create the first administrator

In Authentication > URL Configuration, set **Site URL** to the deployed website URL and add that URL to **Redirect URLs**. Do not use `localhost` for a deployed site; it only works on the same computer when a local web server is running.

In Authentication > Users, invite the first administrator. Before the recipient opens the email link, run this SQL, replacing the name and email:

```sql
insert into public.app_profiles (auth_user_id, email, full_name, role)
select id, email, 'Institute Administrator', 'admin'
from auth.users
where email = 'admin@example.com'
on conflict (auth_user_id) do update
set email = excluded.email, full_name = excluded.full_name, role = 'admin', is_active = true;
```

Disable public sign-ups in Authentication settings. New accounts are created by the authenticated administrator through the `manage-users` Edge Function.

Invitation and password-recovery links open the website's password setup screen. The link must be opened before it expires. If it expires, send a new invitation or recovery email. The administrator profile must exist before the invite is accepted, or the user will not be able to enter the institute app.

## 3. Deploy the Edge Functions

Install the Supabase CLI, sign in with `supabase login`, and link this directory to the project:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy app-data
supabase functions deploy manage-users
```

Supabase Edge Functions receive `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as server-side environment variables. Never put the service-role key in the website or commit it to GitHub.

## 4. Configure the website

In the Supabase dashboard, copy the Project URL and the publishable/anon key into `supabase-config.js`. The publishable/anon key is intended for browser use; database access is still restricted to the Edge Functions.

The app stores institute records in one protected JSONB row. Administrators can update institute data; teachers can only update attendance for their assigned courses. User passwords are managed by Supabase Auth and are never stored in the app data.
