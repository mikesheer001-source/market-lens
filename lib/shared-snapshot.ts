import { DEFAULT_SYMBOLS,parseSymbols,correctSecurityKind,type Stock } from "./market";
import { cacheRows } from "./market-history";
import { DAILY_OWNER,INTRADAY_OWNER } from "./market-screen";
const OWNER="public-completed-snapshot-v1";
export async function completeSharedSnapshot(db:D1Database){
  const symbols=parseSymbols(DEFAULT_SYMBOLS);const [daily,intraday]=await Promise.all([cacheRows(db,DAILY_OWNER,symbols),cacheRows(db,INTRADAY_OWNER,symbols)]);
  const overlays=new Map(intraday.results.map(row=>[row.symbol,JSON.parse(row.payload)]));const now=Date.now();
  const stocks=daily.results.flatMap(row=>{const stock=JSON.parse(row.payload) as Stock|null;return stock?[correctSecurityKind({...stock,...overlays.get(row.symbol)})]:[];});
  if(!stocks.length)return {saved:false,reason:"No usable history yet",requested:symbols.length};
  const returned=new Set(stocks.map(stock=>stock.symbol));const missing=symbols.filter(symbol=>!returned.has(symbol));
  const generation=OWNER+":"+now;
  const meta={generation,completedAt:new Date(now).toISOString(),requested:symbols.length,returned:stocks.length,missing,source:"Shared cached market history",oldestData:stocks.map(s=>s.fetchedAt).sort()[0]};
  // A D1 batch commits all rows and the completion marker atomically.
  await db.batch([db.prepare("DELETE FROM market_cache WHERE owner LIKE ? AND updated_at < ?").bind(OWNER+":%",now-3600000),...stocks.map(stock=>db.prepare("INSERT INTO market_cache (owner,symbol,payload,updated_at) VALUES (?,?,?,?)").bind(generation,stock.symbol,JSON.stringify(stock),now)),db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(OWNER,JSON.stringify(meta),now)]);
  return {saved:true,...meta};
}
export async function readSharedSnapshot(db:D1Database){
  const meta=await db.prepare("SELECT payload FROM preferences WHERE owner=?").bind(OWNER).first<{payload:string}>();
  if(!meta)return {stocks:[],completedAt:null,requested:0,returned:0,missing:[]};
  const data=JSON.parse(meta.payload);
  const rows=await db.prepare("SELECT payload FROM market_cache WHERE owner=? ORDER BY symbol").bind(data.generation).all<{payload:string}>();
  return {...data,stocks:rows.results.map(r=>correctSecurityKind(JSON.parse(r.payload) as Stock))};
}
