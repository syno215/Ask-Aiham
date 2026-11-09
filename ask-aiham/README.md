# Ask Aiham — Supabase / Vercel migration (v2)

This replaces the SQLite/Express backend. Existing data in SQLite is **not** imported automatically. Keep your old ZIP as a backup. The original Persona-style front end and Expose font are included.

## 1. Database
The `01_database.sql` file from the earlier step should already have been run. **Do not run it again.** This version uses the existing `profiles`, `admins`, `questions`, `replies` tables. RLS is enabled and public direct table access is revoked. All database operations run via a server-only API.

## 2. GitHub
Replace the old repository's files with the contents of this package (upload the CONTENTS, not the parent folder). Remove old `server.js` and `better-sqlite3` files. The `public/` directory and `api/[...path].js` must remain in the structure shown.

## 3. Vercel
Import the GitHub repository in Vercel. Framework Preset: Other. Root directory: repository root. No build command required. Add Environment Variables (Production/Preview):

- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_PUBLISHABLE_KEY`: the browser-safe `sb_publishable_...` key
- `SUPABASE_SECRET_KEY`: a **secret** `sb_secret_...` key; get it in Supabase Settings → API Keys, paste ONLY into Vercel environment variables. NEVER put it in GitHub, chat, browser JS, or screenshots.

Deploy. Vercel's public static directory serves the site; `/api/...` routes use the serverless function.

## 4. Admin access
Register an account on the deployed site and confirm its email. In Supabase SQL Editor, open `02_make_admin.sql`, replace the placeholder with the exact account email, run it. Sign out and log in again. This makes ONLY that account admin.

## 5. Test BEFORE sharing the URL
- Guest public question: initially not in archive; admin can publish.
- Guest private question: only admin or someone with its secret URL can view; admin cannot publish it.
- Account sign-up: email confirmation, sign-in, saved questions.
- Public replies: follow-ups await moderation; admin can approve.
- Private replies: visible only to thread owner and admin.
- Check on a separate incognito browser that no other user's private content is visible.

## Security and limitations
This is a **deployment candidate, not production audited**. Before public launch add CAPTCHA (e.g. Turnstile), server-side rate limiting, email recovery, GDPR/privacy and deletion controls, and monitoring. Serverless endpoints currently have no anti-spam throttle; don't share broadly yet. Guest secret URLs grant access to anyone possessing the link. Auth tokens are currently stored in localStorage: for higher-security deployments, migrate to httpOnly cookies and CSRF protection. The publishable key is public, but the server secret must never be exposed. Confirm your Expose font license allows website embedding.
