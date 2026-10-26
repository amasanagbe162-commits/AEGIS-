// DELIBERATELY VULNERABLE. Test data for scanner rules. Never run.
async function findByEmail(pool, req) {
  return pool.query("SELECT id FROM users WHERE email = '" + req.query.email + "'");
}
async function findByName(pool, req) {
  return pool.query(`SELECT id FROM users WHERE name = '${req.query.name}'`);
}
async function remove(db, req) {
  return db.execute("DELETE FROM notes WHERE id = " + req.params.id);
}
async function search(db, req) {
  const sql = "SELECT id FROM items WHERE name LIKE '%" + req.query.q + "%'";
  return db.query(sql);
}
module.exports = { findByEmail, findByName, remove, search };
