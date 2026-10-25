# Little Hamsters

A small group chat app with accounts, private groups, and live messages. Create a group and share its five-digit invite code with friends; each group has a separate conversation and only its members can read or send messages there.

## Run locally

Requires Node.js 20.13 or newer. Install dependencies with `npm ci`, then run `npm run dev`. The dev server restarts automatically when server code changes; refresh the browser to see HTML, CSS, and browser JavaScript updates. Run `npm start` for a normal local run.

Without `DATABASE_URL`, local development continues to use `data/app.json`. When `DATABASE_URL` is set, the app stores its data in Supabase instead. The landing page is for logging in; **Create an account** and **Forgot password?** open their own pages. Register with a username, 10-digit Indian mobile number, password, and security question and answer. Usernames and mobile numbers must be unique. After logging in, choose one of six hamster looks, create a group, and share its five-digit code with friends. Chat members see live messages, typing indicators, and their hamsters in the meadow.

## Deploy to Render and Supabase

1. Create a Supabase project. Choose a region close to your friends; Singapore is a good starting point for India.
2. In Supabase, open **Connect**, choose **Session pooler**, and copy its connection string. Use the session pooler for an IPv4-only host; Supabase documents it as available over IPv4 on every plan. The app enforces TLS for PostgreSQL connections. Keep this URL private; it contains your database password. [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres)
3. If you want to keep existing local accounts, groups, and messages, import `data/app.json` before the hosted app writes new data. In PowerShell, set `$env:DATABASE_URL` to the Supabase connection string and run `npm run import:local-data`. The importer refuses to overwrite a database that already has data. Existing users will need to sign in again on the deployed domain.
4. Push the project to GitHub, then create a Render **Blueprint** from that repository. The included `render.yaml` configures a free Node web service, `npm ci`, `npm start`, and the `/api/health` check. Render will ask for `DATABASE_URL`; paste the Supabase session-pooler URL there. The app creates its private database table on first startup, so no manual SQL setup is needed.
5. Once the Render deploy is live, open its `onrender.com` URL and share it with friends. They can register and join your group with its five-digit code.

The app requires one server instance because live presence and typing events use its in-memory event connections. Render’s free service can sleep after 15 minutes without inbound traffic and may take about a minute to wake. Its local filesystem is temporary, which is why production requires Supabase. [Render free-service limits](https://render.com/docs/free) Supabase Free provides 500 MB of database storage and may pause a project after a week of low activity. [Supabase Free plan](https://supabase.com/pricing) [Supabase pausing policy](https://supabase.com/docs/guides/platform/free-project-pausing)

## Before sharing the deployed link

Passwords and security answers are stored as salted hashes; sign-in sessions last seven days. A group invite code allows anyone who has it to join that group, so share it privately. The creator can manage members from the chat: kicking lets someone rejoin with the code, while banning blocks them from that group only. The creator can regenerate invite codes or delete the group and its chat history; members can leave a group. Message menus offer **Delete for me** or, for your own messages, **Delete for everyone**. The chat shows active members’ hamsters: yours enters from the right and other members enter from the left. Use one server instance with persistent storage.
