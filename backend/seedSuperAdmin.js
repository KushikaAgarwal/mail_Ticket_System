/**
 * Run once: node seedSuperAdmin.js "Your Name" you@company.com "yourpassword"
 * Creates the single root SUPER_ADMIN account everything else bootstraps from.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, pool } = require('./db');

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node seedSuperAdmin.js "Name" email@example.com password');
    process.exit(1);
  }

  const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows[0]) {
    console.log('A user with this email already exists — nothing to do.');
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO users (name, email, password_hash, role, zone_id, created_by)
     VALUES ($1,$2,$3,'SUPER_ADMIN', NULL, NULL)`,
    [name, email, passwordHash]
  );
  console.log(`Super Admin created: ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});