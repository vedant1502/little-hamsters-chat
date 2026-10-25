const hamsterStage = document.getElementById("hamsterStage");
const hamsterCrowd = document.getElementById("hamsterCrowd");
    const messageForm = document.getElementById("messageForm");
    const messageInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendBtn");
    const messages = document.getElementById("messages");
    const connectionStatus = document.getElementById("connectionStatus");
    const logoutBtn = document.getElementById("logoutBtn");
    const groupTitle = document.getElementById("groupTitle");
const manageGroupBtn = document.getElementById("manageGroupBtn");
const leaveGroupBtn = document.getElementById("leaveGroupBtn");
const manageDialog = document.getElementById("manageDialog");
const manageMembers = document.getElementById("manageMembers");
const manageBanned = document.getElementById("manageBanned");
const manageStatus = document.getElementById("manageStatus");
    const groupId = new URLSearchParams(window.location.search).get("group");
    const seenMessages = new Set();
const hiddenMessageIds = new Set();
const deletedMessageIds = new Set();
const messageElements = new Map();
    const hamsterElements = new Map();
    const typingMembers = new Map();
    const typingTimeouts = new Map();
    let currentUser = null;
    let typingActive = false;
    let typingHeartbeat = null;
    let typingIdleTimeout = null;

    startChat();
    window.addEventListener("resize", updateCrowdLayout);

    async function startChat() {
      if (!groupId) return window.location.assign("groups.html");
      try {
        const response = await fetch("/api/me");
        if (!response.ok) {
          window.location.href = "index.html";
          return;
        }
        const data = await response.json();
        currentUser = data.user;
        await loadMessages();
        connectToEvents();
        messageInput.focus();
      } catch (error) {
        connectionStatus.textContent = "Could not connect to the chat server";
      }
    }

    async function loadMessages() {
      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages`);
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 404) return window.location.assign("groups.html");
          throw new Error(data.error || "Could not load messages.");
        }

        groupTitle.textContent = data.group.name;
        manageGroupBtn.hidden = !data.group.isOwner;
        leaveGroupBtn.hidden = data.group.isOwner;
        connectionStatus.textContent = `Signed in as ${currentUser.username}`;
        (data.hiddenMessageIds || []).forEach((messageId) => {
          hiddenMessageIds.add(messageId);
          removeMessage(messageId);
        });
        data.messages.forEach(renderMessage);
      } catch (error) {
        connectionStatus.textContent = "Backend unavailable";
      }
    }

    function connectToEvents() {
      const events = new EventSource(`/api/events?groupId=${encodeURIComponent(groupId)}`);

      events.addEventListener("ready", () => {
        connectionStatus.textContent = `Signed in as ${currentUser.username}`;
        showHamster(currentUser);
        loadMessages();
      });

      events.addEventListener("presence", (event) => {
        const data = JSON.parse(event.data);
        for (const [userId, element] of hamsterElements) {
          if (userId !== currentUser.id) {
            element.remove();
            hamsterElements.delete(userId);
          }
        }
        updateCrowdLayout();
        showHamster(currentUser);
        data.members.forEach(showHamster);
      });

      events.addEventListener("member-entered", (event) => showHamster(JSON.parse(event.data)));
      events.addEventListener("hamster-updated", (event) => updateHamster(JSON.parse(event.data)));
      events.addEventListener("typing", (event) => showTyping(JSON.parse(event.data)));
      events.addEventListener("typing-stopped", (event) => removeTyping(JSON.parse(event.data).userId));

      events.addEventListener("member-left", (event) => {
        const { userId } = JSON.parse(event.data);
        removeTyping(userId);
        if (userId !== currentUser.id) {
          hamsterElements.get(userId)?.remove();
          hamsterElements.delete(userId);
          updateCrowdLayout();
        }
      });

      events.addEventListener("message", (event) => {
        renderMessage(JSON.parse(event.data));
      });

      events.addEventListener("message-hidden", (event) => {
        const { messageId } = JSON.parse(event.data);
        hiddenMessageIds.add(messageId);
        removeMessage(messageId);
      });

      events.addEventListener("message-deleted", (event) => {
        const { messageId } = JSON.parse(event.data);
        deletedMessageIds.add(messageId);
        hiddenMessageIds.delete(messageId);
        removeMessage(messageId);
      });

      events.addEventListener("auth-expired", () => {
        events.close();
        window.location.href = "index.html";
      });

      events.addEventListener("access-revoked", (event) => {
        events.close();
        const { reason } = JSON.parse(event.data);
        window.location.href = `groups.html?notice=${encodeURIComponent(reason)}`;
      });

      events.addEventListener("error", () => {
        connectionStatus.textContent = "Reconnecting...";
      });
    }

    function showHamster(user) {
      if (!user || hamsterElements.has(user.id)) return;
      const mine = user.id === currentUser.id;
      const pet = document.createElement("div");
      pet.className = `hamster-person ${mine ? "mine" : "other"} entering`;
      pet.dataset.userId = user.id;

      const image = document.createElement("img");
      image.src = "hamsters/Picsart_25-12-10_11-11-08-730.png";
      image.dataset.design = user.hamsterDesign || "classic";
      image.alt = `${user.username}'s hamster`;

      const name = document.createElement("span");
      name.className = "hamster-name";
      name.textContent = mine ? `${user.username} · you` : user.username;

      pet.append(image, name);
      if (mine) hamsterStage.append(pet);
      else hamsterCrowd.append(pet);
      hamsterElements.set(user.id, pet);
      if (!mine) updateCrowdLayout();
      if (typingMembers.has(user.id)) setHamsterTyping(user.id, true);
      pet.addEventListener("animationend", () => pet.classList.remove("entering"), { once: true });
    }

    function updateCrowdLayout() {
      if (!hamsterCrowd) return;
      const hamsters = [...hamsterCrowd.querySelectorAll(".hamster-person")];
      const compact = window.matchMedia("(max-width: 680px)").matches;
      const hamsterWidth = compact ? 68 : 88;
      const maxCrowdWidth = Math.min(window.innerWidth * 0.47, 640);
      const maxStep = compact ? 43 : 58;
      const step = hamsters.length < 2
        ? maxStep
        : Math.max(5, Math.min(maxStep, (maxCrowdWidth - hamsterWidth) / (hamsters.length - 1)));

      hamsters.forEach((pet, index) => {
        pet.style.left = `${index * step}px`;
        pet.style.bottom = `${Math.min(index, 5) * (compact ? 6 : 8)}px`;
        pet.style.setProperty("--entry-offset", `${-(index * step + 170)}px`);
        pet.style.zIndex = String(index + 1);
      });
    }

    function updateHamster(user) {
      if (!user || !user.id) return;
      if (user.id === currentUser.id) currentUser.hamsterDesign = user.hamsterDesign || "classic";
      let pet = hamsterElements.get(user.id);
      if (!pet) {
        showHamster(user);
        pet = hamsterElements.get(user.id);
      }
      const image = pet?.querySelector("img");
      if (image) image.dataset.design = user.hamsterDesign || "classic";
    }

    function showTyping(user) {
      if (!user?.userId || user.userId === currentUser.id) return;
      typingMembers.set(user.userId, user.username);
      clearTimeout(typingTimeouts.get(user.userId));
      typingTimeouts.set(user.userId, setTimeout(() => removeTyping(user.userId), 6500));
      setHamsterTyping(user.userId, true);
    }

    function removeTyping(userId) {
      if (!userId) return;
      clearTimeout(typingTimeouts.get(userId));
      typingTimeouts.delete(userId);
      typingMembers.delete(userId);
      setHamsterTyping(userId, false);
    }

    function setHamsterTyping(userId, isTyping) {
      const pet = hamsterElements.get(userId);
      if (!pet) return;
      const existingBubble = pet.querySelector(".hamster-typing");
      if (!isTyping) {
        existingBubble?.remove();
        pet.classList.remove("typing");
        return;
      }
      if (existingBubble) {
        existingBubble.setAttribute("aria-label", `${typingMembers.get(userId) || "A member"} is typing`);
        return;
      }

      const bubble = document.createElement("span");
      bubble.className = "hamster-typing";
      bubble.setAttribute("role", "status");
      bubble.setAttribute("aria-label", `${typingMembers.get(userId) || "A member"} is typing`);
      for (let index = 0; index < 3; index += 1) {
        const dot = document.createElement("i");
        dot.setAttribute("aria-hidden", "true");
        bubble.append(dot);
      }
      pet.append(bubble);
      pet.classList.add("typing");
    }

    function publishTyping(typing) {
      fetch(`/api/groups/${encodeURIComponent(groupId)}/typing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typing })
      }).catch(() => {});
    }

    function stopTyping() {
      clearTimeout(typingIdleTimeout);
      typingIdleTimeout = null;
      if (!typingActive) return;
      typingActive = false;
      clearInterval(typingHeartbeat);
      typingHeartbeat = null;
      publishTyping(false);
    }

    messageInput.addEventListener("input", () => {
      if (!messageInput.value.trim()) {
        stopTyping();
        return;
      }
      if (!typingActive) {
        typingActive = true;
        publishTyping(true);
        typingHeartbeat = setInterval(() => publishTyping(true), 2000);
      }
      clearTimeout(typingIdleTimeout);
      typingIdleTimeout = setTimeout(stopTyping, 1400);
    });
    messageInput.addEventListener("blur", stopTyping);

    function renderMessage(message) {
      if (!message || seenMessages.has(message.id) || hiddenMessageIds.has(message.id) || deletedMessageIds.has(message.id)) return;
      seenMessages.add(message.id);

      const bubble = document.createElement("article");
      bubble.dataset.messageId = message.id;
      const isMine = message.userId === currentUser.id;
      bubble.className = `message ${isMine ? "mine" : "other"} ${message.kind === "system" ? "system" : ""}`;

      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.textContent = `${message.username} - ${formatTime(message.createdAt)}`;

      const text = document.createElement("p");
      text.textContent = message.text;

      const actions = document.createElement("details");
      actions.className = "message-actions";
      const trigger = document.createElement("summary");
      trigger.textContent = "···";
      trigger.setAttribute("aria-label", "Message options");
      const menu = document.createElement("div");
      menu.className = "message-actions-menu";
      menu.append(makeDeleteAction("Delete for me", async () => {
        actions.open = false;
        await deleteMessage(message.id, "me");
      }));
      if (isMine) {
        menu.append(makeDeleteAction("Delete for everyone", async () => {
          actions.open = false;
          if (!window.confirm("Delete this message for everyone in the group? This cannot be undone.")) return;
          await deleteMessage(message.id, "everyone");
        }));
      }
      actions.append(trigger, menu);
      bubble.append(meta, text, actions);
      messages.appendChild(bubble);
      messageElements.set(message.id, bubble);
      messages.scrollTop = messages.scrollHeight;
    }

    function makeDeleteAction(label, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    }

    function removeMessage(messageId) {
      messageElements.get(messageId)?.remove();
      messageElements.delete(messageId);
    }

    async function deleteMessage(messageId, action) {
      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages/${encodeURIComponent(messageId)}/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not delete this message.");
        if (action === "me") {
          hiddenMessageIds.add(messageId);
          removeMessage(messageId);
        } else {
          deletedMessageIds.add(messageId);
          removeMessage(messageId);
        }
      } catch (error) {
        connectionStatus.textContent = error.message;
      }
    }

    function formatTime(value) {
      return new Intl.DateTimeFormat([], {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    }

    messageForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      stopTyping();

      const text = messageInput.value.trim();
      if (!text) return;

      sendBtn.disabled = true;

      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Message failed.");
        }

        renderMessage(data.message);
        messageInput.value = "";
      } catch (error) {
        connectionStatus.textContent = error.message || "Message not sent";
      } finally {
        sendBtn.disabled = false;
        messageInput.focus();
      }
    });

    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try {
        await fetch("/api/logout", { method: "POST" });
      } finally {
        window.location.href = "index.html";
      }
    });

    manageGroupBtn.addEventListener("click", async () => {
      manageStatus.textContent = "";
      manageDialog.showModal();
      await loadGroupMembers();
    });

    document.getElementById("closeManageBtn").addEventListener("click", () => manageDialog.close());

    async function loadGroupMembers() {
      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/members`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load group members.");
        renderMemberList(data.members, manageMembers, false);
        renderMemberList(data.banned, manageBanned, true);
        document.getElementById("bannedSection").hidden = data.banned.length === 0;
      } catch (error) {
        manageStatus.textContent = error.message;
      }
    }

    function renderMemberList(people, container, isBanned) {
      container.replaceChildren();
      if (people.length === 0) {
        const empty = document.createElement("p");
        empty.className = "manage-empty";
        empty.textContent = isBanned ? "No one is banned from this group." : "No members yet.";
        container.append(empty);
        return;
      }

      for (const person of people) {
        const row = document.createElement("div");
        row.className = "manage-member-row";
        const identity = document.createElement("div");
        identity.className = "manage-member-identity";
        const name = document.createElement("strong");
        name.textContent = person.username;
        const role = document.createElement("span");
        role.textContent = person.isCreator ? "Group creator" : (isBanned ? "Banned from this group" : "Member");
        identity.append(name, role);
        row.append(identity);

        if (isBanned) {
          row.append(makeMemberAction("Unban", "member-action", () => updateMember("unban", person)));
        } else if (!person.isCreator) {
          const actions = document.createElement("div");
          actions.className = "member-actions";
          actions.append(
            makeMemberAction("Kick", "member-action kick-action", () => updateMember("kick", person)),
            makeMemberAction("Ban", "member-action ban-action", () => updateMember("ban", person))
          );
          row.append(actions);
        }
        container.append(row);
      }
    }

    function makeMemberAction(label, className, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    }

    async function updateMember(action, person) {
      const prompts = {
        kick: `Kick ${person.username} from this group? They can rejoin with the group code.`,
        ban: `Ban ${person.username} from this group? This does not affect their other groups.`,
        unban: `Unban ${person.username} from this group? They will need the group code to join again.`
      };
      if (!window.confirm(prompts[action])) return;
      manageStatus.textContent = `${action[0].toUpperCase()}${action.slice(1)}ing ${person.username}...`;
      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: person.id })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Could not ${action} this member.`);
        const resultText = { kick: "kicked", ban: "banned", unban: "unbanned" }[action];
        manageStatus.textContent = `${person.username} has been ${resultText} from this group.`;
        await loadGroupMembers();
      } catch (error) {
        manageStatus.textContent = error.message;
      }
    }

    document.getElementById("deleteGroupBtn").addEventListener("click", async () => {
      if (!window.confirm(`Delete ${groupTitle.textContent} and its chat history for everyone? This cannot be undone.`)) return;
      const deleteButton = document.getElementById("deleteGroupBtn");
      deleteButton.disabled = true;
      manageStatus.textContent = "Deleting group...";
      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not delete this group.");
        window.location.href = "groups.html";
      } catch (error) {
        manageStatus.textContent = error.message;
        deleteButton.disabled = false;
      }
    });

    document.getElementById("regenerateInviteBtn").addEventListener("click", async () => {
      if (!window.confirm("Generate a new code? The current invite code will stop working.")) return;
      const button = document.getElementById("regenerateInviteBtn");
      button.disabled = true;
      manageStatus.textContent = "Generating a new code...";
      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/regenerate-code`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not change the invite code.");
        document.getElementById("regeneratedCode").textContent = data.inviteCode;
        document.getElementById("regeneratedCodePanel").hidden = false;
        manageStatus.textContent = "New invite code ready. Share it with the people you want to join.";
      } catch (error) {
        manageStatus.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("copyRegeneratedCodeBtn").addEventListener("click", async () => {
      const code = document.getElementById("regeneratedCode").textContent;
      try {
        await navigator.clipboard.writeText(code);
        manageStatus.textContent = "Invite code copied.";
      } catch {
        manageStatus.textContent = "Select the code above and copy it.";
      }
    });

    leaveGroupBtn.addEventListener("click", async () => {
      if (!window.confirm(`Leave ${groupTitle.textContent}? You can rejoin later with its invite code.`)) return;
      leaveGroupBtn.disabled = true;
      try {
        const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/leave`, { method: "POST" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not leave this group.");
        window.location.href = "groups.html?notice=left";
      } catch (error) {
        connectionStatus.textContent = error.message;
        leaveGroupBtn.disabled = false;
      }
    });
