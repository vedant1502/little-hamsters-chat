const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_FILE = path.resolve(process.env.APP_DATA_PATH || path.join(ROOT, "data", "app.json"));
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: true, max: 2, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 }) : null;
const MAX_MESSAGES = 500;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 6;
const SECURITY_QUESTIONS = new Set(["first-pet", "birth-city", "first-school", "childhood-nickname", "childhood-friend"]);
const HAMSTER_DESIGNS = new Set(["classic", "honey", "cocoa", "mint", "lavender", "moonlight"]);
const scrypt = promisify(crypto.scrypt);
const clients = new Set();
let appStore = null;
let databaseWriteQueue = Promise.resolve();
const typingTimers = new Map();
const requestLimits = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/health" && req.method === "GET") {
      if (pool) await pool.query("SELECT 1");
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/api/register" && req.method === "POST") {
      return await handleRegister(req, res);
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      return await handleLogin(req, res);
    }

    if (url.pathname === "/api/reset-password" && req.method === "POST") {
      return await handlePasswordReset(req, res);
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      return await handleLogout(req, res);
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      const user = getAuthenticatedUser(req);
      return user ? sendJson(res, 200, { user: publicUser(user) }) : sendJson(res, 401, { error: "Please sign in." });
    }

    if (url.pathname === "/api/profile/hamster" && req.method === "POST") {
      return await handleUpdateHamster(req, res);
    }

    if (url.pathname === "/api/groups" && req.method === "GET") {
      const user = getAuthenticatedUser(req);
      if (!user) return sendJson(res, 401, { error: "Please sign in." });
      return sendJson(res, 200, { groups: readStore().groups.filter((group) => group.memberIds.includes(user.id)).map((group) => publicGroup(group, user.id)) });
    }

    if (url.pathname === "/api/groups" && req.method === "POST") {
      return await handleCreateGroup(req, res);
    }

    if (url.pathname === "/api/groups/join" && req.method === "POST") {
      return await handleJoinGroup(req, res);
    }

    const groupTypingRoute = url.pathname.match(/^\/api\/groups\/([0-9a-f-]+)\/typing$/i);
    if (groupTypingRoute && req.method === "POST") {
      return await handleTyping(req, res, groupTypingRoute[1]);
    }

    const groupUtilityRoute = url.pathname.match(/^\/api\/groups\/([0-9a-f-]+)\/(regenerate-code|leave)$/i);
    if (groupUtilityRoute && req.method === "POST") {
      const action = groupUtilityRoute[2].toLowerCase();
      return action === "leave"
        ? await handleLeaveGroup(req, res, groupUtilityRoute[1])
        : await handleRegenerateGroupCode(req, res, groupUtilityRoute[1]);
    }

    const groupMembersRoute = url.pathname.match(/^\/api\/groups\/([0-9a-f-]+)\/members$/i);
    if (groupMembersRoute && req.method === "GET") {
      return handleGroupMembers(req, res, groupMembersRoute[1]);
    }

    const messageDeleteRoute = url.pathname.match(/^\/api\/groups\/([0-9a-f-]+)\/messages\/([0-9a-f-]+)\/delete$/i);
    if (messageDeleteRoute && req.method === "POST") {
      return await handleDeleteMessage(req, res, messageDeleteRoute[1], messageDeleteRoute[2]);
    }

    const groupActionRoute = url.pathname.match(/^\/api\/groups\/([0-9a-f-]+)\/(kick|ban|unban)$/i);
    if (groupActionRoute && req.method === "POST") {
      return await handleGroupMemberAction(req, res, groupActionRoute[1], groupActionRoute[2].toLowerCase());
    }

    const groupDeleteRoute = url.pathname.match(/^\/api\/groups\/([0-9a-f-]+)$/i);
    if (groupDeleteRoute && req.method === "DELETE") {
      return await handleDeleteGroup(req, res, groupDeleteRoute[1]);
    }

    const groupMessagesRoute = url.pathname.match(/^\/api\/groups\/([0-9a-f-]+)\/messages$/i);
    if (groupMessagesRoute && req.method === "GET") {
      const user = getAuthenticatedUser(req);
      if (!user) return sendJson(res, 401, { error: "Please sign in." });
      const group = findMemberGroup(groupMessagesRoute[1], user.id);
      if (!group) return sendJson(res, 404, { error: "Group not found." });
      const store = readStore();
      const groupMessages = store.messages.filter((message) => message.groupId === group.id);
      const hiddenMessageIds = new Set(user.hiddenMessageIds || []);
      const messages = groupMessages.filter((message) => !hiddenMessageIds.has(message.id));
      const hiddenInGroup = groupMessages.filter((message) => hiddenMessageIds.has(message.id)).map((message) => message.id);
      return sendJson(res, 200, { group: publicGroup(group, user.id), messages, hiddenMessageIds: hiddenInGroup });
    }

    if (groupMessagesRoute && req.method === "POST") {
      return await handleMessage(req, res, groupMessagesRoute[1]);
    }

    if (url.pathname === "/api/messages" && req.method === "GET") {
      return sendJson(res, 404, { error: "Choose a group to view messages." });
    }

    if (url.pathname === "/api/messages" && req.method === "POST") {
      return await handleMessage(req, res);
    }

    if (url.pathname === "/api/events" && req.method === "GET") {
      const user = getAuthenticatedUser(req);
      if (!user) return sendJson(res, 401, { error: "Please sign in." });
      const groupId = url.searchParams.get("groupId") || "";
      if (!findMemberGroup(groupId, user.id)) return sendJson(res, 404, { error: "Group not found." });
      return handleEvents(req, res, hashToken(getSessionToken(req)), groupId, user);
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "API route not found." });
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error);
    if (!res.headersSent) {
      const message = statusCode === 400 ? "Invalid request body." : statusCode === 413 ? "Request body is too large." : "Server error.";
      return sendJson(res, statusCode, { error: message });
    }
    res.end();
  }
});

