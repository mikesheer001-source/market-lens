import { env } from "cloudflare:workers";
import { type Rule, type Stock, type Bar, parseSymbols } from "@/lib/market";
import { DAILY_OWNER, INTRADAY_OWNER, dailyStock, summarize } from "@/lib/market-screen";
import { cachedPage, cacheRows, importIntradayHistory, latestSettledCutoff, marketUniverse, refreshMarketHistory } from "@/lib/market-history";
import { bodyOf, errorResponse, HttpError, json, publicRequest } from "@/lib/server";

type Intraday = {h2:Bar[];intradayCutoff:string};

export async function GET(request:Request){
  try{
    const db=env.DB;
    if(!db)throw new HttpError("Market cache is temporarily unavailable.",503);
    const symbol=parseSymbols(new URL(request.url).searchParams.get("symbol")??"")[0];
    if(symbol){
      const [history,intraday]=await Promise.all([cacheRows(db,DAILY_OWNER,[symbol]),cacheRows(db,INTRADAY_OWNER,[symbol])]);
      const stock=history.results.length?dailyStockFrom(history.results[0].payload):null;
      const overlay=intraday.results.length?JSON.parse(intraday.results[0].payload) as Intraday:null;
      return json({stock:stock?{...stock,...overlay}:null});
    }
    const universe=await marketUniverse(db);
    const active=new Set(universe?.assets.map(asset=>asset.symbol));
    const rows=await db.prepare("SELECT symbol,updated_at,payload <> 'null' AS available FROM market_cache WHERE owner = ?").bind(DAILY_OWNER).all<{symbol:string;updated_at:number;available:number}>();
    const current=rows.results.filter(row=>active.has(row.symbol));
    const covered=current.filter(row=>row.available);
    const cutoff=latestSettledCutoff(Date.now());
    const due=current.filter(row=>row.updated_at<cutoff).length;
    const checked=current.length;
    const range=covered.reduce((out,row)=>({oldest:Math.min(out.oldest,row.updated_at),latest:Math.max(out.latest,row.updated_at)}),{oldest:Infinity,latest:0});
    return json({universe:active.size,checked,due,covered:covered.length,oldest:Number.isFinite(range.oldest)?range.oldest:null,latest:range.latest||null});
  }catch(error){return errorResponse(error);}
}

function dailyStockFrom(payload:string){
  const stock=JSON.parse(payload) as Stock|null;
  return stock?dailyStock(stock):null;
}

function screenRules(value:unknown):Rule[]{
  if(!Array.isArray(value)||value.length>20)throw new HttpError("Invalid screening rules.");
  for(const rule of value){
    if(!rule||!["ema","rsi","drawdown","price"].includes(rule.metric)||!["weekly","daily","h2"].includes(rule.timeframe)||
      !["lt","gt"].includes(rule.op)||typeof rule.enabled!=="boolean"||!Number.isFinite(rule.value)||
      !Number.isInteger(rule.period)||rule.period<2||rule.period>500)throw new HttpError("Invalid screening rule.");
  }
  return value;
}

export async function POST(request:Request){
  try{
    publicRequest(request);
    const db=env.DB;
    if(!db)throw new HttpError("Market cache is temporarily unavailable.",503);
    const body=await bodyOf(request);
    if(body?.action==="import"){
      if(body.phase==="daily")return json(await refreshMarketHistory(db));
      if(body.phase==="intraday")return json(await importIntradayHistory(db));
      throw new HttpError("Invalid import phase.");
    }
    if(body.action==="prefetch"){
      const symbols=parseSymbols(String(body.symbols??""));if(!symbols.length||symbols.length>80)throw new HttpError("Invalid prefetch symbols.");
      const [daily,intraday]=await Promise.all([cacheRows(db,DAILY_OWNER,symbols),cacheRows(db,INTRADAY_OWNER,symbols)]);
      const overlays=new Map(intraday.results.map(row=>[row.symbol,JSON.parse(row.payload) as Intraday]));
      const stocks=daily.results.flatMap(row=>{const stock=dailyStockFrom(row.payload);return stock?[{...stock,...overlays.get(row.symbol)}]:[];});
      return json({stocks,requested:symbols.length});
    }
    const rules=screenRules(body?.rules);
    const closedOnly=body.closedOnly!==false;
    if(body.action==="daily"){
      const after=typeof body.after==="string"?body.after.slice(0,15):"";
      const limit=80;
      const [universe,page]=await Promise.all([marketUniverse(db),cachedPage(db,DAILY_OWNER,after,limit)]);
      const active=new Set(universe?.assets.map(asset=>asset.symbol));
      const stocks=page.results.flatMap(row=>{
        if(!active.has(row.symbol))return [];
        const stock=dailyStockFrom(row.payload);
        return stock?[stock]:[];
      });
      const intraday=stocks.length?await cacheRows(db,INTRADAY_OWNER,stocks.map(stock=>stock.symbol)):{results:[]};
      const overlays=new Map(intraday.results.map(row=>[row.symbol,JSON.parse(row.payload) as Intraday]));
      const rows=stocks.map(stock=>summarize({...stock,...overlays.get(stock.symbol)},rules,closedOnly,true));
      return json({rows,nextAfter:page.results.length===limit?page.results.at(-1)?.symbol:null});
    }
    throw new HttpError("Unknown screening action.");
  }catch(error){return errorResponse(error);}
}
