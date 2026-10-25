const loginForm = document.getElementById("loginForm");
const loginButton = document.getElementById("loginButton");
const authStatus = document.getElementById("authStatus");

function formatIdentifierForServer(value) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return /^\d{10}$/.test(digits) ? `+91${digits}` : trimmed;
}

if (new URLSearchParams(window.location.search).get("reset") === "success") {
  authStatus.textContent = "Password reset. You can log in with your new password.";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  authStatus.textContent = "Logging in...";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: formatIdentifierForServer(document.getElementById("loginIdentifier").value),
        password: document.getElementById("loginPassword").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not log in.");
    window.location.href = "groups.html";
  } catch (error) {
    authStatus.textContent = error.message || "The server could not be reached. Please try again.";
    loginButton.disabled = false;
  }
});

fetch("/api/me").then((response) => {
  if (response.ok) window.location.href = "groups.html";
}).catch(() => {});