initializeStore()
  .then(() => server.listen(PORT, () => {
    console.log(`Little Hamsters is running at http://localhost:${PORT}`);
  }))
  .catch(async (error) => {
    console.error("Could not initialize app storage:", error);
    if (pool) await pool.end();
    process.exitCode = 1;
  });

async function handleRegister(req, res) {
  const body = await readBody(req);
  const username = cleanUsername(body.username);
  const phone = normalizePhone(body.phone);
  const password = String(body.password || "");
  const securityQuestion = cleanSecurityQuestion(body.securityQuestion);
  const securityAnswer = normalizeSecurityAnswer(body.securityAnswer);

  if (!username) return sendJson(res, 400, { error: "Use a name with 2–24 letters, numbers, spaces, dots, underscores, or hyphens." });
  if (!phone) return sendJson(res, 400, { error: "Enter a valid 10-digit Indian mobile number." });
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) {
    return sendJson(res, 400, { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }
  if (!securityQuestion || securityAnswer.length < 2 || securityAnswer.length > 100) {
    return sendJson(res, 400, { error: "Choose a security question and enter an answer between 2 and 100 characters." });
  }
  const key = username.toLocaleLowerCase("en-US");
  if (!allowRequest(req, "register", 8, `${key}:${phone}`)) return sendJson(res, 429, { error: "Too many registration attempts. Please try again later." });
  if (readStore().users.some((user) => user.username.toLocaleLowerCase("en-US") === key || user.phone === phone)) {
    return sendJson(res, 409, { error: "That username or mobile number is already registered." });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const securityAnswerSalt = crypto.randomBytes(16).toString("hex");
  const [passwordHash, securityAnswerHash] = await Promise.all([
    scrypt(password, salt, 64),
    scrypt(securityAnswer, securityAnswerSalt, 64)
  ]);
  const user = {
    id: crypto.randomUUID(),
    username,
    phone,
    salt,
    passwordHash: passwordHash.toString("hex"),
    securityQuestion,
    securityAnswerSalt,
    securityAnswerHash: securityAnswerHash.toString("hex"),
    hamsterDesign: "classic",
    hiddenMessageIds: [],
    createdAt: new Date().toISOString()
  };
  const latestStore = readStore();
  if (latestStore.users.some((item) => item.username.toLocaleLowerCase("en-US") === key || item.phone === phone)) {
    return sendJson(res, 409, { error: "That username or mobile number is already registered." });
  }
  latestStore.users.push(user);
  const token = createSession(latestStore, user.id);
  await writeStore(latestStore);
  setSessionCookie(res, token, req);
  return sendJson(res, 201, { user: publicUser(user) });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const identifier = String(body.identifier || body.username || "").trim();
  if (!allowRequest(req, "login", 12, normalizePhone(identifier) || cleanUsername(identifier).toLocaleLowerCase("en-US"))) {
    return sendJson(res, 429, { error: "Too many sign-in attempts. Please try again later." });
  }
  const password = String(body.password || "");
  const store = readStore();
  const user = findUserByIdentifier(store, identifier);

  if (!user || password.length > 128) return sendJson(res, 401, { error: "Name or password is incorrect." });

  const candidate = await scrypt(password, user.salt, 64);
  const expected = Buffer.from(user.passwordHash, "hex");
  if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
    return sendJson(res, 401, { error: "Name or password is incorrect." });
  }

  const latestStore = readStore();
  const token = createSession(latestStore, user.id);
  await writeStore(latestStore);
  setSessionCookie(res, token, req);
  return sendJson(res, 200, { user: publicUser(user) });
}

async function handlePasswordReset(req, res) {
  const body = await readBody(req);
  const identifier = String(body.identifier || "").trim();
  if (!allowRequest(req, "password-reset", 6, normalizePhone(identifier) || cleanUsername(identifier).toLocaleLowerCase("en-US"))) {
    return sendJson(res, 429, { error: "Too many reset attempts. Please try again later." });
  }
  const securityQuestion = cleanSecurityQuestion(body.securityQuestion);
  const securityAnswer = normalizeSecurityAnswer(body.securityAnswer);
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > 128) {
    return sendJson(res, 400, { error: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
  }

  const store = readStore();
  const user = findUserByIdentifier(store, identifier);
  if (!user || !user.securityQuestion || !user.securityAnswerSalt || !user.securityAnswerHash || user.securityQuestion !== securityQuestion) {
    await scrypt(securityAnswer, "little-hamsters-reset-check", 64);
    return sendJson(res, 400, { error: "Those account details did not match." });
  }

  const answerHash = await scrypt(securityAnswer, user.securityAnswerSalt, 64);
  const expected = Buffer.from(user.securityAnswerHash, "hex");
  if (answerHash.length !== expected.length || !crypto.timingSafeEqual(answerHash, expected)) {
    return sendJson(res, 400, { error: "Those account details did not match." });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await scrypt(newPassword, salt, 64);
  user.salt = salt;
  user.passwordHash = passwordHash.toString("hex");
  for (const [sessionKey, session] of Object.entries(store.sessions)) {
    if (session.userId === user.id) delete store.sessions[sessionKey];
  }
  await writeStore(store);
  for (const client of clients) {
    if (client.userId === user.id) {
      clients.delete(client);
      client.res.end();
    }
  }
  return sendJson(res, 200, { ok: true, message: "Password reset. Sign in with your new password." });
}

async function handleUpdateHamster(req, res) {
  const authenticatedUser = getAuthenticatedUser(req);
  if (!authenticatedUser) return sendJson(res, 401, { error: "Please sign in." });
  const body = await readBody(req);
  const hamsterDesign = cleanHamsterDesign(body.hamsterDesign);
  if (!hamsterDesign) return sendJson(res, 400, { error: "Choose one of the available hamster designs." });
  const store = readStore();
  const user = store.users.find((item) => item.id === authenticatedUser.id);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  user.hamsterDesign = hamsterDesign;
  await writeStore(store);
  const activeGroups = new Set();
  for (const client of clients) {
    if (client.userId !== user.id) continue;
    client.hamsterDesign = hamsterDesign;
    activeGroups.add(client.groupId);
  }
  for (const groupId of activeGroups) broadcast("hamster-updated", publicUser(user), groupId);
  return sendJson(res, 200, { user: publicUser(user) });
}

async function handleCreateGroup(req, res) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const body = await readBody(req);
  const name = cleanGroupName(body.name);
  if (!name) return sendJson(res, 400, { error: "Group name must be 2–40 characters." });

  const invite = generateGroupInvite(readStore());
  if (!invite) return sendJson(res, 503, { error: "Could not create a unique group code. Please try again." });
  const group = {
    id: crypto.randomUUID(),
    name,
    inviteCodeHash: invite.hash,
    createdBy: user.id,
    createdAt: new Date().toISOString(),
    memberIds: [user.id],
    bannedUserIds: []
  };
  const store = readStore();
  store.groups.push(group);
  await writeStore(store);
  return sendJson(res, 201, { group: publicGroup(group, user.id), inviteCode: invite.code });
}

function generateGroupInvite(store) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const code = String(crypto.randomInt(10000, 100000));
    const hash = hashToken(code);
    if (!store.groups.some((item) => item.inviteCodeHash === hash)) return { code, hash };
  }
  return null;
}

