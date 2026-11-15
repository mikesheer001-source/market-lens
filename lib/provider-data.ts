import { aggregateTwoHour, currentWeek, nyParts, type Bar, type Stock } from "./market";
import { type Alternative, PROVIDERS } from "./providers";
import { HttpError } from "./server";

type Point = [unknown, unknown];
type Series = { daily: Bar[]; weekly?: Bar[]; intraday?: Bar[]; minutes?: number; notice?: string };
type Meta = { name?: string; exchange?: string; kind?: string };

function bars(points: Point[], intraday = false, nyLocal = false): Bar[] {
  const unique = new Map<string, Bar>();
  for (const [stamp, close] of points) {
    if (close === null || close === undefined || close === "") continue;
    const c = Number(close);
    if (!Number.isFinite(c) || c <= 0) continue;
    if (typeof stamp !== "string" && typeof stamp !== "number") continue;
    const raw = typeof stamp === "number" ? new Date(stamp * (stamp < 1e11 ? 1000 : 1)) : stamp;
    const localTime = typeof raw === "string" && !/(Z|[+-]\d\d:?\d\d)$/i.test(raw);
    let date = raw instanceof Date ? raw : new Date(intraday
      ? raw.replace(" ", "T") + (localTime ? "Z" : "")
      : raw.slice(0,10) + "T12:00:00Z");
    if (intraday && nyLocal && localTime && Number.isFinite(date.getTime())) {
      const local = nyParts(date);
      const offset = date.getUTCHours() * 60 + date.getUTCMinutes() - local.minute;
      date = new Date(date.getTime() + ((offset + 1440) % 1440) * 60000);
    }
    if (!Number.isFinite(date.getTime())) continue;
    const t = intraday ? date.toISOString() : date.toISOString().slice(0,10) + "T12:00:00Z";
    unique.set(t,{t,c});
  }
  return [...unique.values()].sort((a,b)=>a.t.localeCompare(b.t));
}

function weeklyCloses(daily: Bar[]): Bar[] {
  const byWeek = new Map<string, Bar>();
  for (const bar of daily) {
    const monday = currentWeek(new Date(bar.t));
    byWeek.set(monday,{t:monday + "T12:00:00Z",c:bar.c});
  }
  return [...byWeek.values()];
}

function statusFor(code: number, message: string) {
  if (code === 429 || /rate limit|credit|quota|frequency|request limit|too many/i.test(message)) return 429;
  if (code === 403 || /premium|entitlement|subscription|plan|not authorized/i.test(message)) return 403;
  if (code === 401 || /api.?key|access.?key|invalid token|unauthorized/i.test(message)) return 401;
  if (code === 404 || /symbol not found|no data found|unknown symbol|invalid symbol/i.test(message)) return 404;
  return 502;
}

function providerError(provider: Alternative, status: number) {
  const name = PROVIDERS[provider].name;
  const detail = status === 429 ? "reached its request limit. Wait for your quota to reset, then resume."
    : status === 403 ? "denied access to this history endpoint. Check what your plan includes."
    : status === 401 ? "rejected the API key. Check your key in Data provider."
    : status === 404 ? "has no data for this request."
    : "could not return market history. Try again shortly.";
  return new HttpError(`${name} ${detail}`,status);
}

async function get(provider: Alternative, url: string, query: Record<string,string>, headers?: Record<string,string>): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url + "?" + new URLSearchParams(query),{headers,redirect:"manual",signal:AbortSignal.timeout(12000)});
  } catch (error) {
    if (error instanceof Error && ["TimeoutError","AbortError"].includes(error.name)) {
      throw new HttpError(`${PROVIDERS[provider].name} did not respond in time. Try again or switch providers.`,504);
    }
    throw new HttpError(`Could not connect to ${PROVIDERS[provider].name}. Try again or switch providers.`,502);
  }
  // Keep credentials on the configured host, including when a provider redirects.
  if (response.status>=300 && response.status<400) throw providerError(provider,502);
  const data: any = await response.json().catch(()=>null);
  const problem = data?.error?.message ?? data?.error ?? data?.["Error Message"] ?? data?.Note ?? data?.Information ?? data?.message ?? "";
  const code = data?.code ?? (response.ok ? 0 : response.status);
  if (!response.ok || !data || data.error || data["Error Message"] || data.Note || data.Information || data.status === "error" || data.status === "ERROR" || data.status === "NOT_AUTHORIZED") {
    throw providerError(provider,statusFor(Number(code),String(problem)));
  }
  return data;
}

