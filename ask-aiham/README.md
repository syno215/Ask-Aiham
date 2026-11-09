# ASK AIHAM!

A Persona 5-inspired (original graphics, no copyrighted game assets) public Q&A website.

## Features
- Guests can submit questions with a required display name, without an account.
- Optional accounts remember names and show personal question history.
- Each question is public or private at the submitter's choice.
- Public questions are invisible until the admin publishes them.
- Private guest questions use unguessable secret links. Save the link immediately.
- Only the question owner or admin can add replies; public replies require admin approval.
- Admin can answer, publish, hide, delete, and moderate.
- Searchable public archive, responsive red/black/white interface.

## Run locally

Requires Node.js 20+ and a C++ build toolchain (for better-sqlite3).

```bash
cp .env.example .env
# Edit .env with a random SESSION_SECRET and your admin email/password.
npm install
npm start
```

Open http://localhost:3000. Log in with ADMIN_EMAIL and ADMIN_PASSWORD.

Environment variables are read by the process; Node 20 does not automatically load .env. For local use, start with `node --env-file=.env server.js` or export the variables first. Node 22+ supports `node --env-file=.env server.js`.

## Deployment

Deploy as a persistent Node server (e.g., Render or Railway) with the environment variables from `.env.example`. **Use a persistent disk** and set DB_PATH to a path on that disk. Do not use ephemeral disk for real submissions or they will be lost on restart. Set NODE_ENV=production and use HTTPS for secure session cookies. Set BASE_URL to your public site URL (currently informational only).

## Before making it public

- Change admin credentials and use a strong, unique session secret.
- Add email verification/password reset for accounts (not included in this MVP).
- Add CAPTCHA or provider-backed spam controls, and durable rate limiting (currently in-memory per-process).
- Add privacy policy, contact details, retention/deletion policy and consent mechanisms appropriate for GDPR.
- Set up automatic database backups.
- For sensitive private questions, use registered accounts rather than secret guest links; anyone possessing a guest link can view the conversation.
- Do not use this as a secure channel for confidential or regulated information.

## Notes

This is a functioning self-hosted MVP, not a live deployed site. No emails or push notifications are implemented yet. Admin checks the inbox manually. Users cannot reset passwords yet.
