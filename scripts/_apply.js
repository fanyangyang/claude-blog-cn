const cheerio=require('cheerio');
const fs=require('fs');
const SKIP=new Set(['script','style','svg']);
function collect($){
  const out=[];
  function walk(node){
    if(node.type==='text'){
      if(node.data && node.data.trim()) out.push(node);
      return;
    }
    if(node.type!=='tag') return;
    if(SKIP.has(node.tagName.toLowerCase())) return;
    for(const c of node.children||[]) walk(c);
  }
  for(const c of $.root()[0].children) walk(c);
  return out;
}
const file=process.argv[2];
const mapFile=process.argv[3];
const out=process.argv[4];
const h=fs.readFileSync(file,'utf8');
const $=cheerio.load(h,{decodeEntities:false});
const nodes=collect($);
console.log('nodes',nodes.length);
if(mapFile && mapFile!=='-'){
  const map=JSON.parse(fs.readFileSync(mapFile,'utf8'));
  let miss=0; const used=new Set();
  nodes.forEach((n,i)=>{
    const v=map[String(i)];
    if(v===undefined){miss++;return;}
    used.add(String(i));
    const lead=(n.data.match(/^\s*/)||[''])[0];
    const trail=(n.data.match(/\s*$/)||[''])[0];
    n.data=lead+v+trail;
  });
  const extra=Object.keys(map).filter(k=>!used.has(k));
  console.log('missing',miss,'extraKeys',extra.length, extra.slice(0,10));
}
fs.writeFileSync(out, $('body').contents().map((i,el)=>$.html(el)).get().join(''),'utf8');
