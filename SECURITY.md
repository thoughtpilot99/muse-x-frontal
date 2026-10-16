# Security

Churn Radar is a **local, single-user** app that holds your clients' conversations. Please keep it that way unless you add your own authentication.

## Your API keys
- Keys entered on the **Setup** page are stored in `data/app.db` on your machine. Keys in `.env.local` override them.
- Both `data/` and `.env*` (except `.env.example`) are gitignored. Never commit them, and never paste keys into issues or pull requests.
- If a key leaks, rotate it at the provider (Meta Model API, Slack) and paste the new one on the Setup page.

## Your clients' data
- Slack messages, transcripts and campaign results are stored in `data/app.db` only.
- Muse Wonder receives only client-side excerpts from the last 90 days, after emails, phone numbers and key-like strings are removed. Your team's messages are not sent.
- The Slack integration uses read methods only (`conversations.history`, `conversations.replies`, `users.info`, `auth.test`). Give the bot read scopes only.
- Nothing in the app sends email, posts to Slack or posts anywhere else.
- Delete a client's data from its page, or delete `data/app.db` to remove everything.

## Exposing the app
A tunnel (for example `cloudflared tunnel --url http://localhost:3000`) makes the **whole UI** reachable. Set `APP_PASSWORD` in `.env.local` **before** starting it. Every page then requires it; nothing in Churn Radar is public.

## Reporting a vulnerability
Please open a private security advisory on the GitHub repository rather than a public issue.
