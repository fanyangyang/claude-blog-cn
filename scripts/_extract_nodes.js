const fs=require('fs');const {load}=require('cheerio');
const file=process.argv[2], out=process.argv[3];
const h=fs.readFileSync(file,'utf8');
const $=load(h,{decodeEntities:false});
const nodes=[];
function walk(node){
  if(node.type==='text'){
    const raw=node.data;
    if(raw && raw.trim().length>0) nodes.push({i:nodes.length,text:raw,snip:raw.trim().replace(/\s+/g,' ').slice(0,90)});
    return;
  }
  if(node.children) node.children.forEach(walk);
}
walk($('body')[0].children[0] || $.root()[0]);
fs.writeFileSync(out,JSON.stringify(nodes,null,1));
console.log('nodes:',nodes.length);
