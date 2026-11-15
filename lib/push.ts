import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { ruleValue, type Rule, type Stock } from "./market";
import { latestIntradayCutoff,latestSettledCutoff } from "./market-history";
import { DAILY_OWNER, INTRADAY_OWNER } from "./market-screen";

type RecordData={subscription:PushSubscription;rules:Rule[];symbols:string[];closedOnly:boolean;states:Record<string,boolean>;baseline:boolean};
export const PUSH_PREFIX="push-subscription-v1:";
export function validEndpoint(endpoint:string){
  try{const u=new URL(endpoint);return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&(u.hostname==="fcm.googleapis.com"||u.hostname==="updates.push.services.mozilla.com"||u.hostname.endsWith(".push.apple.com")||u.hostname==="web.push.apple.com"||u.hostname==="notify.windows.com"||u.hostname.endsWith(".notify.windows.com"));}catch{return false;}
}
export async function sendPush(subscription:PushSubscription,publicKey:string,privateKey:string,message:string){
  if(!validEndpoint(subscription.endpoint))throw new Error("Invalid push endpoint");
  const payload=await buildPushPayload({data:message,options:{ttl:3600}},subscription,{subject:"https://market-lens-mjc.mikesheer001.chatgpt.site",publicKey,privateKey});
  return fetch(subscription.endpoint,{...payload,redirect:"error",signal:AbortSignal.timeout(10000)});
}
export async function processPushBatch(db:D1Database,publicKey:string,privateKey:string){
  const subscriptions=await db.prepare("SELECT owner,payload FROM preferences WHERE owner LIKE ? ORDER BY updated_at LIMIT 20").bind(PUSH_PREFIX+"%").all<{owner:string;payload:string}>();
  let checked=0,sent=0,missing=0;
  for(const item of subscriptions.results){
    try{
      const record=JSON.parse(item.payload) as RecordData;
      if(!record.symbols.length)continue;
      const placeholders=record.symbols.map(()=>"?").join(",");
      const rows=await db.prepare(`SELECT owner,symbol,payload,updated_at FROM market_cache WHERE owner IN (?,?) AND symbol IN (${placeholders})`).bind(DAILY_OWNER,INTRADAY_OWNER,...record.symbols).all<{owner:string;symbol:string;payload:string;updated_at:number}>();
      const daily=new Map(rows.results.filter(r=>r.owner===DAILY_OWNER).map(r=>[r.symbol,r]));
      const intra=new Map(rows.results.filter(r=>r.owner===INTRADAY_OWNER).map(r=>[r.symbol,r]));
      const next={...record.states};const additions:string[]=[];
      for(const symbol of record.symbols){
        const d=daily.get(symbol);if(!d){delete next[symbol];missing++;continue;}
        const stock=JSON.parse(d.payload) as Stock|null;if(!stock){delete next[symbol];missing++;continue;}
        const h=intra.get(symbol);const overlay=h?JSON.parse(h.payload):{};
        const full={...stock,...overlay};
        const values=record.rules.filter(r=>r.enabled).map(r=>({r,v:ruleValue(full,r,record.closedOnly)}));
        // Do not turn unknown or stale histories into a new entry or exit.
        if(values.some(({r,v})=>v===null||((r.timeframe==="h2"&&(r.metric==="rsi"||r.metric==="ema"))&&(!h||h.updated_at<latestIntradayCutoff(Date.now()))))||d.updated_at<latestSettledCutoff(Date.now())){delete next[symbol];missing++;continue;}
        const match=values.every(({r,v})=>r.op==="gt"?v!>r.value:v!<r.value);
        if(record.baseline&&record.states[symbol]===false&&match)additions.push(symbol);
        next[symbol]=match;
      }
      if(additions.length){
        const response=await sendPush(record.subscription,publicKey,privateKey,JSON.stringify({title:"Market Lens",body:`${additions.join(", ")} entered your screen.`,url:"/"}));
        if(response.status===404||response.status===410){await db.prepare("DELETE FROM preferences WHERE owner=?").bind(item.owner).run();continue;}
        if(!response.ok)throw new Error("Push failed");sent++;
      }
      record.states=next;record.baseline=true;
      await db.prepare("UPDATE preferences SET payload=?,updated_at=? WHERE owner=?").bind(JSON.stringify(record),Date.now(),item.owner).run();checked++;
    }catch{await db.prepare("UPDATE preferences SET updated_at=? WHERE owner=?").bind(Date.now(),item.owner).run();}
  }
  return {checked,sent,missing};
}
