const cheerio=require('cheerio');
const fs=require('fs');
const file=process.argv[2];
const h=fs.readFileSync(file,'utf-8');
const $=cheerio.load(h,{decodeEntities:false});
const nodes=[];
const SKIP=new Set(['script','style','svg']);
function walk(node,path){
  if(node.type==='text'){
    const t=node.data;
    if(t && t.trim()){
      nodes.push({id:nodes.length,path,t});
    }
    return;
  }
  if(node.type!=='tag') return;
  if(SKIP.has(node.tagName.toLowerCase())) return;
  if(node.tagName==='span' && node.attribs && node.attribs['data-export-skip']!==undefined) {
    // skip sr-only export text but it has no useful content besides " (opens in new tab)"
  }
  let i=0;
  for(const c of node.children||[]){
    walk(c, path+'/'+node.tagName+'['+(i++)+']');
  }
}
for(const c of $.root()[0].children) walk(c,'');
fs.writeFileSync('/tmp/nodes.json',JSON.stringify(nodes,null,0));
console.log('count',nodes.length,'chars',nodes.reduce((a,b)=>a+b.t.length,0));