async function handleJoinGroup(req, res) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  if (!allowRequest(req, "join-group", 10, user.id)) return sendJson(res, 429, { error: "Too many code attempts. Please try again later." });
  const body = await readBody(req);
  const inviteCode = String(body.inviteCode || "").trim();
  if (!/^\d{5}$/.test(inviteCode)) return sendJson(res, 400, { error: "Enter the five-digit group code." });

  const inviteHash = hashToken(inviteCode);
  const store = readStore();
  const group = store.groups.find((item) => constantTimeTextEqual(item.inviteCodeHash, inviteHash));
  if (!group) return sendJson(res, 404, { error: "That group invite code was not found." });
  group.bannedUserIds ||= [];
  if (group.bannedUserIds.includes(user.id)) return sendJson(res, 403, { error: "You are banned from this group." });
  if (!group.memberIds.includes(user.id)) {
    group.memberIds.push(user.id);
    await writeStore(store);
  }
  return sendJson(res, 200, { group: publicGroup(group, user.id) });
}

function handleGroupMembers(req, res, groupId) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const store = readStore();
  const group = store.groups.find((item) => item.id === groupId && item.memberIds.includes(user.id));
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  if (group.createdBy !== user.id) return sendJson(res, 403, { error: "Only the group creator can manage members." });
  group.bannedUserIds ||= [];
  const memberIds = new Set(group.memberIds);
  const userById = new Map(store.users.map((member) => [member.id, member]));
  const summarize = (id) => {
    const member = userById.get(id);
    return member ? { id: member.id, username: member.username, isCreator: member.id === group.createdBy } : null;
  };
  return sendJson(res, 200, {
    members: [...memberIds].map(summarize).filter(Boolean),
    banned: group.bannedUserIds.map(summarize).filter(Boolean)
  });
}

