import { aggregateTwoHour, closedBars, currentWeek, nyParts, DEFAULT_SYMBOLS, parseSymbols, correctSecurityKind, type Bar, type Stock } from "./market";
import { alpaca, barsFor, credentials, getAssets, permit, PUBLIC_CACHE_OWNER } from "./server";
import { sortIntradayQueue } from "./intraday-queue";
import { NASDAQ_100,CURATED_ETFS } from "./universes";
import { DAILY_OWNER, INTRADAY_OWNER, UNIVERSE_OWNER } from "./market-screen";

type Asset = Pick<Stock,"symbol"|"name"|"exchange"|"kind">;
type Stored = {symbol:string;payload:string;updated_at:number};

export async function marketUniverse(db:D1Database){
  const row=await db.prepare("SELECT payload,updated_at FROM preferences WHERE owner = ?").bind(UNIVERSE_OWNER).first<{payload:string;updated_at:number}>();
  return row?{assets:(JSON.parse(row.payload) as Asset[]).map(correctSecurityKind),updatedAt:row.updated_at}:null;
}

export function cachedPage(db:D1Database,owner:string,after:string,limit:number) {
  return db.prepare("SELECT symbol,payload,updated_at FROM market_cache WHERE owner = ? AND symbol > ? ORDER BY symbol LIMIT ?").bind(owner,after,limit).all<Stored>();
}

export function cacheRows(db:D1Database,owner:string,symbols:string[]) {
  return db.prepare("SELECT symbol,payload,updated_at FROM market_cache WHERE owner = ? AND symbol IN ("+symbols.map(()=>"?").join(",")+")").bind(owner,...symbols).all<Stored>();
}

function put(db:D1Database,owner:string,symbol:string,payload:unknown,now:number){
  return db.prepare("INSERT INTO market_cache (owner,symbol,payload,updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner,symbol) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,symbol,JSON.stringify(payload),now);
}

export async function importIntradayHistory(db:D1Database){
  const lock="market-intraday-import";
  const now=Date.now(), lease=now+90000;
  const acquired=await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?, '{}', ?) ON CONFLICT(owner) DO UPDATE SET updated_at=excluded.updated_at WHERE preferences.updated_at < ? RETURNING owner").bind(lock,lease,now).first();
  if(!acquired)return {busy:true};
  try{
    return await importIntradayBatch(db,now);
  }finally{
    await db.prepare("UPDATE preferences SET updated_at=0 WHERE owner=? AND updated_at=?").bind(lock,lease).run();
  }
}

async function importIntradayBatch(db:D1Database,now:number){
  const cutoff=now-16*60000;
  const settled=latestIntradayCutoff(now);
  const universe=await marketUniverse(db);
  const active=new Set(universe?.assets.map(asset=>asset.symbol));
  const {results}=await db.prepare("SELECT d.symbol,h.updated_at AS intraday_updated_at FROM market_cache d LEFT JOIN market_cache h ON h.owner=? AND h.symbol=d.symbol WHERE d.owner=? AND d.payload<>'null' AND (h.updated_at IS NULL OR h.updated_at<?) ORDER BY d.symbol").bind(INTRADAY_OWNER,DAILY_OWNER,settled).all<{symbol:string;intraday_updated_at:number|null}>();
  const priority=new Set(parseSymbols(DEFAULT_SYMBOLS));
  const subscriptions=await db.prepare("SELECT payload FROM preferences WHERE owner LIKE ? ORDER BY updated_at DESC LIMIT 200").bind("push-subscription-v1:%").all<{payload:string}>();
  for(const row of subscriptions.results){try{for(const symbol of JSON.parse(row.payload).symbols??[])priority.add(symbol);}catch{}}
  const preset=new Set(parseSymbols(`${NASDAQ_100} ${CURATED_ETFS}`));
  const sp=await db.prepare("SELECT payload FROM preferences WHERE owner=?").bind("sp500-constituents-v1").first<{payload:string}>();
  if(sp){try{for(const symbol of JSON.parse(sp.payload).symbols??[])preset.add(symbol);}catch{}}
  const pending=sortIntradayQueue(results.filter(row=>active.has(row.symbol)),priority,preset);
  if(!pending.length)return {remaining:0,updated:0,failed:0};
  const wait=await permit(db,"alpaca");
  if(wait)return {busy:true,retryAfterMs:(await wait.json() as {retryAfterMs:number}).retryAfterMs};
  const headers=await credentials();
  const end=new Date(cutoff).toISOString(),start=new Date(cutoff-90*86400000).toISOString();
  let updated=0,failed=0;
  const batch=pending.slice(0,18);
  for(let i=0;i<batch.length;i+=6){
    const fetched=await Promise.allSettled(batch.slice(i,i+6).map(async ({symbol})=>{
      const bars=await barsFor(symbol,"30Min",start,end,headers);
      const h2=aggregateTwoHour(bars.filter(bar=>Date.parse(bar.t)+30*60000<=cutoff)).slice(-300);
      return put(db,INTRADAY_OWNER,symbol,{h2,intradayCutoff:end},now);
    }));
    const writes=fetched.flatMap(row=>row.status==="fulfilled"?[row.value]:[]);
    if(writes.length)await db.batch(writes);
    updated+=writes.length;failed+=fetched.length-writes.length;
  }
  return {remaining:pending.length-updated,updated,failed};
}

