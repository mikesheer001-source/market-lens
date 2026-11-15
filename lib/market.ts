export type Timeframe = "weekly" | "daily" | "h2";
export type Bar = { t: string; c: number; o?: number; h?: number; l?: number; v?: number; end?: string };
export function hasOHLC(b:Bar):boolean { return [b.o,b.h,b.l,b.c].every(v=>typeof v === "number" && Number.isFinite(v)) && b.h! >= Math.max(b.o!,b.c,b.l!) && b.l! <= Math.min(b.o!,b.c); }
export type Stock = {
  symbol: string; name: string; exchange: string; kind: string;
  price: number; asOf: string; fetchedAt: string;
  weekly: Bar[]; daily: Bar[]; h2: Bar[]; intradayCutoff?:string;
};
// Provider names are a heuristic, not an authoritative security-type feed.
export function inferSecurityKind(name:string):"ETF"|"Stock" {
  return /\b(?:ETF|ETN)\b|Trust|ProShares|iShares|SPDR|Invesco|Vanguard/i.test(name)?"ETF":"Stock";
}
// Repair the known legacy false positive without reclassifying genuine funds.
export function correctSecurityKind<T extends {symbol:string;kind:string}>(asset:T):T {
  return asset.symbol.toUpperCase()==="NFLX"&&asset.kind!=="Stock"?{...asset,kind:"Stock"}:asset;
}
export type Rule = {
  id: string; metric: "rsi" | "ema" | "drawdown" | "price";
  timeframe: Timeframe; period: number; op: "lt" | "gt"; value: number; enabled: boolean;
};
export type Preferences = { rules: Rule[]; favorites: string[]; universe: string; customSymbols: string; closedOnly: boolean; savedScreens: {name: string; rules: Rule[]}[] };
export const DEFAULT_RULES: Rule[] = [
  {id:"weekly-trend", metric:"ema", timeframe:"weekly", period:200, op:"gt", value:0, enabled:true},
  {id:"weekly-rsi", metric:"rsi", timeframe:"weekly", period:14, op:"lt", value:50, enabled:true},
  {id:"daily-rsi", metric:"rsi", timeframe:"daily", period:14, op:"lt", value:50, enabled:true},
  {id:"h2-rsi", metric:"rsi", timeframe:"h2", period:14, op:"lt", value:50, enabled:true},
];
export const DEFAULT_SYMBOLS = "AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AMD, NFLX, PLTR, COIN, PYPL, INTC, NKE, DIS, UBER, CRM, SHOP, SOFI, BABA, SPY, QQQ, IWM, GLD, TLT, IBIT, VXX, UVXY, SVXY, GDX";
export const DEFAULT_PREFS: Preferences = {rules:DEFAULT_RULES, favorites:[], universe:"starter", customSymbols:DEFAULT_SYMBOLS, closedOnly:true, savedScreens:[]};
export const TF_LABEL: Record<Timeframe,string> = {weekly:"Weekly", daily:"Daily", h2:"2-hour"};
export function ema(values: number[], period: number): number | null {
  if (!Number.isInteger(period) || period < 2 || values.length < period) return null;
  let value = values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const alpha = 2/(period+1);
  for (let i=period;i<values.length;i++) value += alpha*(values[i]-value);
  return value;
}
export function emaSeries(values:number[],period:number): (number|null)[] {
  const result:(number|null)[]=values.map(()=>null);
  if(values.length<period || period<2) return result;
  let value=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  result[period-1]=value;
  for(let i=period;i<values.length;i++){value+=(2/(period+1))*(values[i]-value);result[i]=value;}
  return result;
}
export function rsi(values: number[], period=14): number | null {
  if (!Number.isInteger(period) || period<2 || values.length<=period) return null;
  let gain=0, loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  gain/=period; loss/=period;
  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1]; gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;
  }
  if(gain===0 && loss===0) return 50;
  if(loss===0) return 100;
  return 100-100/(1+gain/loss);
}
// Wilder RSI series uses the same seed and smoothing as rsi().
export function rsiSeries(values:number[],period=14):(number|null)[]{
  const out:(number|null)[]=values.map(()=>null);
  if(!Number.isInteger(period)||period<2||values.length<=period)return out;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  gain/=period;loss/=period;
  const value=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
  out[period]=value();
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;out[i]=value();}
  return out;
}
const nyFormatter = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York", year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"});
export function nyParts(date: Date) {
  const parts = nyFormatter.formatToParts(date);
  const p:Record<string,string>={};for(const part of parts)p[part.type]=part.value;
  return {date:`${p.year}-${p.month}-${p.day}`, minute:Number(p.hour)*60+Number(p.minute), weekday:p.weekday};
}
export function currentWeek(date:Date) {
  const p=nyParts(date);const d=new Date(p.date+"T12:00:00Z");const day=d.getUTCDay();d.setUTCDate(d.getUTCDate()-((day+6)%7));return d.toISOString().slice(0,10);
}
export function closedBars(stock:Stock,frame:Timeframe,closedOnly:boolean):Bar[]{
  const bars=stock[frame]; if(!closedOnly)return bars;
  const cutoff = new Date(frame==="h2" ? stock.intradayCutoff??stock.fetchedAt : stock.fetchedAt);
  const p=nyParts(cutoff);const week=currentWeek(cutoff);
  return bars.filter(b=>{
    if(frame==="h2")return !b.end || new Date(b.end).getTime()<=cutoff.getTime();
    const date=b.t.slice(0,10);
    if(frame==="daily")return date<p.date || (date===p.date && p.minute>=960);
    return date<week || (date<=p.date && (p.weekday==="Sat" || p.weekday==="Sun" || (p.weekday==="Fri" && p.minute>=960)));
  });
}
export function ruleValue(stock:Stock,rule:Rule,closedOnly:boolean):number|null {
  const values=closedBars(stock,rule.timeframe,closedOnly).map(b=>b.c);
  if(rule.metric==="price")return stock.price;
  if(rule.metric==="rsi")return rsi(values,rule.period);
  if(rule.metric==="ema") { const average=ema(values,rule.period);return average ? (stock.price/average-1)*100:null; }
  const closes=closedBars(stock,"daily",closedOnly).slice(-252).map(b=>b.c);
  return closes.length>=20 ? (1-stock.price/Math.max(...closes,stock.price))*100:null;
}
export function passes(stock:Stock,rule:Rule,closedOnly:boolean) {
  if(!rule.enabled)return true;
  const value=ruleValue(stock,rule,closedOnly);
  return value!==null && (rule.op==="gt"?value>rule.value:value<rule.value);
}
export function metrics(stock:Stock,closedOnly:boolean){
  const w=closedBars(stock,"weekly",closedOnly).map(b=>b.c),d=closedBars(stock,"daily",closedOnly).map(b=>b.c),h=closedBars(stock,"h2",closedOnly).map(b=>b.c);
  const average=ema(w,200);const previous=d.length ? d[d.length-1]:null;
  return {rsiW:rsi(w),rsiD:rsi(d),rsiH:rsi(h),ema200:average,emaDistance:average ? (stock.price/average-1)*100:null, change:previous?(stock.price/previous-1)*100:0,drawdown:d.length?(1-stock.price/Math.max(...d.slice(-252),stock.price))*100:0};
}
export function parseSymbols(value:string):string[]{return [...new Set(value.toUpperCase().split(/[\s,;]+/).filter(s=>/^[A-Z][A-Z0-9.\-]{0,14}$/.test(s)))].slice(0,12000);}
export function aggregateTwoHour(bars:Bar[]):Bar[]{
  const buckets=new Map<string,Bar>();
  for(const b of bars){
    const p=nyParts(new Date(b.t)); if(p.minute<570 || p.minute>=960 || p.weekday==="Sat" || p.weekday==="Sun")continue;
    const slot=Math.floor((p.minute-570)/120);const key=`${p.date}-${slot}`;
    const slotStart=570+slot*120;const start=new Date(new Date(b.t).getTime()-(p.minute-slotStart)*60000);
    const end=new Date(start.getTime()+Math.min(120,960-slotStart)*60000);
    const prev=buckets.get(key);
    const complete=hasOHLC(b)&&(!prev||hasOHLC(prev));
    buckets.set(key,{t:start.toISOString(),c:b.c,end:end.toISOString(),...(complete?{o:prev?.o??b.o,h:Math.max(prev?.h??b.h!,b.h!),l:Math.min(prev?.l??b.l!,b.l!),...(typeof b.v==="number"&&(!prev||typeof prev.v==="number")?{v:(prev?.v??0)+b.v}: {})}: {})});
  }
  return [...buckets.values()].sort((a,b)=>a.t.localeCompare(b.t));
}
export function makeDemo():Stock[]{
  const names: Record<string,string>={AAPL:"Apple",MSFT:"Microsoft",NVDA:"NVIDIA",AMZN:"Amazon",GOOGL:"Alphabet",META:"Meta Platforms",TSLA:"Tesla",AMD:"Advanced Micro Devices",NFLX:"Netflix",PLTR:"Palantir",COIN:"Coinbase",PYPL:"PayPal",INTC:"Intel",NKE:"Nike",DIS:"Walt Disney",UBER:"Uber",CRM:"Salesforce",SHOP:"Shopify",SOFI:"SoFi Technologies",BABA:"Alibaba",SPY:"SPDR S&P 500 ETF",QQQ:"Invesco QQQ",IWM:"iShares Russell 2000",GLD:"SPDR Gold Shares",TLT:"iShares 20+ Year Treasury",IBIT:"iShares Bitcoin Trust",VXX:"iPath VIX Short-Term Futures",UVXY:"ProShares Ultra VIX",SVXY:"ProShares Short VIX",GDX:"VanEck Gold Miners"};
  const prices=[185,420,140,190,165,510,240,150,90,45,205,68,24,80,100,72,250,90,12,85,560,480,210,240,90,55,48,22,44,38];
  return Object.entries(names).map(([symbol,name],index)=>{
    let seed=index+102;const rand=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
    const base=prices[index];const end=new Date("2026-10-30T20:00:00Z").getTime();
    const series=(count:number,step:number,trend:number,dip:number)=>{
      const vals:number[]=[];let n=1;
      for(let i=0;i<count;i++){n*=Math.exp(trend+(rand()-.47)*.025);vals.push(n);}
      for(let j=0;j<dip;j++)vals[count-dip+j]*=1-.012*(j+1);
      const scale=base/vals[count-1];return vals.map((v,i)=>({t:new Date(end-(count-1-i)*step).toISOString(),c:Math.round(v*scale*100)/100}));
    };
    const dip=index%5<3?9:0;
    return {symbol,name,exchange:index>=20?"ARCA":"NASDAQ",kind:index>=20?"ETF":"Stock",price:base,asOf:"2026-10-30T20:00:00Z",fetchedAt:"2026-10-31T04:00:00Z",weekly:series(550,7*86400000,.004,dip),daily:series(550,86400000,.001,dip?15:0),h2:series(220,7200000,0,dip?8:0)};
  });
}