async function handleGroupMemberAction(req, res, groupId, action) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const body = await readBody(req);
  const store = readStore();
  const group = store.groups.find((item) => item.id === groupId);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  if (group.createdBy !== user.id) return sendJson(res, 403, { error: "Only the group creator can manage members." });
  group.bannedUserIds ||= [];

  const targetUserId = String(body.userId || "");
  if (action === "unban") {
    if (!group.bannedUserIds.includes(targetUserId)) return sendJson(res, 404, { error: "Banned member not found." });
    group.bannedUserIds = group.bannedUserIds.filter((id) => id !== targetUserId);
    await writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (targetUserId === group.createdBy || !group.memberIds.includes(targetUserId)) {
    return sendJson(res, 404, { error: "Group member not found." });
  }
  group.memberIds = group.memberIds.filter((id) => id !== targetUserId);
  if (action === "ban" && !group.bannedUserIds.includes(targetUserId)) group.bannedUserIds.push(targetUserId);
  await writeStore(store);
  closeGroupConnections(groupId, targetUserId, action);
  return sendJson(res, 200, { ok: true });
}

async function handleDeleteGroup(req, res, groupId) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const store = readStore();
  const group = store.groups.find((item) => item.id === groupId);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  if (group.createdBy !== user.id) return sendJson(res, 403, { error: "Only the group creator can delete this group." });
  const deletedMessageIds = new Set(store.messages.filter((message) => message.groupId === groupId).map((message) => message.id));
  store.groups = store.groups.filter((item) => item.id !== groupId);
  store.messages = store.messages.filter((message) => message.groupId !== groupId);
  for (const member of store.users) member.hiddenMessageIds = (member.hiddenMessageIds || []).filter((id) => !deletedMessageIds.has(id));
  await writeStore(store);
  closeGroupConnections(groupId, null, "group-deleted");
  return sendJson(res, 200, { ok: true });
}

