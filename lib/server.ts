import { env } from "cloudflare:workers";
import type { Provider } from "./providers";
import { openCredentials } from "./vault";
import { aggregateTwoHour, type Bar, type Stock, parseSymbols, inferSecurityKind } from "./market";
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});}
export function authorize(request:Request){
  const owner=request.headers.get("oai-authenticated-user-id");
  if(!owner)throw new HttpError("Sign in with ChatGPT to use your private market data.",401);
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin)throw new HttpError("Request origin is not allowed.",403);
  return owner;
}
export class HttpError extends Error {constructor(message:string,public status=400){super(message);}}
export function errorResponse(error:unknown){return json({error:error instanceof HttpError?error.message:"The request could not be completed. Try again shortly."},error instanceof HttpError?error.status:500);}
export async function bodyOf(request:Request){
  const text=await request.text();if(text.length>150000)throw new HttpError("Request is too large.");
  try{return JSON.parse(text);}catch{throw new HttpError("Invalid request.");}
}
export const PUBLIC_CACHE_OWNER="public-market-v1";
export function publicRequest(request:Request){
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin)throw new HttpError("Request origin is not allowed.",403);
}
export async function credentials(_body:Record<string,unknown>={},_owner=""){
  if(!env.DB || !env.ALPACA_VAULT_KEY)throw new HttpError("The market data connection is not configured yet.",503);
  const row=await env.DB.prepare("SELECT encrypted_credentials FROM connections WHERE owner = ?").bind(PUBLIC_CACHE_OWNER).first<{encrypted_credentials:string}>();
  if(!row)throw new HttpError("The market data connection is not configured yet.",503);
  const {key,secret}=await openCredentials(row.encrypted_credentials,PUBLIC_CACHE_OWNER,env.ALPACA_VAULT_KEY);
  return {"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret};
}
export async function connectionStatus(_owner=""){
  if(!env.DB || !env.ALPACA_VAULT_KEY)return false;
  return Boolean(await env.DB.prepare("SELECT owner FROM connections WHERE owner = ?").bind(PUBLIC_CACHE_OWNER).first());
}
export async function alpaca(url:string,headers:Record<string,string>):Promise<any>{
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});
  if(response.status===401 || response.status===403)throw new HttpError("Alpaca rejected this key or its data permissions. Check your API key and secret.",401);
  if(response.status===429)throw new HttpError("Alpaca's rate limit was reached. Wait a minute, then resume the scan.",429);
  if(!response.ok)throw new HttpError("Alpaca could not return this market data. Retry the scan.",502);
  return response.json();
}
export async function getAssets(headers:Record<string,string>){
  let response=await fetch("https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",{headers,signal:AbortSignal.timeout(25000)});
  if(response.status===401)response=await fetch("https://api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",{headers,signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new HttpError("Could not load the symbol universe. Check your Alpaca credentials or use a custom ticker list.",response.status===429?429:401);
  const assets=await response.json() as any[];
  return assets.filter(a=>a.tradable && a.status==="active" && ["NASDAQ","NYSE","AMEX","ARCA","BATS","NYSEARCA"].includes(a.exchange)).map(a=>({symbol:a.symbol,name:a.name,exchange:a.exchange,kind:inferSecurityKind(a.name)})).filter(a=>parseSymbols(a.symbol).length);
}
export async function barsFor(symbol:string,timeframe:string,start:string,end:string,headers:Record<string,string>,includeOHLC=false){
  const collected:Bar[]=[];
  let page:string|null=null;
  let count=0;
  do{
    const params=new URLSearchParams({symbols:symbol,timeframe,start,end,feed:"sip",adjustment:"split",limit:"10000",sort:"asc"});
    if(page)params.set("page_token",page);
    const data=await alpaca("https://data.alpaca.markets/v2/stocks/bars?"+params.toString(),headers);
    for(const bar of data.bars?.[symbol]??[])collected.push(includeOHLC?{t:bar.t,c:bar.c,o:bar.o,h:bar.h,l:bar.l,v:bar.v}:{t:bar.t,c:bar.c});
    page=data.next_page_token??null;
    count++;
    if(count>=15 && page)throw new HttpError("Alpaca could not finish paging this symbol.",413);
  }while(page);
  return collected;
}
export async function fetchStocks(symbols:string[],meta:Record<string,any>,headers:Record<string,string>,includeOHLC=false):Promise<{stocks:Stock[];missing:string[]}>{
  const cutoff=new Date(Date.now()-16*60000);
  const end=cutoff.toISOString();
  const ago=(days:number)=>new Date(cutoff.getTime()-days*86400000).toISOString();
  // Parallel single-symbol histories avoid sequential Alpaca pages spanning multiple tickers.
  const results=await Promise.all(symbols.map(async(symbol):Promise<Stock|null>=>{
    const [weekly,daily,halfHour]=await Promise.all([
      barsFor(symbol,"1Week","2016-01-01",end,headers,includeOHLC),
      barsFor(symbol,"1Day",ago(850),end,headers,includeOHLC),
      barsFor(symbol,"30Min",ago(90),end,headers,includeOHLC),
    ]);
    const elapsed=halfHour.filter(b=>new Date(b.t).getTime()+30*60000<=cutoff.getTime());
    const last=elapsed.at(-1)??daily.at(-1);
    if(!last)return null;
    return {
      symbol,name:meta[symbol]?.name??symbol,exchange:meta[symbol]?.exchange??"US",kind:meta[symbol]?.kind??"Stock",
      price:last.c,asOf:last.t,fetchedAt:end,weekly:weekly.slice(-600),daily:daily.slice(-550),h2:aggregateTwoHour(elapsed).slice(-300),
    };
  }));
  return {stocks:results.filter(stock=>stock!==null),missing:symbols.filter((_,i)=>results[i]===null)};
}

export async function permit(db:D1Database, provider:Provider) {
  const owner = provider === "alpaca" ? "public-api-budget-v1" : `public-api-budget:${provider}`;
  const gap = provider === "alpaca" ? 6000 : 600;
  const now = Date.now();
  const allowed = await db.prepare("INSERT INTO preferences (owner,payload,updated_at) VALUES (?, '{}', ?) ON CONFLICT(owner) DO UPDATE SET updated_at=excluded.updated_at WHERE preferences.updated_at <= ? RETURNING owner").bind(owner,now,now-gap).first();
  if(allowed)return null;
  const last=await db.prepare("SELECT updated_at FROM preferences WHERE owner = ?").bind(owner).first<{updated_at:number}>();
  const retryAfterMs=Math.max(100,(last?.updated_at??now)+gap-Date.now());
  return json({error:"A request is already refreshing this provider. Retry in a few seconds.",retryAfterMs},429);
}
