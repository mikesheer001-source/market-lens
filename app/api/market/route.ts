import { env } from "cloudflare:workers";
import { publicRequest, PUBLIC_CACHE_OWNER, bodyOf, connectionStatus, credentials, errorResponse, fetchStocks, alpaca, getAssets, HttpError, json, permit } from "@/lib/server";
import { makeDemo, parseSymbols, correctSecurityKind } from "@/lib/market";
import { isProvider, PROVIDERS, type Provider } from "@/lib/providers";
import { fetchAlternative } from "@/lib/provider-data";

import { readSharedSnapshot } from "@/lib/shared-snapshot";
import { UNIVERSE_OWNER } from "@/lib/market-screen";
const DEFAULT_META = Object.fromEntries(makeDemo().map(({symbol,name,kind,exchange})=>[symbol,{name,kind,exchange}]));

export async function GET(request:Request) {
  try {
    const params=new URL(request.url).searchParams;
    if(params.get("snapshot")==="1")return json(env.DB?await readSharedSnapshot(env.DB):{stocks:[],completedAt:null,requested:0,returned:0,missing:[]});
    const after=params.get("after")??"";
    const cached=env.DB?await env.DB.prepare("SELECT symbol,payload FROM market_cache WHERE owner = ? AND symbol > ? ORDER BY symbol LIMIT 100").bind(PUBLIC_CACHE_OWNER,after).all<{symbol:string;payload:string}>():{results:[]};
    return json({configured:await connectionStatus(),stocks:cached.results.map(r=>correctSecurityKind(JSON.parse(r.payload))),nextAfter:cached.results.length===100?cached.results.at(-1)?.symbol:null});
  } catch(e) { return errorResponse(e); }
}