async function handleRegenerateGroupCode(req, res, groupId) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const store = readStore();
  const group = store.groups.find((item) => item.id === groupId);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  if (group.createdBy !== user.id) return sendJson(res, 403, { error: "Only the group creator can change the invite code." });
  const invite = generateGroupInvite(store);
  if (!invite) return sendJson(res, 503, { error: "Could not create a unique group code. Please try again." });
  group.inviteCodeHash = invite.hash;
  await writeStore(store);
  return sendJson(res, 200, { inviteCode: invite.code });
}

async function handleLeaveGroup(req, res, groupId) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const store = readStore();
  const group = store.groups.find((item) => item.id === groupId);
  if (!group || !group.memberIds.includes(user.id)) return sendJson(res, 404, { error: "Group not found." });
  if (group.createdBy === user.id) return sendJson(res, 400, { error: "The creator cannot leave. Delete the group if it should close." });
  group.memberIds = group.memberIds.filter((id) => id !== user.id);
  await writeStore(store);
  closeGroupConnections(groupId, user.id, "left");
  return sendJson(res, 200, { ok: true });
}

async function handleDeleteMessage(req, res, groupId, messageId) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const group = findMemberGroup(groupId, user.id);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  const body = await readBody(req);
  const action = String(body.action || "");
  const store = readStore();
  const message = store.messages.find((item) => item.id === messageId && item.groupId === groupId);
  if (!message) return sendJson(res, 404, { error: "Message not found." });

  if (action === "me") {
    const member = store.users.find((item) => item.id === user.id);
    if (!member) return sendJson(res, 401, { error: "Please sign in." });
    member.hiddenMessageIds ||= [];
    if (!member.hiddenMessageIds.includes(messageId)) member.hiddenMessageIds.push(messageId);
    await writeStore(store);
    broadcastToUser("message-hidden", { messageId }, groupId, user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (action !== "everyone") return sendJson(res, 400, { error: "Choose whether to delete the message for you or everyone." });
  if (message.userId !== user.id) return sendJson(res, 403, { error: "You can only delete your own message for everyone." });
  store.messages = store.messages.filter((item) => item.id !== messageId);
  for (const member of store.users) member.hiddenMessageIds = (member.hiddenMessageIds || []).filter((id) => id !== messageId);
  await writeStore(store);
  broadcast("message-deleted", { messageId }, groupId);
  return sendJson(res, 200, { ok: true });
}

function closeGroupConnections(groupId, userId, reason) {
  for (const client of clients) {
    if (client.groupId !== groupId || (userId && client.userId !== userId)) continue;
    client.res.write(`event: access-revoked\ndata: ${JSON.stringify({ reason })}\n\n`);
    clients.delete(client);
    client.res.end();
  }
}

async function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (token) {
    const store = readStore();
    const sessionKey = hashToken(token);
    delete store.sessions[sessionKey];
    await writeStore(store);
    for (const client of clients) {
      if (client.sessionKey === sessionKey) {
        clients.delete(client);
        client.res.end();
      }
    }
  }
  res.setHeader("Set-Cookie", sessionCookie("", 0, req));
  return sendJson(res, 200, { ok: true });
}

