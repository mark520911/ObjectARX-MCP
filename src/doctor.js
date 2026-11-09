import fs from 'node:fs';
import {config} from '../config/config.js';
const checks=[['SDK root',config.sdkRoot],['Docs directory',config.docsDir],['Include directory',config.includeDir],['7-Zip',config.sevenZipPath]];
let bad=false;
for(const [label,p] of checks){const ok=fs.existsSync(p); console.log(`${ok?'[OK]':'[MISSING]'} ${label}: ${p}`); if(!ok && label!=='7-Zip') bad=true;}
console.log(`Node: ${process.version}`);
if(bad) process.exitCode=1;
