const accountName = document.getElementById("accountName");
    const createGroupForm = document.getElementById("createGroupForm");
    const joinGroupForm = document.getElementById("joinGroupForm");
    const createStatus = document.getElementById("createStatus");
    const joinStatus = document.getElementById("joinStatus");
    const listStatus = document.getElementById("listStatus");
    const groupList = document.getElementById("groupList");
    const emptyState = document.getElementById("emptyState");
    const inviteCard = document.getElementById("inviteCard");
    const inviteCodeResult = document.getElementById("inviteCodeResult");
    const hamsterOptions = document.getElementById("hamsterOptions");
    const hamsterSaveStatus = document.getElementById("hamsterSaveStatus");
    let selectedHamster = "classic";

    startDashboard();

    async function startDashboard() {
      try {
        const response = await fetch("/api/me");
        if (!response.ok) return window.location.assign("index.html");
        const data = await response.json();
        accountName.textContent = data.user.username;
        setSelectedHamster(data.user.hamsterDesign || "classic");
        await loadGroups();
        const notice = new URLSearchParams(window.location.search).get("notice");
        const notices = {
          kicked: "You were kicked from that group. You can rejoin with its code.",
          ban: "You were banned from that group.",
          left: "You left the group.",
          "group-deleted": "That group was deleted by its creator."
        };
        if (notices[notice]) listStatus.textContent = notices[notice];
      } catch {
        listStatus.textContent = "Could not connect to the server.";
      }
    }

    hamsterOptions.addEventListener("click", async (event) => {
      const option = event.target.closest("button[data-design]");
      if (!option || option.disabled || option.dataset.design === selectedHamster) return;
      const previousDesign = selectedHamster;
      const nextDesign = option.dataset.design;
      setSelectedHamster(nextDesign);
      hamsterOptions.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      hamsterSaveStatus.textContent = "Saving your new look...";
      try {
        const response = await fetch("/api/profile/hamster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hamsterDesign: nextDesign })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save your hamster.");
        setSelectedHamster(data.user.hamsterDesign || nextDesign);
        hamsterSaveStatus.textContent = "Saved! Your hamster will be waiting in your groups.";
      } catch (error) {
        setSelectedHamster(previousDesign);
        hamsterSaveStatus.textContent = error.message || "Could not save your hamster. Please try again.";
      } finally {
        hamsterOptions.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      }
    });

    function setSelectedHamster(design) {
      selectedHamster = design;
      hamsterOptions.querySelectorAll("button[data-design]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.design === design));
      });
    }

    async function loadGroups() {
      try {
        const response = await fetch("/api/groups");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load groups.");
        groupList.replaceChildren();
        data.groups.forEach((group) => {
          const link = document.createElement("a");
          link.className = "group-card";
          link.href = `chat.html?group=${encodeURIComponent(group.id)}`;
          const name = document.createElement("strong");
          name.textContent = group.name;
          const count = document.createElement("span");
          count.textContent = `${group.memberCount} ${group.memberCount === 1 ? "member" : "members"}`;
          const arrow = document.createElement("span");
          arrow.className = "group-arrow";
          arrow.setAttribute("aria-hidden", "true");
          arrow.textContent = "→";
          link.append(name, count, arrow);
          groupList.append(link);
        });
        emptyState.hidden = data.groups.length > 0;
        listStatus.textContent = "";
      } catch (error) {
        listStatus.textContent = error.message;
      }
    }

    createGroupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.getElementById("createGroupBtn");
      button.disabled = true;
      createStatus.textContent = "Creating group...";
      try {
        const response = await fetch("/api/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: document.getElementById("groupNameInput").value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not create the group.");
        document.getElementById("inviteGroupName").textContent = data.group.name;
        inviteCodeResult.textContent = data.inviteCode;
        inviteCard.hidden = false;
        createGroupForm.reset();
        createStatus.textContent = "Group created.";
        await loadGroups();
      } catch (error) {
        createStatus.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    joinGroupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.getElementById("joinGroupBtn");
      button.disabled = true;
      joinStatus.textContent = "Joining group...";
      try {
        const response = await fetch("/api/groups/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteCode: document.getElementById("inviteCodeInput").value.trim() })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not join the group.");
        joinGroupForm.reset();
        joinStatus.textContent = `You joined ${data.group.name}.`;
        await loadGroups();
      } catch (error) {
        joinStatus.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("copyInviteBtn").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        await navigator.clipboard.writeText(inviteCodeResult.textContent);
        button.textContent = "Copied";
        setTimeout(() => { button.textContent = "Copy code"; }, 1600);
      } catch {
        button.textContent = "Select and copy the code";
      }
    });

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      try {
        await fetch("/api/logout", { method: "POST" });
      } finally {
        window.location.href = "index.html";
      }
    });