async function handleMessage(req, res, groupId) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });

  const group = findMemberGroup(groupId, user.id);
  if (!group) return sendJson(res, 404, { error: "Group not found." });

  const body = await readBody(req);
  const text = cleanMessage(body.text);
  if (!text) return sendJson(res, 400, { error: "Message cannot be empty." });

  stopTyping(group.id, user.id);

  const store = readStore();
  const message = {
    id: crypto.randomUUID(),
    groupId: group.id,
    userId: user.id,
    username: user.username,
    text,
    createdAt: new Date().toISOString()
  };
  store.messages.push(message);
  const groupMessages = store.messages.filter((item) => item.groupId === group.id).slice(-MAX_MESSAGES);
  store.messages = store.messages.filter((item) => item.groupId !== group.id).concat(groupMessages);
  await writeStore(store);
  broadcast("message", message, group.id);
  return sendJson(res, 201, { message });
}

async function handleTyping(req, res, groupId) {
  const user = getAuthenticatedUser(req);
  if (!user) return sendJson(res, 401, { error: "Please sign in." });
  const group = findMemberGroup(groupId, user.id);
  if (!group) return sendJson(res, 404, { error: "Group not found." });
  const body = await readBody(req);
  if (typeof body.typing !== "boolean") return sendJson(res, 400, { error: "Typing state is required." });

  if (body.typing) startTyping(group.id, user);
  else stopTyping(group.id, user.id);
  return sendJson(res, 200, { ok: true });
}

function startTyping(groupId, user) {
  const key = `${groupId}:${user.id}`;
  const previousTimer = typingTimers.get(key);
  if (previousTimer) clearTimeout(previousTimer);
  broadcast("typing", { userId: user.id, username: user.username }, groupId);
  const timer = setTimeout(() => {
    if (typingTimers.get(key) !== timer) return;
    typingTimers.delete(key);
    broadcast("typing-stopped", { userId: user.id }, groupId);
  }, 5000);
  typingTimers.set(key, timer);
}

function stopTyping(groupId, userId) {
  const key = `${groupId}:${userId}`;
  const timer = typingTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  typingTimers.delete(key);
  broadcast("typing-stopped", { userId }, groupId);
}

function handleEvents(req, res, sessionKey, groupId, user) {
  const onlineMembers = new Map();
  for (const client of clients) {
    if (client.groupId === groupId && client.userId !== user.id) {
      onlineMembers.set(client.userId, { id: client.userId, username: client.username, hamsterDesign: client.hamsterDesign });
    }
  }
  const alreadyOnline = [...clients].some((client) => client.groupId === groupId && client.userId === user.id);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("event: ready\ndata: {\"ok\":true}\n\n");
  res.write(`event: presence\ndata: ${JSON.stringify({ members: [...onlineMembers.values()] })}\n\n`);
  const client = { res, sessionKey, groupId, userId: user.id, username: user.username, hamsterDesign: cleanHamsterDesign(user.hamsterDesign) || "classic" };
  clients.add(client);
  if (!alreadyOnline) broadcast("member-entered", publicUser(user), groupId);
  const heartbeat = setInterval(() => {
    const session = readStore().sessions[sessionKey];
    if (!session || session.expiresAt <= Date.now()) {
      res.write("event: auth-expired\ndata: {}\n\n");
      clearInterval(heartbeat);
      clients.delete(client);
      res.end();
    } else if (!res.writableEnded) {
      res.write(": keep-alive\n\n");
    }
  }, 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
    const stillOnline = [...clients].some((item) => item.groupId === groupId && item.userId === user.id);
    if (!stillOnline) {
      stopTyping(groupId, user.id);
      broadcast("member-left", { userId: user.id }, groupId);
    }
  });
}

