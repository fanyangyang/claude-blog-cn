const fs=require('fs');
const cheerio=require('cheerio');
const slug=process.argv[2];
const html=fs.readFileSync(`content/en/${slug}/content.html`,'utf-8');
const $=cheerio.load(html,{decodeEntities:false});
const segs=[];
function walk(node){
  const children=$(node).contents().toArray();
  for(const c of children){
    if(c.type==='text'){
      const t=$(c).text();
      if(t.trim().length>0) segs.push({id:segs.length,text:t});
    } else if(c.type==='tag'){
      const tag=c.name.toLowerCase();
      if(tag==='svg'||tag==='code'||tag==='script'||tag==='style') continue;
      walk(c);
    }
  }
}
$('body').length?walk($('body')[0]):walk($.root()[0]);
let total=0;
segs.forEach(s=>total+=s.text.length);
console.error('segments',segs.length,'chars',total);
fs.writeFileSync('/tmp/segs.json',JSON.stringify(segs,null,1));
segs.forEach(s=>{if(s.text.trim().length>1)console.log(`[${s.id}] ${s.text.replace(/\n/g,' ⏎ ')}`)});
