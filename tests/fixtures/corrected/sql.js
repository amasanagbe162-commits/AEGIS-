// Safe equivalents of vulnerable/sql.js. Test data. Never run.
async function findByEmail(pool, req) {
  return pool.query("SELECT id FROM users WHERE email = $1", [req.query.email]);
}
async function findByName(pool, req) {
  return pool.query(`SELECT id FROM users WHERE name = $1`, [req.query.name]);
}
async function remove(db, req) {
  return db.execute("DELETE FROM notes WHERE id = ?", [req.params.id]);
}
async function search(db, req) {
  const sql = "SELECT id FROM items WHERE name LIKE $1";
  return db.query(sql, ["%" + req.query.q + "%"]);
}
module.exports = { findByEmail, findByName, remove, search };