export function seedDailyCache(db:D1Database){
  return db.batch([
    db.prepare("INSERT OR IGNORE INTO market_cache (owner,symbol,payload,updated_at) SELECT ?,symbol,payload,updated_at FROM market_cache WHERE owner = ?").bind(DAILY_OWNER,PUBLIC_CACHE_OWNER),
    db.prepare("INSERT OR IGNORE INTO market_cache (owner,symbol,payload,updated_at) SELECT ?,symbol,json_object('h2',json_extract(payload,'$.h2'),'intradayCutoff',json_extract(payload,'$.fetchedAt')),updated_at FROM market_cache WHERE owner = ? AND json_array_length(payload,'$.h2')>0").bind(INTRADAY_OWNER,PUBLIC_CACHE_OWNER),
  ]);
}

// Latest regular-session 2-hour bucket close, plus the provider's delay.
export function latestIntradayCutoff(time:number){
  const local=nyParts(new Date(time-16*60000));
  const date=new Date(local.date+"T12:00:00Z");
  let minute=[690,810,930,960].filter(close=>close<=local.minute).at(-1);
  if(date.getUTCDay()===0||date.getUTCDay()===6)minute=undefined;
  if(minute===undefined){date.setUTCDate(date.getUTCDate()-1);while(date.getUTCDay()===0||date.getUTCDay()===6)date.setUTCDate(date.getUTCDate()-1);minute=960;}
  const guess=new Date(date.toISOString().slice(0,10)+"T16:00:00Z");
  return +guess+(minute+16-nyParts(guess).minute)*60000;
}

export function latestSettledCutoff(time:number){
  const local=nyParts(new Date(time-16*60000));
  const date=new Date(local.date+"T12:00:00Z");
  if(local.minute<960)date.setUTCDate(date.getUTCDate()-1);
  while(date.getUTCDay()===0||date.getUTCDay()===6)date.setUTCDate(date.getUTCDate()-1);
  const guess=new Date(date.toISOString().slice(0,10)+"T16:16:00Z");
  return +guess+(976-nyParts(guess).minute)*60000;
}

async function recentDaily(symbols:string[],start:string,end:string,headers:Record<string,string>){
  const bars=new Map<string,Bar[]>();
  const tokens=new Set<string>();
  const params=new URLSearchParams({symbols:symbols.join(","),timeframe:"1Day",start,end,feed:"sip",adjustment:"split",limit:"10000",sort:"asc"});
  for(let page=0;page<8;page++){
    const data=await alpaca("https://data.alpaca.markets/v2/stocks/bars?"+params,headers);
    for(const symbol of symbols){
      const found=data.bars?.[symbol] as Bar[]|undefined;
      if(found?.length)bars.set(symbol,[...bars.get(symbol)??[],...found.map(({t,c})=>({t,c}))]);
    }
    const token=data.next_page_token as string|undefined;
    if(!token)return bars;
    if(tokens.has(token))break;
    tokens.add(token);
    params.set("page_token",token);
  }
  throw new Error("Incomplete grouped daily data");
}

