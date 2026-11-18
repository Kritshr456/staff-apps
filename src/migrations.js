export function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('Database schema is newer than this version of staff-apps.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS templates(guild TEXT,name TEXT,role TEXT,channel TEXT,
        questions TEXT NOT NULL DEFAULT '[]',enabled INTEGER NOT NULL DEFAULT 1,
        cooldown_minutes INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild,name));
      CREATE TABLE IF NOT EXISTS drafts(id INTEGER PRIMARY KEY AUTOINCREMENT,guild TEXT,user TEXT,
        name TEXT,questions TEXT,role TEXT,channel TEXT,expires INTEGER);
      CREATE TABLE IF NOT EXISTS applications(id INTEGER PRIMARY KEY,draft INTEGER UNIQUE,guild TEXT,
        user TEXT,name TEXT,questions TEXT,answers TEXT,role TEXT,channel TEXT,message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',reviewer TEXT,note TEXT,created INTEGER,reviewed INTEGER,
        claimed_by TEXT,claimed_at INTEGER,cooldown_until INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS pending_application ON applications(guild,user,name) WHERE status='pending';
      CREATE INDEX IF NOT EXISTS pending_queue ON applications(guild,status,created,id);
      CREATE TABLE IF NOT EXISTS followups(id INTEGER PRIMARY KEY AUTOINCREMENT,
        application INTEGER NOT NULL REFERENCES applications(id),question TEXT NOT NULL,
        asked_by TEXT NOT NULL,asked INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open',
        answer TEXT,answered INTEGER,cancelled INTEGER,cancelled_by TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_followup ON followups(application) WHERE status='open';
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,
        application INTEGER NOT NULL REFERENCES applications(id),actor TEXT NOT NULL,
        event TEXT NOT NULL,details TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS application_audit ON audit(application,id);
    `);
    const add = (table, name, type) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    };
    add('templates', 'cooldown_minutes', 'INTEGER NOT NULL DEFAULT 0');
    add('applications', 'claimed_by', 'TEXT');
    add('applications', 'claimed_at', 'INTEGER');
    add('applications', 'cooldown_until', 'INTEGER NOT NULL DEFAULT 0');
    db.exec('PRAGMA user_version=1; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
