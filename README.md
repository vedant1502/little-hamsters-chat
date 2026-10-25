# Little Hamsters

A small group chat app with accounts, private groups, and live messages. Create a group and share its five-digit invite code with friends; each group has a separate conversation and only its members can read or send messages there.

## Run locally

Requires Node.js 20.13 or newer. No package installation is needed.

Run `npm run dev` while developing. It restarts the backend automatically when server code changes. HTML, CSS, and browser-side JavaScript changes are served from disk; refresh the browser to see those updates. Use `npm start` for a normal run. The landing page is for logging in; **Create an account** and **Forgot password?** open their own pages. Register with a username, 10-digit Indian mobile number, password, and a security question and answer. Usernames and mobile numbers must be unique. You can reset your password with your username or mobile number and the saved security question and answer. After logging in, choose one of six hamster looks on the groups page; your saved look appears in each group chat. Open **Create a group** and share its generated five-digit code. Friends register, then enter the code under **Join a group**. Each group has its own conversation and membership.

The server reads the port from `PORT` and stores accounts, sessions, and chat history in `data/app.json` by default. Set `APP_DATA_PATH` to use a different writable file path. Chat members also see a live typing indicator while another member is composing a message.

## Deploy

Deploy this folder as a Node.js web service, use `npm start` as the start command, and make sure the host provides Node.js 20.13 or newer. The server listens on the host-provided `PORT`; `/api/health` is available for health checks.

Attach persistent storage and set `APP_DATA_PATH` to a file on that disk so accounts and messages survive redeploys and restarts. For example, a host disk mounted at `/var/data` can use `/var/data/app.json`. The default project directory may be temporary on hosted platforms. This app writes to a single JSON file, so use one server instance; multiple instances or serverless hosting need a shared database instead.

## Before sharing the deployed link

Passwords and security answers are stored as salted hashes; sign-in sessions last seven days. A group invite code allows anyone who has it to join that group, so share it privately. The creator can manage members from the chat: kicking lets someone rejoin with the code, while banning blocks them from that group only. The creator can regenerate invite codes or delete the group and its chat history; members can leave a group. Message menus offer **Delete for me** or, for your own messages, **Delete for everyone**. The chat shows active members’ hamsters: yours enters from the right and other members enter from the left. Use one server instance with persistent storage.
