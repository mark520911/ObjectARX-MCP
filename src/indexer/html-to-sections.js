import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const SKIP = new Set(['script','style','nav','noscript']);
const clean = s => (s || '').replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
function htmlFiles(dir) {
  let out=[];
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) out.push(...htmlFiles(p));
    else if(/\.(html?|htm)$/i.test(ent.name)) out.push(p);
  }
  return out;
}
function parseFile(file, base) {
  const html=fs.readFileSync(file,'utf8');
  const $=cheerio.load(html);
  $('script,style,nav,noscript,iframe,form').remove();
  const title=clean($('title').first().text()) || path.basename(file);
  const root=$('body').length ? $('body') : $.root();
  const sections=[]; let current={title,heading_path:title,content:[],anchor:''};
  const flush=()=>{ const content=clean(current.content.join('\n')); if(content.length>80) sections.push({...current,content}); };
  root.find('h1,h2,h3,h4,p,pre,blockquote,li,dt,dd,table').each((_,el)=>{
    const tag=el.tagName?.toLowerCase();
    if(SKIP.has(tag)) return;
    const txt=clean($(el).text()); if(!txt) return;
    if(/^h[1-4]$/.test(tag)) {
      flush(); current={title:txt,heading_path:txt,content:[],anchor:$(el).attr('id')||''};
    } else {
      const block=tag==='pre' ? `\n\`\`\`cpp\n${$(el).text().trim()}\n\`\`\`` : txt;
      current.content.push(block);
    }
  });
  flush();
  if(!sections.length) {
    const text=clean(root.text());
    for(let i=0;i<text.length;i+=5000) sections.push({title,heading_path:title,content:text.slice(i,i+5000),anchor:''});
  }
  const rel=path.relative(base,file);
  return sections.map(s=>({...s,relative_path:rel}));
}
export function walkAndParse(base) {
  const rows=[];
  for(const file of htmlFiles(base)) {
    try { rows.push({file,sections:parseFile(file,base)}); }
    catch(e){ console.warn(`[WARN] parse failed ${file}: ${e.message}`); }
  }
  return rows;
}