export async function refreshMarketHistory(db:D1Database){
  const now=Date.now(),lease=now+90000,lock="market-history-writer";
  const acquired=await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?, '{}', ?) ON CONFLICT(owner) DO UPDATE SET updated_at=excluded.updated_at WHERE preferences.updated_at < ? RETURNING owner").bind(lock,lease,now).first();
  if(!acquired)return {busy:true};
  try{
    let headers:Record<string,string>|undefined;
    let universe=await marketUniverse(db);
    if(!universe||now-universe.updatedAt>86400000){
      const wait=await permit(db,"alpaca");
      if(wait)return {busy:true,retryAfterMs:(await wait.json() as {retryAfterMs:number}).retryAfterMs};
      headers=await credentials();
      const assets=await getAssets(headers);
      await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(UNIVERSE_OWNER,JSON.stringify(assets),now).run();
      universe={assets,updatedAt:now};
    }
    if(!await db.prepare("SELECT symbol FROM market_cache WHERE owner=? LIMIT 1").bind(DAILY_OWNER).first())await seedDailyCache(db);
    const rows=await db.prepare("SELECT symbol,updated_at,payload <> 'null' AS available FROM market_cache WHERE owner = ?").bind(DAILY_OWNER).all<{symbol:string;updated_at:number;available:number}>();
    const status=new Map(rows.results.map(row=>[row.symbol,row]));
    const priority=new Set(parseSymbols(DEFAULT_SYMBOLS));
    const subscriptions=await db.prepare("SELECT payload FROM preferences WHERE owner LIKE ? ORDER BY updated_at DESC LIMIT 200").bind("push-subscription-v1:%").all<{payload:string}>();
    for(const row of subscriptions.results){try{for(const symbol of JSON.parse(row.payload).symbols??[])priority.add(symbol);}catch{}}
    const preset=new Set(parseSymbols(`${NASDAQ_100} ${CURATED_ETFS}`));
    const sp=await db.prepare("SELECT payload FROM preferences WHERE owner=?").bind("sp500-constituents-v1").first<{payload:string}>();
    if(sp){try{for(const symbol of JSON.parse(sp.payload).symbols??[])preset.add(symbol);}catch{}}
    const rank=(symbol:string)=>priority.has(symbol)?0:preset.has(symbol)?1:2;
    const pending=universe.assets.filter(asset=>!status.has(asset.symbol)).sort((a,b)=>rank(a.symbol)-rank(b.symbol));
    const cutoff=latestSettledCutoff(now);
    const due=universe.assets.filter(asset=>{const row=status.get(asset.symbol);return row&&row.updated_at<cutoff;}).sort((a,b)=>rank(a.symbol)-rank(b.symbol)||status.get(a.symbol)!.updated_at-status.get(b.symbol)!.updated_at);
    let next=pending.length?[0,1,2].flatMap(tier=>[...pending.filter(a=>rank(a.symbol)===tier),...due.filter(a=>rank(a.symbol)===tier)]).slice(0,18):due.slice(0,80);
    if(!next.length)return {universe:universe.assets.length,pending:0,due:0,updated:0,failed:0,remaining:0};
    if(!headers){
      const wait=await permit(db,"alpaca");
      if(wait)return {busy:true,retryAfterMs:(await wait.json() as {retryAfterMs:number}).retryAfterMs};
      headers=await credentials();
    }
    const end=new Date(now-16*60000).toISOString();
    const old=next.length?await cacheRows(db,DAILY_OWNER,next.map(a=>a.symbol)):{results:[]};
    const previous=new Map(old.results.map(row=>[row.symbol,JSON.parse(row.payload) as Stock|null]));
    let grouped:Map<string,Bar[]>|undefined;
    if(!pending.length&&next.length){
      const start=next.map(asset=>previous.get(asset.symbol)?.daily.at(-5)?.t).filter((date):date is string=>Boolean(date)).sort()[0];
      if(start){try{grouped=await recentDaily(next.map(asset=>asset.symbol),start,end,headers);}catch{}}
      if(!grouped)next=next.slice(0,18);
    }
    let updated=0,failed=0,reloads=0;
    for(let i=0;i<next.length;i+=6){
      const group=next.slice(i,i+6);
      const results=await Promise.allSettled(group.map(async asset=>{
        const cached=previous.get(asset.symbol);
        const start=cached?.daily.at(-5)?.t??"2016-01-01";
        let bars=grouped&&cached?grouped.get(asset.symbol)??[]:await barsFor(asset.symbol,"1Day",start,end,headers!);
        const recent=new Map(cached?.daily.map(bar=>[bar.t,bar.c]));
        const reload=cached&&bars.some(bar=>recent.has(bar.t)&&Math.abs(bar.c/recent.get(bar.t)!-1)>.01);
        if(reload){
          if(reloads++>=12)throw new Error("History rebase will resume in the next batch");
          bars=await barsFor(asset.symbol,"1Day","2016-01-01",end,headers!);
        }
        const stock=mergeDaily(asset,reload?null:cached??null,bars,end);
        return put(db,DAILY_OWNER,asset.symbol,stock,now);
      }));
      const writes=results.flatMap(result=>result.status==="fulfilled"?[result.value]:[]);
      failed+=group.length-writes.length;
      if(writes.length){await db.batch(writes);updated+=writes.length;}
    }
    return {universe:universe.assets.length,pending:pending.length,due:due.length,updated,failed,remaining:pending.length+due.length-updated};
  }finally{
    await db.prepare("UPDATE preferences SET updated_at=0 WHERE owner=? AND updated_at=?").bind(lock,lease).run();
  }
}

export function mergeDaily(asset:Asset,previous:Stock|null,bars:Bar[],end:string):Stock|null{
  const dailyByTime=new Map([...previous?.daily??[],...bars].map(bar=>[bar.t,bar]));
  const daily=[...dailyByTime.values()].sort((a,b)=>a.t.localeCompare(b.t));
  const last=daily.at(-1);
  if(!last)return null;
  const stock:Stock={...asset,price:last.c,asOf:last.t,fetchedAt:end,daily,weekly:[],h2:[]};
  const closed=closedBars(stock,"daily",true);
  const weekly=new Map(previous?.weekly.map(bar=>[bar.t.slice(0,10),bar]));
  for(const bar of closed){
    const monday=currentWeek(new Date(bar.t));
    weekly.set(monday,{t:monday+"T12:00:00Z",c:bar.c});
  }
  const latest=closed.at(-1);
  if(!latest)return null;
  return {...stock,price:latest.c,asOf:latest.t,daily:closed.slice(-550),weekly:[...weekly.values()].sort((a,b)=>a.t.localeCompare(b.t)).slice(-600)};
}