const rows = (value: any): any[] => Array.isArray(value) ? value : [];
const mapRows = (data: unknown, date = "date", close = "close") => rows(data).map((row): Point => [row?.[date],row?.[close]]);
const day = (date: Date) => nyParts(date).date;

async function optional(promise: Promise<Bar[]>): Promise<{intraday: Bar[];notice?: string}> {
  try { return {intraday:await promise}; }
  catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return {intraday:[],notice:error.message};
  }
}

async function load(provider: Alternative, symbol: string, key: string, now: Date): Promise<Series> {
  const ago = (days: number) => day(new Date(now.getTime()-days*86400000));
  const today = day(now);
  const deep = ago(3653);
  const ticker = encodeURIComponent(symbol);
  const request = (url: string, params: Record<string,string>, headers?: Record<string,string>) => get(provider,url,params,headers);
  switch (provider) {
    case "businessquant": {
      const url = "https://data.businessquant.com/quotes";
      const query = {ticker:symbol,api_key:key};
      const prices = async (mode: string, period: string, intraday = false) => {
        const params = {...query,mode,period,limit:"2600"};
        const first = await request(url,params);
        const count = Math.min(Number(first.metadata?.pagination?.total_pages)||1,3);
        const pages = await Promise.all(Array.from({length:count-1},(_,i)=>request(url,{...params,page:String(i+2)})));
        return bars([first,...pages].flatMap(r=>mapRows(r.data)),intraday,intraday);
      };
      const [daily,intraday] = await Promise.all([prices("eod","10y"),optional(prices("minute-bars","8d",true))]);
      return {daily,...intraday,minutes:1};
    }
    case "fmp": {
      const url = "https://financialmodelingprep.com/stable/";
      const query = {symbol,apikey:key};
      const [history,intraday] = await Promise.all([
        request(url+"historical-price-eod/full",{...query,from:deep,to:today}),
        optional(request(url+"historical-chart/30min",{...query,from:ago(60),to:today}).then(r=>bars(mapRows(r),true,true))),
      ]);
      return {daily:bars(mapRows(Array.isArray(history)?history:history.historical)),...intraday};
    }
    case "finnhub": {
      const candles = async (resolution: string, days: number, intraday = false) => {
        const data = await request("https://finnhub.io/api/v1/stock/candle",{
          symbol,resolution,from:String(Math.floor(now.getTime()/1000)-days*86400),to:String(Math.floor(now.getTime()/1000)),
        },{"X-Finnhub-Token":key});
        return bars(rows(data.t).map((t,i)=>[t,data.c?.[i]]),intraday);
      };
      const [daily,weekly,intraday] = await Promise.all([candles("D",850),candles("W",3653),optional(candles("30",25,true))]);
      return {daily,weekly,...intraday};
    }
    case "twelve": {
      const series = async (interval: string, outputsize: number, intraday = false) => {
        const data = await request("https://api.twelvedata.com/time_series",{
          symbol,interval,outputsize:String(outputsize),apikey:key,timezone:"UTC",adjust:"splits",
        });
        return bars(mapRows(data.values,"datetime"),intraday);
      };
      const [daily,weekly,intraday] = await Promise.all([series("1day",550),series("1week",570),optional(series("30min",2000,true))]);
      return {daily,weekly,...intraday};
    }
    case "alpha": {
      const series = async (frequency: string, field: string) => {
        const data = await request("https://www.alphavantage.co/query",{symbol,function:frequency,apikey:key});
        return bars(Object.entries(data[field]??{}).map(([t,row])=>[t,(row as Record<string,unknown>)["4. close"]]));
      };
      const [daily,weekly] = await Promise.all([series("TIME_SERIES_DAILY","Time Series (Daily)"),series("TIME_SERIES_WEEKLY","Weekly Time Series")]);
      return {daily,weekly};
    }
    case "tiingo": {
      const base = "https://api.tiingo.com/";
      const headers = {Authorization:"Token "+key};
      const [history,intraday] = await Promise.all([
        request(base+`tiingo/daily/${ticker}/prices`,{startDate:deep,endDate:today},headers),
        optional(request(base+`iex/${ticker}/prices`,{startDate:ago(45),resampleFreq:"30min"},headers).then(r=>bars(mapRows(r),true))),
      ]);
      return {daily:bars(rows(history).map(r=>[r.date,r.adjClose??r.close])),...intraday};
    }
    case "massive": {
      const agg = async (interval: string, from: string, intraday = false) => {
        const data = await request(`https://api.massive.com/v2/aggs/ticker/${ticker}/range/${interval}/${from}/${ago(1)}`,{
          adjusted:"true",sort:"asc",limit:"50000",
        },{Authorization:"Bearer "+key});
        return bars(mapRows(data.results,"t","c"),intraday);
      };
      const [daily,intraday] = await Promise.all([agg("1/day",ago(729)),optional(agg("30/minute",ago(50),true))]);
      return {daily,...intraday};
    }
    case "simfin": {
      const data = await request("https://backend.simfin.com/api/v3/companies/prices/compact",{
        ticker:symbol,start:deep,end:today,
      },{Authorization:key});
      const entry = rows(data)[0] ?? data;
      const columns = rows(entry.columns).map(c=>String(c).toLowerCase().replace(/[^a-z]/g,""));
      const date = columns.findIndex(c=>["date","pricedate","tradingdate"].includes(c));
      const adjusted = columns.findIndex(c=>["adjclose","adjustedclose","adjustedclosingprice"].includes(c));
      const close = adjusted >= 0 ? adjusted : columns.findIndex(c=>["close","closingprice"].includes(c));
      return {daily:bars(rows(entry.data).map(r=>[r[date],r[close]]))};
    }
    case "eodhd": {
      const base = "https://eodhd.com/api/";
      const query = {api_token:key,fmt:"json"};
      const code = encodeURIComponent(symbol.replace(".","-"))+".US";
      const [history,intraday] = await Promise.all([
        request(base+"eod/"+code,{...query,from:ago(364),to:today,period:"d"}),
        optional(request(base+"intraday/"+code,{...query,interval:"5m",from:String(Math.floor(now.getTime()/1000)-30*86400)}).then(r=>bars(mapRows(r,"timestamp"),true))),
      ]);
      return {daily:bars(rows(history).map(r=>[r.date,r.adjusted_close??r.close])),...intraday,minutes:5};
    }
    case "marketstack": {
      const data = await request("https://api.marketstack.com/v2/eod",{access_key:key,symbols:symbol,date_from:ago(364),date_to:today,limit:"1000"});
      return {daily:bars(rows(data.data).map(r=>[r.date,r.adj_close??r.close]))};
    }
  }
}

