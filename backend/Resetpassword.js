/**
 * Run once: node resetPassword.js you@example.com newpassword
 * Resets the password for an existing user — use when you don't
 * remember what a previously-seeded account's password was.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, pool } = require('./db');

async function main() {
  const [email, newPassword] = process.argv.slice(2);
  if (!email || !newPassword) {
    console.error('Usage: node resetPassword.js email@example.com newpassword');
    process.exit(1);
  }

  const { rows } = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (!rows[0]) {
    console.log('No user found with that email.');
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [passwordHash, email]);
  console.log(`Password reset for ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});