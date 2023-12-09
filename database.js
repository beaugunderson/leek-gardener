const Database = require('better-sqlite3');

function ensureWal(db) {
  const [{ journal_mode: mode }] = db.pragma('journal_mode = wal');

  if (mode !== 'wal') {
    console.error(`Could not set WAL mode: ${JSON.stringify(mode)}`);
  }
}

exports.openDatabase = function openDatabase(path) {
  const db = new Database(path, { timeout: 5 * 60 * 1000 });

  ensureWal(db);

  db.pragma('synchronous = normal');
  db.pragma('temp_store = memory');

  process.on('exit', () => db.close());

  return db;
};
