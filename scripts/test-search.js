import {searchDocs,lookupApi,searchExamples} from '../src/search/query.js';
const q=process.argv.slice(2).join(' ')||'AcDbEntity';
console.log('DOCS',JSON.stringify(searchDocs(q,5),null,2));
console.log('API',JSON.stringify(lookupApi(q),null,2));
console.log('EXAMPLES',JSON.stringify(searchExamples(q,2),null,2));
