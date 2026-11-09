import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/config.js';
import { db, initSchema } from '../db.js';
import { walkAndParse } from './html-to-sections.js';
import { scanHeaders } from './header-scan.js';

initSchema();

// Phase A: parse everything before touching the live database. A parse failure
// therefore leaves the existing knowledge base unchanged.
const parsedDocs = [];
if (fs.existsSync(config.sourceDir)) {
  for (const folder of fs.readdirSync(config.sourceDir, { withFileTypes: true }).filter(x => x.isDirectory())) {
    const base = path.join(config.sourceDir, folder.name);
    for (const item of walkAndParse(base)) {
      parsedDocs.push({
        sourceFile: path.relative(config.sourceDir, item.file),
        title: path.basename(item.file),
        relativePath: path.relative(config.sourceDir, item.file),
        sections: item.sections
      });
    }
  }
}
const headers = scanHeaders(config.includeDir);

// Phase B: replace all indexed records in one SQLite transaction. Any SQL error
// rolls back the deletes and inserts together, preserving the previous index.
const insertDoc = db.prepare('INSERT INTO documents(source_file,title,source_type,relative_path) VALUES(?,?,?,?)');
const insertSection = db.prepare('INSERT INTO sections(document_id,title,heading_path,content,relative_path,page_anchor,section_type) VALUES(?,?,?,?,?,?,?)');
const insertExample = db.prepare('INSERT INTO examples(title,code,language,source_path,document_id,section_id) VALUES(?,?,?,?,?,?)');
const insertSymbol = db.prepare('INSERT OR IGNORE INTO symbols(name,normalized_name,symbol_type,header_file,declaration,source_path) VALUES(?,?,?,?,?,?)');
const insertExampleFts = db.prepare('INSERT INTO examples_fts(rowid,title,code) VALUES(?,?,?)');

const rebuild = db.transaction(() => {
  db.exec('DELETE FROM examples_fts; DELETE FROM examples; DELETE FROM sections; DELETE FROM documents; DELETE FROM symbols;');
  let sectionCount = 0;
  for (const doc of parsedDocs) {
    const documentId = insertDoc.run(doc.sourceFile, doc.title, 'chm', doc.relativePath).lastInsertRowid;
    for (const section of doc.sections) {
      const sectionId = insertSection.run(documentId, section.title, section.heading_path, section.content,
        section.relative_path, section.anchor || '', 'documentation').lastInsertRowid;
      sectionCount++;
      const matches = [...section.content.matchAll(/```(?:cpp|c\+\+|c)?\n([\s\S]*?)```/g)];
      for (const match of matches) {
        if (match[1].trim().length > 25) insertExample.run(section.title, match[1].trim(), 'cpp', section.relative_path, documentId, sectionId);
      }
    }
  }
  for (const symbol of headers) {
    insertSymbol.run(symbol.name, symbol.name.toLowerCase(), symbol.type, symbol.header_file, symbol.declaration, symbol.source_path);
  }
  for (const example of db.prepare('SELECT id,title,code FROM examples').all()) {
    insertExampleFts.run(example.id, example.title, example.code);
  }
  return sectionCount;
});

const sectionCount = rebuild();

// Markdown is a convenience mirror, not the source of truth. Export only after
// the database transaction committed successfully.
fs.mkdirSync(config.convertedDir, { recursive: true });
const mdRows = db.prepare(`SELECT d.source_file,s.id,s.title,s.content,s.relative_path
  FROM sections s JOIN documents d ON d.id=s.document_id ORDER BY d.source_file,s.id`).all();
const expectedNames = new Set();
for (const row of mdRows) {
  const safe = String(row.id).padStart(7, '0') + '-' + path.basename(row.relative_path || 'page').replace(/[^a-z0-9._-]/gi, '_') + '.md';
  expectedNames.add(safe);
  fs.writeFileSync(path.join(config.convertedDir, safe), `# ${row.title}\n\n> Source: ${row.source_file}\n> Section ID: ${row.id}\n\n${row.content}\n`, 'utf8');
}
for (const name of fs.readdirSync(config.convertedDir)) {
  if (/^\d{7}-.*\.md$/i.test(name) && !expectedNames.has(name)) fs.rmSync(path.join(config.convertedDir, name), { force: true });
}

console.log(JSON.stringify({ documents: parsedDocs.length, sections: sectionCount, symbols: headers.length,
  examples: db.prepare('SELECT COUNT(*) n FROM examples').get().n,
  markdownFiles: mdRows.length, database: config.databasePath }, null, 2));
