import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

let schemaReady = false;
export function initSchema() {
  if (schemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY, source_file TEXT NOT NULL UNIQUE,
      title TEXT, source_type TEXT NOT NULL DEFAULT 'chm',
      relative_path TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL,
      title TEXT NOT NULL, heading_path TEXT, content TEXT NOT NULL,
      relative_path TEXT, page_anchor TEXT, section_type TEXT DEFAULT 'documentation',
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
      title, heading_path, content, content='sections', content_rowid='id', tokenize='unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS sections_ai AFTER INSERT ON sections BEGIN
      INSERT INTO sections_fts(rowid,title,heading_path,content) VALUES(new.id,new.title,new.heading_path,new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS sections_ad AFTER DELETE ON sections BEGIN
      INSERT INTO sections_fts(sections_fts,rowid,title,heading_path,content) VALUES('delete',old.id,old.title,old.heading_path,old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS sections_au AFTER UPDATE ON sections BEGIN
      INSERT INTO sections_fts(sections_fts,rowid,title,heading_path,content) VALUES('delete',old.id,old.title,old.heading_path,old.content);
      INSERT INTO sections_fts(rowid,title,heading_path,content) VALUES(new.id,new.title,new.heading_path,new.content);
    END;
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
      symbol_type TEXT NOT NULL, header_file TEXT, declaration TEXT,
      document_id INTEGER, section_id INTEGER, source_path TEXT,
      UNIQUE(name, source_path)
    );
    CREATE INDEX IF NOT EXISTS idx_symbols_normalized ON symbols(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_symbols_header ON symbols(header_file);
    CREATE TABLE IF NOT EXISTS examples (
      id INTEGER PRIMARY KEY, title TEXT, code TEXT NOT NULL,
      language TEXT DEFAULT 'cpp', source_path TEXT, document_id INTEGER,
      section_id INTEGER
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS examples_fts USING fts5(title,code,tokenize='unicode61');
  `);
  schemaReady = true;
}

export function closeDb() {
  if (db.open) db.close();
}
