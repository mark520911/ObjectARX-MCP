import fs from 'node:fs';
import path from 'node:path';
const EXT=new Set(['.h','.hpp','.hh','.hxx','.inl']);
const SKIP=new Set(['arxmgd','dbx','examples','samples']);
function walk(dir,out=[]) {
  if(!fs.existsSync(dir)) return out;
  for(const e of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,e.name);
    if(e.isDirectory()) { if(!SKIP.has(e.name.toLowerCase())) walk(p,out); }
    else if(EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}
const patterns=[
  {type:'class',re:/\b(?:class|struct)\s+(?:__declspec\([^)]*\)\s*)?(Ac[A-Za-z0-9_]+)\b/g},
  {type:'enum',re:/\benum(?:\s+class)?\s+(Ac[A-Za-z0-9_]+)\b/g},
  {type:'function',re:/\b((?:acrx|aced|acut|acdb|acdoc|aced|ads|acgi)[A-Za-z0-9_]+)\s*\(/g}
];
export function scanHeaders(includeDir) {
  const results=[];
  for(const file of walk(includeDir)) {
    let text; try{text=fs.readFileSync(file,'utf8');}catch{continue;}
    const rel=path.relative(includeDir,file);
    for(const p of patterns) {
      p.re.lastIndex=0; let m;
      while((m=p.re.exec(text))!==null) {
        const name=m[1]; const start=Math.max(0,text.lastIndexOf('\n',m.index-1));
        const end=text.indexOf(';',m.index); const decl=text.slice(start,end<0?Math.min(text.length,m.index+350):Math.min(end+1,m.index+700)).trim().replace(/\s+/g,' ');
        results.push({name,type:p.type,header_file:rel,declaration:decl,source_path:file});
      }
    }
  }
  const unique=new Map(); for(const x of results) unique.set(`${x.name}|${x.source_path}`,x);
  return [...unique.values()];
}