export async function POST(request:Request) {
  try {
    publicRequest(request);
    const body=await bodyOf(request);
    if (!body || typeof body!=="object") throw new HttpError("Invalid market request.");
    const db=env.DB;
    if (!db) throw new HttpError("Market service is temporarily unavailable.",503);
    const now=Date.now();
    if(body.action==="sp500"){
      const response=await fetch("https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv",{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new HttpError("S&P 500 constituents are unavailable right now.",502);
      const lines=(await response.text()).trim().split(/\r?\n/);const header=lines.shift()?.split(",")??[];const column=header.findIndex(h=>h.toLowerCase().replaceAll('"',"")==="symbol");
      if(column<0)throw new HttpError("The constituent list format changed.",502);
      const symbols=parseSymbols(lines.map(line=>(line.split(",")[column]??"").replaceAll('"',"")).join(" "));
      if(symbols.length<450||symbols.length>550)throw new HttpError("The constituent list appears incomplete.",502);
      const retrievedAt=new Date().toISOString();
      await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind("sp500-constituents-v1",JSON.stringify({symbols,retrievedAt}),now).run();
      return json({symbols,source:"datasets/s-and-p-500-companies",retrievedAt});
    }
    if (body.action==="universe") {
      const saved=await db.prepare("SELECT payload,updated_at FROM preferences WHERE owner = ?").bind(UNIVERSE_OWNER).first<{payload:string;updated_at:number}>();
      if (saved && now-saved.updated_at<3600000) return json({assets:JSON.parse(saved.payload).map(correctSecurityKind)});
      const wait=await permit(db,"alpaca");
      if (wait) return wait;
      const assets=await getAssets(await credentials());
      await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(UNIVERSE_OWNER,JSON.stringify(assets),now).run();
      return json({assets});
    }
    if(body.action==="chart5"){
      const symbols=parseSymbols(String(body.symbols??""));if(symbols.length!==1)throw new HttpError("Choose one symbol.");
      const symbol=symbols[0],owner="public-chart5-ohlc-v2";
      const cached=await db.prepare("SELECT payload,updated_at FROM market_cache WHERE owner=? AND symbol=?").bind(owner,symbol).first<{payload:string;updated_at:number}>();
      if(cached&&now-cached.updated_at<60000)return json({...JSON.parse(cached.payload),cached:true});
      const wait=await permit(db,"alpaca");if(wait)return wait;
      const headers=await credentials();
      const start=new Date(now-10*86400000).toISOString();
      async function getBars(feed:string,end:string){
        const params=new URLSearchParams({symbols:symbol,timeframe:"5Min",start,end,feed,adjustment:"split",limit:"10000",sort:"asc"});
        const data=await alpaca("https://data.alpaca.markets/v2/stocks/bars?"+params,headers);
        if(data.next_page_token)throw new Error("Incomplete intraday bars");
        return ((data.bars?.[symbol]??[]) as {t:string;c:number;o:number;h:number;l:number;v:number}[]).filter(b=>Number.isFinite(b.c)&&Number.isFinite(Date.parse(b.t))).map(b=>({t:b.t,c:b.c,o:b.o,h:b.h,l:b.l,v:b.v}));
      }
      let bars:{t:string;c:number;o:number;h:number;l:number;v:number}[],feed:"iex"|"sip-delayed"="iex",trade:{price:number;time:string}|null=null;
      try{
        bars=await getBars("iex",new Date(now).toISOString());
        if(!bars.length)throw new Error("No IEX bars");
        try{const latest=await alpaca(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`,headers);const t=latest.trade;if(Number.isFinite(t?.p)&&Number.isFinite(Date.parse(t?.t)))trade={price:t.p,time:t.t};}catch{}
      }catch{
        feed="sip-delayed";bars=await getBars("sip",new Date(now-16*60000).toISOString());
      }
      if(!bars.length)throw new HttpError("No five-minute history is available for this ticker.",404);
      const data={symbol,bars,feed,trade,fetchedAt:new Date(now).toISOString()};
      await db.prepare("INSERT INTO market_cache (owner,symbol,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(owner,symbol) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(owner,symbol,JSON.stringify(data),now).run();
      return json({...data,cached:false});
    }
    if (body.action!=="scan" && body.action!=="test" && body.action!=="chart") throw new HttpError("Unknown action.");
    const provider=body.provider??"alpaca";
    if (!isProvider(provider)) throw new HttpError("Unknown market data provider.");
    const symbols=parseSymbols(String(body.symbols??""));
    const test=body.action==="test",chart=body.action==="chart";
    if(chart&&provider!=="alpaca")throw new HttpError("Automatic chart refresh is only available for the shared Alpaca feed.");
    const max=test||chart?1:PROVIDERS[provider].batch;
    if (!symbols.length || symbols.length>max) throw new HttpError(`This provider accepts up to ${max} ${max===1?"symbol":"symbols"} per request.`);
    if (provider!=="alpaca") {
      const key=typeof body.key==="string"?body.key.trim():"";
      if (!/^[!-~]{1,512}$/.test(key)) throw new HttpError(`Enter a valid ${PROVIDERS[provider].name} API key in Data provider.`,401);
      const wait=await permit(db,provider);
      if (wait) return wait;
      const symbol=symbols[0];
      return json({...await fetchAlternative(provider,symbol,key,DEFAULT_META[symbol]),cached:false});
    }
    const cacheOwner=chart?"public-chart-ohlc-v2":PUBLIC_CACHE_OWNER;
    const cached=test?{results:[]}:await db.prepare("SELECT symbol,payload,updated_at FROM market_cache WHERE owner = ? AND symbol IN ("+symbols.map(()=>"?").join(",")+")").bind(cacheOwner,...symbols).all<{symbol:string;payload:string;updated_at:number}>();
    const fresh=cached.results.filter(r=>now-r.updated_at<(chart?5*60000:15*60000));
    const freshSymbols=new Set(fresh.map(r=>r.symbol));
    const needed=symbols.filter(s=>!freshSymbols.has(s));
    if (!needed.length) return json({stocks:fresh.map(r=>correctSecurityKind(JSON.parse(r.payload))),missing:[],cached:true});
    const wait=await permit(db,provider);
    if (wait) return wait;
    const meta={...DEFAULT_META};
    const savedUniverse=await db.prepare("SELECT payload FROM preferences WHERE owner = ?").bind(UNIVERSE_OWNER).first<{payload:string}>();
    if (savedUniverse) for (const asset of JSON.parse(savedUniverse.payload)) meta[asset.symbol]=correctSecurityKind(asset);
    const {stocks,missing}=await fetchStocks(needed,meta,await credentials(),chart);
    if (!test && stocks.length) await db.batch(stocks.map(s=>db.prepare("INSERT INTO market_cache (owner,symbol,payload,updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner,symbol) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(cacheOwner,s.symbol,JSON.stringify(s),now)));
    return json({stocks:[...fresh.map(r=>correctSecurityKind(JSON.parse(r.payload))),...stocks],missing,cached:false});
  } catch(e) { return errorResponse(e); }
}
