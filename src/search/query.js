import { db } from '../db.js';
import { config } from '../../config/config.js';
const escFts = q => q.trim().split(/\s+/).filter(Boolean).map(x=>`"${x.replaceAll('"','""')}"`).join(' AND ');
export function searchDocs(query, topK=config.defaultTopK) {
  const fts=escFts(query);
  if(!fts) return [];
  try {
    return db.prepare(`SELECT s.id,s.title,s.heading_path,s.content,s.relative_path,d.source_file,d.title AS document_title,bm25(sections_fts) AS score
      FROM sections_fts JOIN sections s ON s.id=sections_fts.rowid JOIN documents d ON d.id=s.document_id
      WHERE sections_fts MATCH ? ORDER BY score LIMIT ?`).all(fts,topK).map(r=>({
        sectionId:r.id,title:r.title,headingPath:r.heading_path,source:r.source_file,
        path:r.relative_path,excerpt:r.content.slice(0,config.maxExcerptChars),score:r.score
      }));
  } catch { return []; }
}
export function lookupApi(symbol) {
  const exact=db.prepare(`SELECT name,symbol_type,header_file,declaration,source_path FROM symbols WHERE normalized_name=? ORDER BY CASE symbol_type WHEN 'function' THEN 0 WHEN 'class' THEN 1 ELSE 2 END LIMIT 15`).all(symbol.toLowerCase());
  if(exact.length) return exact;
  return db.prepare(`SELECT name,symbol_type,header_file,declaration,source_path FROM symbols WHERE normalized_name LIKE ? ORDER BY name LIMIT 15`).all(`%${symbol.toLowerCase()}%`);
}
export function findHeader(query) {
  return db.prepare(`SELECT name,symbol_type,header_file,declaration FROM symbols WHERE normalized_name=? OR normalized_name LIKE ? ORDER BY CASE WHEN normalized_name=? THEN 0 ELSE 1 END LIMIT 20`).all(query.toLowerCase(),`%${query.toLowerCase()}%`,query.toLowerCase());
}
export function searchExamples(query, limit=3) {
  const fts=escFts(query);
  if(!fts) return [];
  try{return db.prepare(`SELECT e.id,e.title,e.code,e.source_path FROM examples_fts JOIN examples e ON e.id=examples_fts.rowid WHERE examples_fts MATCH ? ORDER BY bm25(examples_fts) LIMIT ?`).all(fts,limit).map(x=>({...x,code:x.code.slice(0,2500)}));}
  catch{return [];}
}
export function getSection(id) {
  return db.prepare(`SELECT s.id,s.title,s.heading_path,s.content,s.relative_path,d.source_file FROM sections s JOIN documents d ON d.id=s.document_id WHERE s.id=?`).get(id);
}
export function diagnose({error,symbol='',configuration='Release',platform='x64'}) {
  const sym=symbol ? lookupApi(symbol) : [];
  const docs=searchDocs([error,symbol].filter(Boolean).join(' '),5);
  const hints=[];
  if(/LNK2019|LNK2001/i.test(error)) hints.push('检查符号是否存在于当前 SDK 头文件；头文件声明不等于链接库中一定存在实现。核对对应 LIB、架构和配置。');
  if(/LNK1104/i.test(error)) hints.push('检查 LIB/DEF 文件是否存在、Additional Library Directories 是否正确、路径是否有引号问题。');
  if(/C2065|C3861|C2039/i.test(error)) hints.push('检查头文件、命名空间、条件编译宏、SDK 版本以及拼写。');
  hints.push(`当前上下文：${configuration} / ${platform}。优先核实工程实际使用的 ObjectARX 2024 SDK 路径。`);
  return {error,symbol,configuration,platform,symbolMatches:sym,documentation:docs,hints,warning:'诊断建议不是官方结论；请以本机头文件、LIB 文件及编译器完整输出为准。'};
}
