#!/usr/bin/env node
// Generates the VALUES block of supabase/migrations/20260101005700_dynamic_city_search.sql from the
// dr5hn countries-states-cities-database (ODbL-1.0). See docs/LOCATION_SELECTION.md. Not run in CI or at build time.
// Usage: node scripts/generate-india-gazetteer.js <IN.json> <states.json> <004300 migration> <out.sql>
/* eslint-disable */
const fs=require("fs");
const [,,citiesPath,statesPath,curatedSql,out]=process.argv;
const cities=JSON.parse(fs.readFileSync(citiesPath,"utf8"));
const states=JSON.parse(fs.readFileSync(statesPath,"utf8")).filter(s=>s.country_code==="IN");
const stateName=new Map(states.map(s=>[s.id,s.name]));
const norm=s=>s.replace(/\s+/g," ").trim().toLowerCase();
// curated rows from the 004300 seed
const curated=new Map();
for(const m of fs.readFileSync(curatedSql,"utf8").matchAll(/\('([a-z ]+)', '([^']+)', ([\d.]+), ([\d.]+)\)/g)) curated.set(m[1],{lat:+m[3],lng:+m[4]});
const hav=(a,b,c,d)=>{const r=x=>x*Math.PI/180;const h=Math.sin(r(c-a)/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(r(d-b)/2)**2;return 12742*Math.asin(Math.sqrt(h));};
const rows=[];
for(const c of cities){
  const name=(c.name||"").replace(/\s+/g," ").trim();
  const lat=+c.latitude,lng=+c.longitude,st=stateName.get(c.state_id)||null;
  if(/ (Division|Tahsil|Taluka)$/i.test(name)) continue;
  if(["adm1","abandoned","religious","village"].includes(c.type)) continue;
  if(!name||name.length>60||!st||!isFinite(lat)||!isFinite(lng)||lat<6||lat>37.5||lng<68||lng>97.5) continue;
  if(/'/.test(name)&&name.length>50) continue;
  rows.push({name,lat,lng,st,pop:Number.isFinite(+c.population)&&c.population?+c.population:null,type:c.type||""});
}
const groups=new Map();
for(const r of rows){const k=norm(r.name);(groups.get(k)||groups.set(k,[]).get(k)).push(r);}
const outRows=new Map(); let droppedSame=0,droppedDup=0;
const rank=t=>({city:0,adm2:1,locality:2,section:3})[t]??4;
for(const [k,list] of groups){
  list.sort((a,b)=>(b.pop??-1)-(a.pop??-1)||rank(a.type)-rank(b.type));
  // Ambiguous names (several places, or a curated city elsewhere) are always state-qualified; the dataset's
  // population figures are not reliable enough to pick a winner.
  const kept=list.filter(r=>{ if(!curated.has(k)) return true; const c=curated.get(k);
    if(hav(r.lat,r.lng,c.lat,c.lng)<=30){droppedSame++;return false;} return true; });
  const ambiguous=curated.has(k)||kept.length>1;
  for(const r of kept){
    const display=ambiguous?`${r.name}, ${r.st}`:r.name;
    const key=norm(display);
    if(outRows.has(key)||curated.has(key)||display.length>80){droppedDup++;continue;}
    outRows.set(key,{key,display,...r});
  }
}
const q=s=>s===null?"NULL":"'"+String(s).replace(/'/g,"''")+"'";
const vals=[...outRows.values()].sort((a,b)=>a.key<b.key?-1:1).map(r=>`  (${q(r.key)}, ${q(r.display)}, ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}, ${q(r.st)})`);
fs.writeFileSync(out,vals.join(",\n"));
console.error(`rows=${vals.length} droppedSameAsCurated=${droppedSame} droppedDup=${droppedDup}`);