function serveStatic(pathname, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, "Bad request");
  }

  const routeAliases = {
    "/": "index.html",
    "/register": "register.html",
    "/forgot-password": "forgot-password.html"
  };
  const relativePath = routeAliases[decodedPath] || decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  if (!isAllowedStaticFile(filePath)) return sendText(res, 404, "Not found");

  fs.readFile(filePath, (error, data) => {
    if (error) return sendText(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Server error");
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    res.end(data);
  });
}

function isAllowedStaticFile(filePath) {
  const relative = path.relative(ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return relative === "index.html" || relative === "register.html" || relative === "forgot-password.html" || relative === "groups.html" || relative === "chat.html" || relative.startsWith(`styles${path.sep}`) || relative.startsWith(`scripts${path.sep}`) || relative.startsWith(`hamsters${path.sep}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 10000) {
        tooLarge = true;
        body = "";
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        return;
      }
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error("Invalid request body."), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

async function initializeStore() {
  if (!pool && process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production so chat data is stored durably.");
  }
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.little_hamsters_state (
        id smallint PRIMARY KEY CHECK (id = 1),
        state jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query("ALTER TABLE public.little_hamsters_state ENABLE ROW LEVEL SECURITY");
    await pool.query("REVOKE ALL ON TABLE public.little_hamsters_state FROM PUBLIC, anon, authenticated, service_role");
    await pool.query(
      "INSERT INTO public.little_hamsters_state (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING",
      [JSON.stringify(emptyStore())]
    );
    const result = await pool.query("SELECT state FROM public.little_hamsters_state WHERE id = 1");
    appStore = normalizeStore(result.rows[0].state);
    return;
  }

  ensureStore();
  appStore = normalizeStore(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
}

function readStore() {
  if (!appStore) throw new Error("App storage has not been initialized.");
  return appStore;
}

function normalizeStore(store) {
  store.users ||= [];
  for (const user of store.users) {
    user.hiddenMessageIds ||= [];
    user.hamsterDesign = cleanHamsterDesign(user.hamsterDesign) || "classic";
  }
  store.sessions ||= {};
  store.messages ||= [];
  store.groups ||= [];
  for (const group of store.groups) group.bannedUserIds ||= [];
  return store;
}

async function writeStore(store) {
  appStore = normalizeStore(store);
  if (pool) {
    const snapshot = JSON.stringify(appStore);
    databaseWriteQueue = databaseWriteQueue.catch(() => {}).then(() => pool.query(
      "UPDATE public.little_hamsters_state SET state = $1::jsonb, updated_at = now() WHERE id = 1",
      [snapshot]
    ));
    await databaseWriteQueue;
    return;
  }

  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(appStore, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempFile, DATA_FILE);
}

function emptyStore() {
  return { users: [], sessions: {}, messages: [], groups: [] };
}

function ensureStore() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (fs.existsSync(DATA_FILE)) return;
  fs.writeFileSync(DATA_FILE, `${JSON.stringify({ users: [], sessions: {}, messages: [] }, null, 2)}\n`, { mode: 0o600 });
}

function createSession(store, userId) {
  const now = Date.now();
  for (const [key, session] of Object.entries(store.sessions)) {
    if (session.expiresAt <= now) delete store.sessions[key];
  }
  const token = crypto.randomBytes(32).toString("base64url");
  store.sessions[hashToken(token)] = { userId, expiresAt: now + SESSION_TTL_MS };
  return token;
}

function getAuthenticatedUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const store = readStore();
  const session = store.sessions[hashToken(token)];
  if (!session || session.expiresAt <= Date.now()) return null;
  return store.users.find((user) => user.id === session.userId) || null;
}

function getSessionToken(req) {
  const cookies = String(req.headers.cookie || "").split(";");
  const cookie = cookies.map((part) => part.trim()).find((part) => part.startsWith("little_hamsters_session="));
  if (!cookie) return "";
  try { return decodeURIComponent(cookie.slice("little_hamsters_session=".length)); }
  catch { return ""; }
}

function setSessionCookie(res, token, req) {
  res.setHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000, req));
}

function sessionCookie(value, maxAge, req) {
  const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `little_hamsters_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function constantTimeTextEqual(left, right) {
  const a = crypto.createHash("sha256").update(left).digest();
  const b = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

function publicUser(user) {
  return { id: user.id, username: user.username, hamsterDesign: cleanHamsterDesign(user.hamsterDesign) || "classic" };
}

function cleanHamsterDesign(value) {
  const design = String(value || "");
  return HAMSTER_DESIGNS.has(design) ? design : "";
}

function findUserByIdentifier(store, identifier) {
  const phone = normalizePhone(identifier);
  if (phone) return store.users.find((user) => user.phone === phone) || null;
  const username = cleanUsername(identifier);
  if (!username) return null;
  const key = username.toLocaleLowerCase("en-US");
  return store.users.find((user) => user.username.toLocaleLowerCase("en-US") === key) || null;
}

function publicGroup(group, viewerId = "") {
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
    memberCount: group.memberIds.length,
    isOwner: group.createdBy === viewerId
  };
}

function findMemberGroup(groupId, userId) {
  return readStore().groups.find((group) => group.id === groupId && group.memberIds.includes(userId)) || null;
}

function cleanUsername(value) {
  const username = String(value || "").trim().replace(/\s+/g, " ");
  if (username.length < 2 || username.length > 24 || !/^[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u.test(username)) return "";
  return username;
}

function normalizePhone(value) {
  const phone = String(value || "").trim().replace(/[\s().-]/g, "");
  const localNumber = /^([6-9]\d{9})$/.exec(phone)?.[1];
  if (localNumber) return `+91${localNumber}`;
  const withCountryCode = /^\+91([6-9]\d{9})$/.exec(phone)?.[1];
  return withCountryCode ? `+91${withCountryCode}` : "";
}

function cleanSecurityQuestion(value) {
  const question = String(value || "");
  return SECURITY_QUESTIONS.has(question) ? question : "";
}

function normalizeSecurityAnswer(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 100);
}

function allowRequest(req, action, limit, subject = "") {
  const now = Date.now();
  const address = req.socket.remoteAddress || "unknown";
  const key = `${action}:${subject ? hashToken(subject) : address}`;
  let record = requestLimits.get(key);
  if (!record || record.expiresAt <= now) {
    record = { count: 0, expiresAt: now + RATE_WINDOW_MS };
    requestLimits.set(key, record);
  }
  record.count += 1;
  if (requestLimits.size > 5000) {
    for (const [entryKey, entry] of requestLimits) {
      if (entry.expiresAt <= now) requestLimits.delete(entryKey);
    }
  }
  return record.count <= limit;
}

function cleanMessage(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 1000);
}

function cleanGroupName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 40 ? name : "";
}

function broadcast(eventName, data, groupId) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.groupId !== groupId) continue;
    if (client.res.writableEnded || client.res.destroyed) {
      clients.delete(client);
      continue;
    }
    client.res.write(payload);
  }
}

function broadcastToUser(eventName, data, groupId, userId) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.groupId !== groupId || client.userId !== userId) continue;
    if (client.res.writableEnded || client.res.destroyed) {
      clients.delete(client);
      continue;
    }
    client.res.write(payload);
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