export async function fetchAlternative(provider: Alternative, symbol: string, key: string, meta: Meta = {}) {
  const now = new Date();
  const series = await load(provider,symbol,key,now).catch(error=>{
    if (error instanceof HttpError && error.status===404) return {daily:[]} as Series;
    throw error;
  });
  const {daily,weekly,intraday,minutes = 30,notice} = series;
  const elapsed = (intraday ?? []).filter(b=>{
    const start = new Date(b.t);
    const local = nyParts(start);
    return local.minute>=570 && local.minute<960 && local.weekday!=="Sat" && local.weekday!=="Sun" && +start+minutes*60000<=+now;
  });
  const h2 = aggregateTwoHour(elapsed);
  const lastDaily = daily.at(-1);
  const lastIntraday = elapsed.at(-1);
  const last = lastIntraday && (!lastDaily || day(new Date(lastIntraday.t)) >= lastDaily.t.slice(0,10)) ? lastIntraday : lastDaily;
  const stocks: Stock[] = last ? [{
    symbol,name:meta.name??symbol,exchange:meta.exchange??"US",kind:meta.kind??"Stock",
    price:last.c,asOf:last.t,fetchedAt:now.toISOString(),
    daily:daily.slice(-550),weekly:(weekly??weeklyCloses(daily)).slice(-600),h2:h2.slice(-300),
  }] : [];
  return {stocks,missing:stocks.length?[]:[symbol],notice};
}
