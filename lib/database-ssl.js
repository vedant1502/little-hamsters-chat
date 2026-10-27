const fs = require("node:fs");

function getDatabaseSslConfig() {
  const certificatePath = String(
    process.env.DATABASE_CA_CERT_PATH || "/etc/secrets/supabase-ca.crt"
  ).trim();

  if (!fs.existsSync(certificatePath)) {
    throw new Error(
      `Supabase TLS certificate not found at ${certificatePath}. Add Supabase's database CA certificate as a Render secret file and set DATABASE_CA_CERT_PATH to its path.`
    );
  }

  return {
    ca: fs.readFileSync(certificatePath, "utf8"),
    rejectUnauthorized: true,
  };
}

module.exports = { getDatabaseSslConfig };
