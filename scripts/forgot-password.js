const recoveryForm = document.getElementById("recoveryForm");
const recoveryButton = document.getElementById("recoveryButton");
const recoveryStatus = document.getElementById("recoveryStatus");

function formatIdentifierForServer(value) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return /^\d{10}$/.test(digits) ? `+91${digits}` : trimmed;
}

recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  recoveryButton.disabled = true;
  recoveryStatus.textContent = "Checking your account details...";

  try {
    const response = await fetch("/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: formatIdentifierForServer(document.getElementById("recoveryIdentifier").value),
        securityQuestion: document.getElementById("recoveryQuestion").value,
        securityAnswer: document.getElementById("recoveryAnswer").value,
        newPassword: document.getElementById("newPassword").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reset your password.");
    window.location.href = "index.html?reset=success";
  } catch (error) {
    recoveryStatus.textContent = error.message || "The server could not be reached. Please try again.";
    recoveryButton.disabled = false;
  }
});
