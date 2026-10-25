const registerForm = document.getElementById("registerForm");
const registerButton = document.getElementById("registerButton");
const registerStatus = document.getElementById("registerStatus");

function formatMobileForServer(value) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return /^\d{10}$/.test(digits) ? `+91${digits}` : trimmed;
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerButton.disabled = true;
  registerStatus.textContent = "Creating your account...";

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("registerUsername").value.trim(),
        phone: formatMobileForServer(document.getElementById("registerPhone").value),
        password: document.getElementById("registerPassword").value,
        securityQuestion: document.getElementById("registerQuestion").value,
        securityAnswer: document.getElementById("registerAnswer").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create your account.");
    window.location.href = "groups.html";
  } catch (error) {
    registerStatus.textContent = error.message || "The server could not be reached. Please try again.";
    registerButton.disabled = false;
  }
});

fetch("/api/me").then((response) => {
  if (response.ok) window.location.href = "groups.html";
}).catch(() => {});
