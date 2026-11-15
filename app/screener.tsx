"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import InteractiveChart from "./interactive-chart";
import { Activity, ArrowDown, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, Download, Eye, Filter, LayoutGrid, Link2, ListFilter, LoaderCircle, Menu, Pause, Play, Plus, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Star, Target, Trash2, X, Zap } from "lucide-react";
import { closedBars, DEFAULT_PREFS, DEFAULT_RULES, DEFAULT_SYMBOLS, makeDemo, metrics, parseSymbols, passes, ruleValue, TF_LABEL, type Preferences, type Rule, type Stock, type Timeframe } from "@/lib/market";

import { type ScreenRow } from "@/lib/market-screen";
import { NASDAQ_100, NASDAQ_100_AS_OF, CURATED_ETFS } from "@/lib/universes";
import { PROVIDERS, REFERENCE_SOURCES, type Provider } from "@/lib/providers";

type MarketCoverage = {universe:number;checked:number;due:number;covered:number;oldest:number|null;latest:number|null};
type ImportBatch = {remaining?:number;updated?:number;failed?:number;busy?:boolean;retryAfterMs?:number};
type ScreenPage = {rows:ScreenRow[];nextAfter:string|null};
const SCREEN_URL="/api/market/screen";
type CompletedSnapshot = {stocks:Stock[];completedAt:string|null;requested:number;returned:number;missing:string[];oldestData?:string};
type MarketSnapshot = {configured:boolean;stocks:Stock[];nextAfter:string|null};
type ScanResult = {stocks:Stock[];missing:string[];notice?:string};
type ProviderTest = {elapsed:number;stock?:Stock;notice?:string;error?:string};
type Tab = "screener"|"watchlist"|"alerts";
type Modal = "connect"|"universe"|"save"|"help"|null;
type AlertEntry = {symbol:string;time:string;demo:boolean};
const fmt=(n:number|null,digits=2)=>n===null?"—":n.toLocaleString("en-US",{minimumFractionDigits:digits,maximumFractionDigits:digits});
const pct=(n:number|null)=>n===null?"—":`${n>=0?"+":""}${fmt(n)}%`;
class ApiError extends Error {
  constructor(message:string,readonly status:number){super(message);}
}
const api=async<T,>(path:string,body?:unknown):Promise<T>=>{
  for(let attempt=0; ;attempt++){
    const response=await fetch(path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:undefined);
    const data=await response.json() as T & {error?:string;retryAfterMs?:number};
    if(response.ok)return data;
    const retryAfterMs=data.retryAfterMs;
    if(attempt>=2||response.status!==429||!retryAfterMs)throw new ApiError(data.error??"Request failed. Try again.",response.status);
    await new Promise(resolve=>setTimeout(resolve,retryAfterMs+100));
  }
};
function RsiCell({value}:{value:number|null}){return <span className={`rsi-pill ${value===null?"neutral":value<30?"oversold":value<50?"low":value>70?"high":"neutral"}`}>{fmt(value,1)}<span className="rsi-track"><i style={{width:`${value??0}%`}}/></span></span>;}
function Sparkline({values,positive=true}:{values:number[];positive?:boolean}){
  if(values.length<2)return <span>—</span>;
  const lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
  return <svg width="96" height="30" viewBox="0 0 96 30" aria-label="Recent daily closes"><path d={values.map((v,i)=>`${i?"L":"M"}${i/(values.length-1)*94+1},${27-(v-lo)/span*24}`).join(" ")} fill="none" stroke={positive?"#6ccdb3":"#d48b8f"} strokeWidth="1.5"/></svg>;
}
type FiveMinuteData={symbol:string;bars:import("@/lib/market").Bar[];feed:"iex"|"sip-delayed";trade:{price:number;time:string}|null;fetchedAt:string};
function PriceChart({stock,frame,closedOnly,range,rules,onFrame,onRange,onFive,allowFive}:{stock:Stock;frame:Timeframe;closedOnly:boolean;range:string;rules:Rule[];onFrame:(f:Timeframe)=>void;onRange:(r:string)=>void;onFive:()=>void;allowFive:boolean}){
 const all=closedBars(stock,frame,closedOnly);
 const count=range==="All"?10000:frame==="weekly"?(range==="1Y"?52:156):frame==="daily"?(range==="1Y"?252:504):(range==="1Y"?80:160);
 return <><div className="chart-toolbar"><div className="chart-title"><span className="ticker-badge">{stock.symbol.slice(0,2)}</span><div><strong>{stock.symbol} <span>{stock.name}</span></strong><p>{TF_LABEL[frame]} · {closedOnly?"completed candles":"including forming candles"}</p></div></div><div className="chart-controls"><div className="segment"><button disabled={!allowFive} title={allowFive?"Open five-minute IEX view":"Five-minute view uses the shared Alpaca connection"} onClick={onFive}>5m IEX</button>{(["h2","daily","weekly"] as Timeframe[]).map(f=><button key={f} className={frame===f?"active":""} onClick={()=>onFrame(f)}>{f==="h2"?"2H":f==="daily"?"D":"W"}</button>)}</div><div className="segment range">{["1Y","3Y","All"].map(r=><button key={r} className={range===r?"active":""} onClick={()=>onRange(r)}>{frame==="h2"?(r==="1Y"?"80 bars":r==="3Y"?"160":"All"):frame==="daily"&&r==="3Y"?"2Y":r}</button>)}</div></div></div><InteractiveChart bars={all} initialCount={count} rules={rules.filter(r=>r.timeframe===frame||r.metric==="price")} identity={`${stock.symbol} ${frame} ${range}`}/><div className="chart-context">Screen conditions: {rules.filter(r=>r.enabled).map(r=>`${r.metric.toUpperCase()}${r.metric==="ema"||r.metric==="rsi"?`(${r.period}) ${TF_LABEL[r.timeframe]}`:""}`).join(" · ")||"None"}. Chart indicators are independent.</div></>;
}
function IntradayChart({data,onFrame}:{data:FiveMinuteData;onFrame:(f:Timeframe)=>void}){
 return <><div className="chart-toolbar"><div className="chart-title"><span className="ticker-badge">{data.symbol.slice(0,2)}</span><div><strong>{data.symbol} <span>5-minute bars</span></strong><p>{data.feed==="iex"?"IEX single exchange":"SIP delayed at least 16 minutes"}</p></div></div><div className="segment"><button className="active">5m {data.feed==="iex"?"IEX":"SIP"}</button>{(["h2","daily","weekly"] as Timeframe[]).map(f=><button key={f} onClick={()=>onFrame(f)}>{f==="h2"?"2H":f==="daily"?"D":"W"}</button>)}</div></div><div className="chart-context">5-minute bars may be forming. Screening uses the selected provider on 2-hour, daily and weekly candles. {data.trade?`IEX last trade $${fmt(data.trade.price)} at ${new Date(data.trade.time).toLocaleString()}.`:""}</div><InteractiveChart bars={data.bars} identity={`${data.symbol} 5-minute ${data.feed}`}/></>;
}

export default function Screener(){
  const [prefs,setPrefs]=useState<Preferences>(DEFAULT_PREFS),[ready,setReady]=useState(false),[saveState,setSaveState]=useState("Saved on this device");
  const [stocks,setStocks]=useState<Stock[]>([]),[starterDemo,setDemo]=useState(false),[loadedUniverse,setLoadedUniverse]=useState("starter"),[tab,setTab]=useState<Tab>("screener");
  const [modal,setModal]=useState<Modal>(null),[search,setSearch]=useState(""),[matchesOnly,setMatchesOnly]=useState(true),[nearOnly,setNearOnly]=useState(false),[sort,setSort]=useState("match"),[kind,setKind]=useState("all");
  const [chartOpen,setChartOpen]=useState(false);
  const chartAnchor=useRef<HTMLDivElement>(null);
  function selectSymbol(symbol:string){setSelected(symbol);setChartOpen(true);if(window.innerWidth<=650)window.requestAnimationFrame(()=>chartAnchor.current?.scrollIntoView({behavior:"smooth",block:"start"}));}
  const [selected,setSelected]=useState("META"),[frame,setFrame]=useState<Timeframe>("weekly"),[range,setRange]=useState("3Y"),[showFilters,setShowFilters]=useState(false);
  const [alpacaConnected,setAlpacaConnected]=useState(false);
  const [provider,setProvider]=useState<Provider>("alpaca"),[keys,setKeys]=useState<Partial<Record<Provider,string>>>({});
  const [keyDraft,setKeyDraft]=useState(""),[testing,setTesting]=useState(false),[tests,setTests]=useState<Partial<Record<Provider,ProviderTest>>>({});
  const [scanTime,setScanTime]=useState<number|null>(null),[coverageNote,setCoverageNote]=useState("");
  const [sharedSnapshot,setSharedSnapshot]=useState<CompletedSnapshot|null>(null);
  const connected=provider==="alpaca"?alpacaConnected:Boolean(keys[provider]);
  const providerLabel=PROVIDERS[provider].name;
  const universe=provider!=="alpaca"&&prefs.universe==="market"?"starter":prefs.universe;
  const marketMode=universe==="market";
  const demo=!marketMode&&starterDemo;
  const [marketRows,setMarketRows]=useState<ScreenRow[]>([]);
  const [coverage,setCoverage]=useState<MarketCoverage|null>(null);
  const [screenSignature,setScreenSignature]=useState("");
  const [importing,setImporting]=useState(false);
  const [importStatus,setImportStatus]=useState("");
  const importStop=useRef(false),importRunning=useRef(false);
  const [marketChart,setMarketChart]=useState<Stock|null>(null);
  const [liveChart,setLiveChart]=useState<Stock|null>(null),[fiveData,setFiveData]=useState<FiveMinuteData|null>(null);
  const [fiveMode,setFiveMode]=useState(false),[chartStatus,setChartStatus]=useState(""),[chartRefresh,setChartRefresh]=useState(0);
  const [chartTick,setChartTick]=useState(0);
  const marketJob=useRef<{signature:string;rows:Map<string,ScreenRow>;after:string|null;dailyDone:boolean}|null>(null);
  const signature=JSON.stringify([prefs.rules,prefs.closedOnly]);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[screenName,setScreenName]=useState(""),[scanning,setScanning]=useState(false),[progress,setProgress]=useState({done:0,total:0});
  const [alertsEnabled,setAlertsEnabled]=useState(false),[alertLog,setAlertLog]=useState<AlertEntry[]>([]),[pushBusy,setPushBusy]=useState(false);
  const [universeText,setUniverseText]=useState(DEFAULT_SYMBOLS),[missing,setMissing]=useState<string[]>([]);
  const stopRef=useRef(false),busyRef=useRef(false),pendingRef=useRef<string[]>([]),knownMatches=useRef<Set<string>|null>(null);
  const prefsRef=useRef(prefs);prefsRef.current=prefs;
  const demoRef=useRef(starterDemo);demoRef.current=starterDemo;
  const initialScan=useRef(false);

  useEffect(()=>{
    try{const local=localStorage.getItem("market-lens-preferences");let next={...DEFAULT_PREFS,...(local?JSON.parse(local):{})};
      const shared=new URLSearchParams(location.search).get("screen");
      if(shared){const data=JSON.parse(decodeURIComponent(escape(atob(shared.replace(/-/g,"+").replace(/_/g,"/")))));if(Array.isArray(data.rules)&&data.rules.length<=20&&data.rules.every((r:Rule)=>r&&["ema","rsi","drawdown","price"].includes(r.metric)&&["weekly","daily","h2"].includes(r.timeframe)&&["lt","gt"].includes(r.op)&&typeof r.enabled==="boolean"&&Number.isFinite(r.value)&&Number.isInteger(r.period)&&r.period>=2&&r.period<=500)&&["starter","market","watchlist","custom","sp500","nasdaq100","etfs"].includes(data.universe)){next={...next,rules:data.rules,universe:data.universe,customSymbols:data.universe==="custom"?String(data.customSymbols||"").slice(0,100000):next.customSymbols,closedOnly:data.closedOnly!==false};}}
      setPrefs(next);}catch{}
    setReady(true);
  },[]);
  useEffect(()=>{
    if(provider!=="alpaca"||!ready)return;
    let active=true;
    (async()=>{
      try{
        const [data,snapshot]=await Promise.all([api<MarketSnapshot>("/api/market"),api<CompletedSnapshot>("/api/market?snapshot=1")]);
        if(!active)return;
        setAlpacaConnected(data.configured);setSharedSnapshot(snapshot);
        if(!busyRef.current&&prefsRef.current.universe==="starter"&&snapshot.stocks.length){setLoadedUniverse("starter");knownMatches.current=null;setStocks(snapshot.stocks);setDemo(false);demoRef.current=false;setSelected(snapshot.stocks[0].symbol);}
      }catch{}
    })();
    return()=>{active=false;};
  },[provider,ready]);
  useEffect(()=>{
    if(!ready)return;localStorage.setItem("market-lens-preferences",JSON.stringify(prefs));
    setSaveState("Saved on this device");
  },[prefs,ready]);
  useEffect(()=>{
    if(!ready||!alpacaConnected||provider!=="alpaca"||initialScan.current)return;
    initialScan.current=true;
    // Cached genuine prices are displayed immediately; fresh data requires a scan.
  },[ready,alpacaConnected,provider,marketMode]);
  useEffect(()=>{
    if(!ready||!alpacaConnected||!marketMode)return;
    knownMatches.current=null;
    void runScan(false,true);
  },[ready,alpacaConnected,marketMode]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(""),4500);return()=>clearTimeout(t);},[notice]);
  const evaluated=useMemo(()=>marketMode?(screenSignature===signature?marketRows:[]):loadedUniverse!==universe?[]:stocks.map(stock=>{
    const values=metrics(stock,prefs.closedOnly),active=prefs.rules.filter(r=>r.enabled);
    const ruleValues=active.map(r=>ruleValue(stock,r,prefs.closedOnly));
    const matched=active.filter((r,i)=>ruleValues[i]!==null&&(r.op==="gt"?ruleValues[i]!>r.value:ruleValues[i]!<r.value)).length;
    return {stock,values,ruleValues,matched,total:active.length,match:matched===active.length};
  }),[stocks,prefs.rules,prefs.closedOnly,marketMode,marketRows,loadedUniverse,universe,screenSignature,signature]);
  const matching=evaluated.filter(e=>e.match),favorites=new Set(prefs.favorites);
  const filtered=useMemo(()=>{
    const result=evaluated.filter(e=>(nearOnly?e.total>0&&e.matched===e.total-1&&e.ruleValues.every(v=>v!==null):!matchesOnly||e.match)&&(tab!=="watchlist"||prefs.favorites.includes(e.stock.symbol))&&(kind==="all"||e.stock.kind===kind)&&(!search||`${e.stock.symbol} ${e.stock.name}`.toLowerCase().includes(search.toLowerCase())));
    return result.sort((a,b)=>sort==="symbol"?a.stock.symbol.localeCompare(b.stock.symbol):sort==="rsi"?(a.values.rsiW??101)-(b.values.rsiW??101):sort==="drawdown"?b.values.drawdown-a.values.drawdown:sort==="price"?b.stock.price-a.stock.price:b.matched-a.matched||(a.values.rsiW??101)-(b.values.rsiW??101));
  },[evaluated,matchesOnly,nearOnly,tab,prefs.favorites,kind,search,sort]);
  const focused=marketMode
    ?marketRows.find(row=>row.stock.symbol===selected)?.stock??filtered[0]?.stock??marketRows[0]?.stock
    :loadedUniverse===universe?(stocks.find(stock=>stock.symbol===selected)??filtered[0]?.stock??stocks[0]):undefined;
  const focusSymbol=focused?.symbol;
  useEffect(()=>{
    if(!marketMode||!focusSymbol)return;
    let active=true;
    api<{stock:Stock|null}>(SCREEN_URL+"?symbol="+encodeURIComponent(focusSymbol)).then(data=>{if(active)setMarketChart(data.stock);}).catch(()=>{if(active)setMarketChart(null);});
    return()=>{active=false;};
  },[marketMode,focusSymbol,chartTick]);
  useEffect(()=>{
    if(!focusSymbol||demo||provider!=="alpaca"||!alpacaConnected||tab==="alerts")return;
    let active=true,running=false;setChartStatus("Loading updated chart…");
    async function refresh(){
      if(!active||running||document.visibilityState!=="visible")return;running=true;
      try{
        if(fiveMode){const data=await api<FiveMinuteData>("/api/market",{action:"chart5",symbols:focusSymbol});if(active){setFiveData(data);setChartStatus("");}}
        else {const data=await api<ScanResult>("/api/market",{action:"chart",symbols:focusSymbol});if(active){if(!data.stocks[0])throw new Error("No chart data returned.");setLiveChart(data.stocks[0]);setChartStatus("");}}
      }catch(e){if(active)setChartStatus(`Chart refresh failed: ${(e as Error).message}`);}finally{running=false;}
    }
    void refresh();const timer=window.setInterval(()=>void refresh(),fiveMode?60000:300000);const onVisible=()=>{if(document.visibilityState==="visible")void refresh();};document.addEventListener("visibilitychange",onVisible);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener("visibilitychange",onVisible);};
  },[focusSymbol,demo,provider,alpacaConnected,tab,fiveMode,chartRefresh]);
  const fallbackChart=marketMode?(marketChart?.symbol===focusSymbol?marketChart:null):focused;
  const chartStock=liveChart?.symbol===focusSymbol&&!demo&&provider==="alpaca"?liveChart:fallbackChart;
  const currentFive=fiveData?.symbol===focusSymbol?fiveData:null;
  const loadedCount=marketMode?evaluated.length:loadedUniverse===universe?stocks.length:0;
  const current=evaluated.find(e=>e.stock.symbol===focused?.symbol);
  const activeRules=prefs.rules.filter(r=>r.enabled).length;
  const updated=stocks.reduce((latest,s)=>s.fetchedAt>latest?s.fetchedAt:latest,"");
  function updateRule(id:string,patch:Partial<Rule>){setPrefs(p=>({...p,rules:p.rules.map(r=>r.id===id?{...r,...patch}:r)}));}
  function toggleFavorite(symbol:string){setPrefs(p=>({...p,favorites:p.favorites.includes(symbol)?p.favorites.filter(s=>s!==symbol):[...p.favorites,symbol]}));}
  function resetProviderData(showDemo:boolean){
    setFiveMode(false);setFiveData(null);setLiveChart(null);setChartStatus("");
    pendingRef.current=[];marketJob.current=null;knownMatches.current=null;
    setMarketRows([]);setCoverage(null);setScreenSignature("");setImportStatus("");
    setStocks(showDemo?makeDemo():[]);setDemo(showDemo);demoRef.current=showDemo;
    setProgress({done:0,total:0});setMissing([]);setScanTime(null);setCoverageNote("");setError("");
  }
  function changeProvider(next:Provider){
    if(busyRef.current||importing||testing||next===provider)return;
    resetProviderData(next==="alpaca");setProvider(next);setKeyDraft("");
  }
  function useKey(){
    const key=keyDraft.trim();
    if(!key||key===keys[provider])return;
    resetProviderData(false);
    setKeys(old=>({...old,[provider]:key}));setKeyDraft("");
    setTests(old=>({...old,[provider]:undefined}));
  }
  async function testProvider(){
    if(!connected||testing||busyRef.current)return;
    setTesting(true);
    const started=performance.now();
    try{
      const data=await api<ScanResult>("/api/market",{action:"test",provider,key:keys[provider],symbols:"AAPL"});
      setTests(old=>({...old,[provider]:{elapsed:(performance.now()-started)/1000,stock:data.stocks[0],notice:data.notice}}));
    }catch(e){
      setTests(old=>({...old,[provider]:{elapsed:(performance.now()-started)/1000,error:(e as Error).message}}));
    }finally{setTesting(false);}
  }
  async function runMarketScreen(resume:boolean,cacheOnly:boolean){
    const {rules,closedOnly}=prefsRef.current;
    const key=JSON.stringify([rules,closedOnly]);
    if(!resume||marketJob.current?.signature!==key){
      marketJob.current={signature:key,rows:new Map(),after:null,dailyDone:false};
      pendingRef.current=[];setScreenSignature(key);setMissing([]);
    }
    const job=marketJob.current!;
    const snapshot=await api<MarketCoverage>(SCREEN_URL);
    setCoverage(snapshot);
    setProgress({done:job.rows.size,total:snapshot.covered});
    do{
      const page=await api<ScreenPage>(SCREEN_URL,{rules,closedOnly,action:"daily",after:job.after});
      for(const row of page.rows)job.rows.set(row.stock.symbol,row);
      job.after=page.nextAfter;
      setProgress({done:job.rows.size,total:Math.max(job.rows.size,snapshot.covered)});
    }while(job.after&&!stopRef.current);
    job.dailyDone=!job.after;
    setMarketRows([...job.rows.values()]);setChartTick(value=>value+1);
    if(!cacheOnly&&job.dailyDone)setNotice(snapshot.covered?"Filters applied to imported data.":"Use Import data to load market history.");
  }
  async function importMarket(){
    if(busyRef.current||importRunning.current||testing)return;
    importRunning.current=true;setImporting(true);setError("");setImportStatus("Starting import…");importStop.current=false;
    let finished=false;
    try{
      for(const phase of ["daily","intraday"]){
        const label=phase==="daily"?"Daily and weekly":"Two-hour";
        while(!importStop.current){
          const result=await api<ImportBatch>(SCREEN_URL,{action:"import",phase});
          if(result.busy){
            await new Promise(resolve=>setTimeout(resolve,(result.retryAfterMs??2500)+150));
            continue;
          }
          setImportStatus(`${label} history · ${(result.remaining??0).toLocaleString()} left in this stage`);
          if(result.remaining===0)break;
          if(!result.updated&&result.failed)throw new Error("The data provider could not finish this batch. Click Import data to resume.");
        }
        if(importStop.current)break;
      }
      finished=!importStop.current;
      setImportStatus(finished?"Import complete.":"Import paused. Click Import data to resume.");
    }catch(error){
      setError((error as Error).message);
      setImportStatus("Import interrupted. Saved progress can be resumed.");
    }finally{
      importRunning.current=false;setImporting(false);
      if(finished)await runScan(false,true);
      else void api<MarketCoverage>(SCREEN_URL).then(setCoverage).catch(()=>{});
    }
  }
  async function runScan(resume=false,cacheOnly=false){
    if(busyRef.current||importRunning.current||testing)return;
    if(!connected){setModal("connect");return;}
    busyRef.current=true;stopRef.current=false;setScanning(true);setError("");setScanTime(null);
    const started=performance.now();
    try{
      if(marketMode){await runMarketScreen(resume,cacheOnly);return;}
      if(!resume || !pendingRef.current.length){
        setMissing([]);setCoverageNote("");pendingRef.current=[];setProgress({done:0,total:0});
        const p=prefsRef.current;let symbols:string[]=[];
        const scanUniverse=provider!=="alpaca"&&p.universe==="market"?"starter":p.universe;
        if(scanUniverse==="watchlist")symbols=p.favorites;
        else if(scanUniverse==="sp500"){const preset=await api<{symbols:string[];retrievedAt:string}>("/api/market",{action:"sp500"});symbols=preset.symbols;setCoverageNote(`S&P 500 list retrieved ${new Date(preset.retrievedAt).toLocaleString()} from datasets/s-and-p-500-companies.`);}
        else symbols=parseSymbols(scanUniverse==="custom"?p.customSymbols:scanUniverse==="nasdaq100"?NASDAQ_100:scanUniverse==="etfs"?CURATED_ETFS:DEFAULT_SYMBOLS);
        if(!symbols.length)throw new Error("Add at least one ticker to this universe before scanning.");
        pendingRef.current=[...symbols];setProgress({done:0,total:symbols.length});
        if(provider==="alpaca"&&["sp500","nasdaq100","etfs","watchlist"].includes(scanUniverse)){
          const cached:Stock[]=[];for(let i=0;i<symbols.length;i+=80){const page=await api<{stocks:Stock[]}>(SCREEN_URL,{action:"prefetch",symbols:symbols.slice(i,i+80).join(",")});cached.push(...page.stocks);}
          setStocks(cached);setLoadedUniverse(scanUniverse);setDemo(false);demoRef.current=false;setSharedSnapshot(null);
          setCoverageNote(`Preloaded daily history for ${cached.length} of ${symbols.length} symbols; ${cached.filter(stock=>stock.h2.length>0).length} have 2-hour history. Refreshing now.`);
        }
      }
      let firstBatch=!resume&&!(["sp500","nasdaq100","etfs","watchlist"].includes(universe)&&provider==="alpaca");
      let batchSize:number=PROVIDERS[provider].batch;
      while(pendingRef.current.length && !stopRef.current){
        const batch=pendingRef.current.slice(0,batchSize);
        let response:ScanResult;
        try{
          response=await api<ScanResult>("/api/market",{action:"scan",provider,key:keys[provider],symbols:batch.join(",")});
        }catch(error){
          if(provider!=="alpaca"||!(error instanceof ApiError)||error.status!==413||batch.length===1)throw error;
          batchSize=Math.floor(batch.length/2);
          continue;
        }
        const wasDemo=demoRef.current;const resetRows=firstBatch;firstBatch=false;
        if(wasDemo)knownMatches.current=null;
        if(response.stocks.length){
          setSharedSnapshot(null);setLoadedUniverse(provider!=="alpaca"&&prefsRef.current.universe==="market"?"starter":prefsRef.current.universe);
          setStocks(old=>{
            const map=new Map((wasDemo||resetRows?[]:old).map(s=>[s.symbol,s]));
            for(const stock of response.stocks)map.set(stock.symbol,stock);
            return [...map.values()];
          });
          setDemo(false);demoRef.current=false;
        }
        if(response.notice)setCoverageNote(response.notice);
        setMissing(old=>[...old,...response.missing]);
        pendingRef.current=pendingRef.current.slice(batch.length);setProgress(p=>({...p,done:p.done+batch.length}));
      }
      setNotice(pendingRef.current.length?"Scan paused. Resume before closing this tab.":"Scan complete. Filters are applied to the loaded data.");
    }catch(e){setError((e as Error).message);}finally{
      setScanTime((performance.now()-started)/1000);busyRef.current=false;setScanning(false);
    }
  }
  function exportCsv(){
    const quote=(v:unknown)=>`"${String(v??"").replaceAll('"','""')}"`;
    const rules=prefs.rules.filter(r=>r.enabled);
    const labels=rules.map(r=>`${r.metric} ${r.timeframe} (${r.period}) ${r.op==="gt"?">":"<"} ${r.value}`);
    const rows=[["Symbol","Company","Price USD",...labels.flatMap(label=>[`${label} actual`,`${label} status`]),"Conditions met","Data timestamp","Source"],...filtered.map(e=>[e.stock.symbol,e.stock.name,e.stock.price,...rules.flatMap((r,i)=>{const v=e.ruleValues[i];return [v,v===null?"missing":(r.op==="gt"?v>r.value:v<r.value)?"pass":"fail"]; }),`${e.matched}/${e.total}`,e.stock.asOf,demo?"SYNTHETIC DEMO":providerLabel])];
    const url=URL.createObjectURL(new Blob([rows.map(r=>r.map(quote).join(",")).join("\r\n")],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download=`market-lens-${demo?"demo-":""}${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);setNotice("CSV exported with source labels and timestamps.");
  }
  async function shareScreen(){
    const sharedUniverse=prefs.universe==="watchlist"?"custom":prefs.universe;
    const data={rules:prefs.rules,universe:sharedUniverse,...(sharedUniverse==="custom"?{customSymbols:prefs.universe==="watchlist"?prefs.favorites.join(","):prefs.customSymbols}:{}),closedOnly:prefs.closedOnly};
    const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const url=new URL(location.href);url.search="";url.searchParams.set("screen",encoded);
    try{await navigator.clipboard.writeText(url.toString());setNotice("Screen link copied.");}catch{window.prompt("Copy this screen link",url.toString());}
  }
  function saveScreen(){if(!screenName.trim())return;setPrefs(p=>({...p,savedScreens:[...p.savedScreens.filter(s=>s.name!==screenName.trim()),{name:screenName.trim(),rules:p.rules.map(r=>({...r}))}].slice(-20)}));setModal(null);setNotice(`“${screenName.trim()}” saved`);setScreenName("");}
  const pushSetup=useRef<{registration:ServiceWorkerRegistration;key:Uint8Array<ArrayBuffer>}|null>(null);
  useEffect(()=>{
    if(tab!=="alerts"||!("serviceWorker" in navigator)||!("PushManager" in window))return;
    let active=true;
    Promise.all([navigator.serviceWorker.register("/sw.js"),api<{publicKey:string|null}>("/api/push")]).then(([registration,config])=>{
      if(!active||!config.publicKey)return;
      const padded=config.publicKey.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-config.publicKey.length%4)%4);
      pushSetup.current={registration,key:new Uint8Array(Array.from(atob(padded),c=>c.charCodeAt(0)))};
    }).catch(()=>{});
    return()=>{active=false;};
  },[tab]);
  async function enableAlerts(){
    if(pushBusy)return;setPushBusy(true);setError("");
    try{
      if(!("serviceWorker" in navigator)||!("PushManager" in window))throw new Error("This browser does not support Web Push. On iPhone, add Market Lens to your Home Screen and open it there.");
      const oldId=localStorage.getItem("market-lens-push-id");
      if(alertsEnabled&&oldId){await api("/api/push",{action:"remove",id:oldId});const registration=await navigator.serviceWorker.ready;const sub=await registration.pushManager.getSubscription();await sub?.unsubscribe();localStorage.removeItem("market-lens-push-id");setAlertsEnabled(false);setNotice("Background alerts disabled.");return;}
      const symbols=universe==="watchlist"?prefs.favorites:parseSymbols(universe==="custom"?prefs.customSymbols:universe==="etfs"?CURATED_ETFS:DEFAULT_SYMBOLS);
      if(["market","sp500","nasdaq100"].includes(universe)||symbols.length>50||!symbols.length)throw new Error("Background alerts support the starter, watchlist, or a custom list of up to 50 symbols.");
      if(!pushSetup.current)throw new Error("Notification setup is still loading or unavailable. Try again in a moment.");
      // Subscribe directly in the click handler so WebKit retains user activation.
      const subscriptionPromise=pushSetup.current.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushSetup.current.key});
      const sub=await subscriptionPromise;
      const id=oldId??Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
      await api("/api/push",{id,subscription:sub.toJSON(),rules:prefs.rules,symbols:symbols.join(",")});localStorage.setItem("market-lens-push-id",id);setAlertsEnabled(true);knownMatches.current=null;setNotice("Background alerts saved. The first valid observation establishes a baseline.");
    }catch(e){setError((e as Error).message);}finally{setPushBusy(false);}
  }
  async function testPush(){const id=localStorage.getItem("market-lens-push-id");if(!id||pushBusy)return;setPushBusy(true);try{await api("/api/push",{action:"test",id});setNotice("Test notification sent.");}catch(e){setError((e as Error).message);}finally{setPushBusy(false);}}
  useEffect(()=>{setAlertsEnabled(Boolean(localStorage.getItem("market-lens-push-id")));},[]);

  return <div className="app-shell">
    <aside className="rail"><a className="brand" href="/" aria-label="Market Lens home"><span className="brand-icon"><span/><span/><span/></span></a><div className="rail-divider"/><button title="Screener" aria-label="Screener" className={tab==="screener"?"active":""} onClick={()=>setTab("screener")}><SlidersHorizontal size={21}/></button><button title="Watchlist" aria-label="Watchlist" className={tab==="watchlist"?"active":""} onClick={()=>setTab("watchlist")}><Star size={21}/>{prefs.favorites.length>0&&<i/>}</button><button title="Alerts" aria-label="Alerts" className={tab==="alerts"?"active":""} onClick={()=>setTab("alerts")}><Bell size={21}/></button><div className="rail-bottom"><button title="How it works" aria-label="How it works" onClick={()=>setModal("help")}><CircleHelp size={21}/></button><button title="Data connection" aria-label="Data provider" onClick={()=>setModal("connect")}><Settings2 size={21}/></button><span className="avatar">MC</span></div></aside>
    <div className="workspace">
      <header className="topbar"><div className="wordmark">market<span>lens</span><small>STOCK SCREENER</small></div><div className="topbar-right"><span className="private-label"><Eye size={13}/> Public site</span><span className={`data-status ${demo?"demo":""}`}><i/>{demo?"Demo workspace":stocks.length?providerLabel:"No data loaded"}</span><button className="button small" onClick={()=>setModal("connect")}><Link2 size={14}/>{providerLabel} <ChevronDown size={12}/></button></div></header>
      <main>
        {marketMode&&<div className="live-banner"><span><i/> Full market · {coverage?coverage.universe?`${coverage.covered.toLocaleString()} / ${coverage.universe.toLocaleString()} with daily history`:"Preparing the symbol universe":"Checking cache coverage"}</span><span>{coverage?.latest?`Latest refresh ${new Date(coverage.latest).toLocaleString()}`:""}{coverage&&coverage.checked>coverage.covered?` · ${coverage.checked-coverage.covered} without usable bars`:""}{coverage?.due?` · ${coverage.due.toLocaleString()} due for refresh`:""}</span></div>}
        {marketMode&&<p className="coverage-note">Price rules use the last completed daily close. Filters use saved daily, weekly, and two-hour history. {marketRows.length>0?`${marketRows.filter(row=>row.candidate).length.toLocaleString()} passed the first stage. `:""}{screenSignature&&screenSignature!==signature?"Filters changed. Select Apply filters.":"Import data can take a long time. Keep this tab open. Each completed batch is saved."}</p>}

        <div className="page-heading"><div><div className="eyebrow">YOUR MARKET, IN FOCUS</div><h1>{tab==="watchlist"?"Your watchlist":tab==="alerts"?"Signal alerts":"Find your next setup."}</h1><p>{tab==="watchlist"?"Keep the names that matter close. Apply your screen to your favorites.":tab==="alerts"?"See when a stock moves into your screen.":"One screen. Multiple timeframes. Conditions that work together."}</p></div><div className="heading-actions">{marketMode&&<button className="button" disabled={scanning||importing||testing} onClick={()=>void importMarket()}><Download size={15}/> {importing?"Importing…":"Import data"}</button>}<button className="button" onClick={()=>void shareScreen()}><Link2 size={15}/> Share</button><button className="button" onClick={()=>{setFiveMode(false);setPrefs(p=>({...p,universe:"starter"}));setLoadedUniverse("starter");setStocks(makeDemo());setDemo(true);demoRef.current=true;setSelected("AAPL");}}><Eye size={15}/> Try demo</button><button className="button" onClick={()=>setModal("save")}><Plus size={15}/> Save screen</button><button className="button primary" disabled={scanning||testing||importing} onClick={()=>void runScan(false)}>{scanning?<LoaderCircle className="spin" size={16}/>:<Play size={15}/>} {scanning?"Screening…":marketMode?"Apply filters":"Run scan"}</button></div></div>
        {demo?<div className="demo-banner"><span className="demo-label"><Eye size={14}/> DEMO DATA</span><span>Illustrative prices shown until the first real scan loads.</span><button onClick={()=>setModal("connect")}>Data provider <ArrowRight size={15}/></button></div>:<div className="live-banner"><span><i/> {providerLabel} · {stocks.length?(provider==="alpaca"?"Delayed SIP":"Historical market data"):"Run a scan to load prices"}</span>{sharedSnapshot?.completedAt&&!demo&&<span>Shared scan {new Date(sharedSnapshot.completedAt).toLocaleString()} · {sharedSnapshot.returned}/{sharedSnapshot.requested} returned{sharedSnapshot.missing.length?` · ${sharedSnapshot.missing.length} missing`:""}{sharedSnapshot.oldestData?` · oldest history ${new Date(sharedSnapshot.oldestData).toLocaleString()}`:""}</span>}{updated&&<span>Data fetched {new Date(updated).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>}</div>}
        {marketMode&&importStatus&&<div className="live-banner" role="status"><span>{importStatus}</span>{importing&&<button className="button small" onClick={()=>{importStop.current=true;}}>Pause after batch</button>}</div>}
        {coverageNote&&<p className="coverage-note" role="status">{coverageNote} Daily and weekly data can still be screened.</p>}
        {error&&<div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError("")}><X size={16}/></button></div>}
        {(scanning||progress.total>0)&&<div className="scan-progress"><div><span>{scanning?"Screening":pendingRef.current.length||(marketMode&&marketJob.current&&!marketJob.current.dailyDone)?"Paused":"Complete"} · {progress.done.toLocaleString()} / {progress.total.toLocaleString()} symbols{!scanning&&scanTime!==null?` · ${fmt(scanTime,1)} s`:""}</span><span>{scanning?<button onClick={()=>{stopRef.current=true;}}><Pause size={12}/> Pause after batch</button>:(pendingRef.current.length>0||(marketMode&&marketJob.current&&!marketJob.current.dailyDone))?<button onClick={()=>void runScan(true)}><Play size={12}/> Resume</button>:null}</span></div><div className="progress-track"><i style={{width:`${progress.total?progress.done/progress.total*100:0}%`}}/></div>{missing.length>0&&<small>No returned prices: {missing.slice(0,15).join(", ")}{missing.length>15?` and ${missing.length-15} more`:""}</small>}</div>}
        <div className="stats-row"><div className="stat-card"><div className="stat-icon"><LayoutGrid size={18}/></div><div><span>{marketMode?"Symbols screened":"Symbols loaded"}</span><strong>{loadedCount.toLocaleString()}<small>US STOCKS & ETFS</small></strong></div></div><div className="stat-card"><div className="stat-icon mint"><Target size={18}/></div><div><span>Matching your screen</span><strong className="mint-text">{matching.length.toLocaleString()}<small>{loadedCount?Math.round(matching.length/loadedCount*100):0}% OF LOADED SYMBOLS</small></strong></div><div className="match-meter"><i style={{height:`${stocks.length?matching.length/stocks.length*100:0}%`}}/></div></div><div className="stat-card"><div className="stat-icon"><ListFilter size={18}/></div><div><span>Active conditions</span><strong>{activeRules}<small>ALL MUST MATCH</small></strong></div></div><div className="stat-card"><div className="stat-icon"><Clock3 size={18}/></div><div><span>Data refresh</span><strong>Manual<small>ON YOUR SCHEDULE</small></strong></div></div></div>
        <div className="content-grid">
          <aside className={`filter-panel ${showFilters?"mobile-open":""}`}><div className="panel-heading"><h2><SlidersHorizontal size={16}/> Your conditions</h2><button className="icon-button" title="Reset filters" aria-label="Reset filters" onClick={()=>setPrefs(p=>({...p,rules:DEFAULT_RULES.map(r=>({...r}))}))}><RotateCcw size={14}/></button></div><div className="filter-inner"><label className="field-label">SCAN UNIVERSE</label><button className="universe-button" onClick={()=>{setUniverseText(prefs.customSymbols);setModal("universe");}}><span><LayoutGrid size={15}/>{universe==="market"?"All US stocks & ETFs":universe==="watchlist"?"My watchlist":universe==="custom"?"Custom ticker list":universe==="sp500"?"S&P 500":universe==="nasdaq100"?"Nasdaq-100":universe==="etfs"?"Curated liquid ETFs":"Starter universe"}</span><ChevronDown size={14}/></button><div className="logic-label"><span>Match <b>all</b> conditions</span><span className="and-tag">AND</span></div><div className="rule-list">{prefs.rules.map((rule,index)=><div className={`rule-card ${!rule.enabled?"disabled":""}`} key={rule.id}><div className="rule-header"><label className="rule-check"><input aria-label={`Enable condition ${index+1}`} type="checkbox" checked={rule.enabled} onChange={e=>updateRule(rule.id,{enabled:e.target.checked})}/><span>{String(index+1).padStart(2,"0")}</span></label><select aria-label={`Condition ${index+1} indicator`} value={rule.metric} onChange={e=>updateRule(rule.id,{metric:e.target.value as Rule["metric"],value:e.target.value==="ema"?0:e.target.value==="rsi"?50:20})}><option value="ema">Price vs EMA</option><option value="rsi">RSI</option><option value="drawdown">Drawdown</option><option value="price">Price</option></select><button aria-label={`Remove condition ${index+1}`} className="remove-rule" onClick={()=>setPrefs(p=>({...p,rules:p.rules.filter(r=>r.id!==rule.id)}))}><X size={13}/></button></div>{(rule.metric==="rsi"||rule.metric==="ema")&&<div className="rule-inputs"><select aria-label={`Condition ${index+1} timeframe`} value={rule.timeframe} onChange={e=>updateRule(rule.id,{timeframe:e.target.value as Timeframe})}><option value="weekly">Weekly</option><option value="daily">Daily</option><option value="h2">2-hour</option></select><label><span>Length</span><input aria-label={`Condition ${index+1} period`} type="number" min="2" max="500" value={rule.period} onChange={e=>updateRule(rule.id,{period:Math.max(2,Math.min(500,Number(e.target.value)||2))})}/></label></div>}<div className="rule-inputs comparison"><select aria-label={`Condition ${index+1} comparison`} value={rule.op} onChange={e=>updateRule(rule.id,{op:e.target.value as Rule["op"]})}><option value="lt">{rule.metric==="ema"?"Distance < (%)":"Less than"}</option><option value="gt">{rule.metric==="ema"?"Distance > (%)":"Greater than"}</option></select><input aria-label={`Condition ${index+1} threshold`} type="number" value={rule.value} onChange={e=>updateRule(rule.id,{value:Number(e.target.value)})}/></div>{rule.metric==="ema"&&<p className="rule-hint">0% means above or below the EMA.</p>}{rule.metric==="drawdown"&&<p className="rule-hint">From the highest of up to 252 daily closes.</p>}</div>)}</div><button className="add-rule" disabled={prefs.rules.length>=20} onClick={()=>setPrefs(p=>({...p,rules:[...p.rules,{id:crypto.randomUUID(),metric:"rsi",timeframe:"daily",period:14,op:"lt",value:30,enabled:true}]}))}><Plus size={15}/> Add condition</button><label className="closed-toggle"><input type="checkbox" checked={prefs.closedOnly} onChange={e=>setPrefs(p=>({...p,closedOnly:e.target.checked}))}/><span>Use completed candles only<small>Keep forming bars out of indicators</small></span></label><div className="saved-screens"><label className="field-label">SAVED SCREENS <span>{prefs.savedScreens.length}</span></label>{prefs.savedScreens.length?prefs.savedScreens.map(s=><div key={s.name}><button onClick={()=>{setPrefs(p=>({...p,rules:s.rules.map(r=>({...r}))}));setNotice(`Loaded “${s.name}”`);}}><Filter size={13}/>{s.name}</button><button className="delete-screen" aria-label={`Delete screen ${s.name}`} onClick={()=>setPrefs(p=>({...p,savedScreens:p.savedScreens.filter(x=>x.name!==s.name)}))}><X size={12}/></button></div>):<p>Save a screen to find it here.</p>}</div><p className="save-state"><CheckCheck size={12}/>{saveState}</p></div><div className="filter-foot"><ShieldCheck size={15}/><p>Your screen. Your conditions.<br/><span>No sign-in needed.</span></p></div></aside>
          <section className="results-main">
            {tab==="alerts"?<div className="alerts-panel panel"><div className="panel-heading"><h2><Bell size={16}/> Screen entry alerts</h2><div><button className={`button small ${alertsEnabled?"primary":""}`} disabled={pushBusy} onClick={()=>void enableAlerts()}>{alertsEnabled?"Disable alerts":"Enable alerts"}</button>{alertsEnabled&&<button className="button small" disabled={pushBusy} onClick={()=>void testPush()}>Send test</button>}</div></div><div className="alerts-explainer"><div className="alert-illustration"><Bell size={30}/></div><h3>Catch the moment a setup appears.</h3><p>Opt in to browser push notifications when a stock enters your saved screen. On iPhone, first add this site to your Home Screen and open it there. Alerts use completed candles and support lists of up to 50 symbols.</p><div className="alert-settings"><span><Clock3 size={14}/> Checks run in scheduled batches when data is available; the first valid observation establishes a baseline.</span></div><p className="muted">Changes to your rules or universe require disabling and enabling alerts again. Missing or stale data is not treated as a match.</p></div><div className="alert-list">{alertLog.length?alertLog.map((a,i)=><div key={i}><span className="stat-icon mint"><Zap size={16}/></span><div><strong>{a.symbol} entered your screen {a.demo&&<small>DEMO</small>}</strong><p>{new Date(a.time).toLocaleString()}</p></div></div>):<div className="empty-state"><Activity size={24}/><h3>No new entries yet</h3><p>Push notifications appear in your device notification center. The first valid check establishes a baseline.</p></div>}</div></div>:<>
              {focused&&chartStock&&<div ref={chartAnchor} className={`panel chart-panel ${chartOpen?"chart-open":""}`}>
                {fiveMode?(currentFive?<IntradayChart data={currentFive} onFrame={f=>{setFiveMode(false);setFrame(f);}}/>:<div className="empty-chart"><p>{chartStatus||"Loading five-minute chart…"}</p><button className="button small" onClick={()=>setFiveMode(false)}>Back to screening chart</button></div>):<PriceChart stock={chartStock} frame={frame} range={range} closedOnly={prefs.closedOnly} rules={prefs.rules} allowFive={!demo&&provider==="alpaca"&&alpacaConnected} onFrame={f=>{setFiveMode(false);setFrame(f);}} onRange={setRange} onFive={()=>setFiveMode(true)}/>}
                <div className="chart-foot"><span className="chart-price">{fiveMode&&!currentFive?"—":`$${fmt(fiveMode&&currentFive?(currentFive.trade?.price??currentFive.bars.at(-1)?.c??null):chartStock.price)}`} <small>{fiveMode&&!currentFive?"waiting for 5-minute data":demo?"demo close":fiveMode?currentFive?.trade?"last IEX trade":"last 5-minute close":"latest delayed close"}</small></span><div><span>{demo?"Synthetic demo":provider!=="alpaca"?`${providerLabel} · refresh by scanning`:fiveMode&&currentFive?`${currentFive.feed==="iex"?"IEX single exchange":"SIP delayed ≥16 min"} · fetched ${new Date(currentFive.fetchedAt).toLocaleTimeString()}`:`SIP delayed ≥16 min · fetched ${new Date(chartStock.fetchedAt).toLocaleTimeString()}`}</span></div><button className="button small" disabled={demo||provider!=="alpaca"} onClick={()=>setChartRefresh(n=>n+1)}>Refresh chart</button></div>
                <div className="chart-context" role="status">{chartStatus||(demo?"Demo data does not refresh.":provider!=="alpaca"?"Chart uses the last scan from this provider.":fiveMode?"Chart checks for updates every minute while this tab is visible. Screen results update on a scan.":"Chart checks for updates every five minutes while this tab is visible. Screen results update on a scan.")}</div>
              </div>}
              <div className="panel results-panel"><div className="results-heading"><div className="results-title"><h2>{tab==="watchlist"?"Watchlist":"Screen results"}<span>{filtered.length}</span></h2><p>{nearOnly?"Exactly one missed condition; missing history excluded":matchesOnly?"Names that meet every active condition":"All loaded symbols, ranked by conditions met"}</p></div><div className="results-actions"><button className="button small filter-mobile" onClick={()=>setShowFilters(!showFilters)}><Filter size={14}/> Filters</button><button className="button small" onClick={exportCsv}><Download size={14}/> Export CSV</button></div></div><div className="table-toolbar"><label className="search-box"><Search size={15}/><input aria-label="Search symbols or companies" placeholder="Search symbol or company…" value={search} onChange={e=>setSearch(e.target.value)}/><span>/</span></label><select aria-label="Security type" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">Stocks & ETFs</option><option value="Stock">Stocks</option><option value="ETF">ETFs</option></select><select aria-label="Sort results" value={sort} onChange={e=>setSort(e.target.value)}><option value="match">Best match</option><option value="symbol">Symbol A–Z</option><option value="rsi">Lowest weekly RSI</option><option value="drawdown">Biggest drawdown</option><option value="price">Highest price</option></select></div><div className="result-view"><label><select aria-label="Results view" value={nearOnly?"near":matchesOnly?"matches":"all"} onChange={e=>{setNearOnly(e.target.value==="near");setMatchesOnly(e.target.value==="matches");}}><option value="matches">Matches</option><option value="near">Near matches (one missed rule)</option><option value="all">All loaded symbols</option></select></label><span>{demo?"Synthetic demo · USD":providerLabel+" · USD"}</span></div><div className="table-wrap"><table><thead><tr><th aria-label="Watchlist"/><th>Symbol</th><th className="numeric">Price</th>{prefs.rules.filter(r=>r.enabled).map((r,i)=><th key={r.id} className="numeric">{r.metric==="rsi"||r.metric==="ema"?`${r.metric==="ema"?"vs ":""}${TF_LABEL[r.timeframe]} ${r.metric.toUpperCase()}(${r.period})`:r.metric} {r.op==="gt"?">":"<"} {r.value}{r.metric==="ema"||r.metric==="drawdown"?"%":""}</th>)}<th>30 closes</th><th className="numeric">Match</th></tr></thead><tbody>{filtered.slice(0,200).map(e=><tr key={e.stock.symbol} className={focused?.symbol===e.stock.symbol?"selected":""} onClick={()=>selectSymbol(e.stock.symbol)}><td><button className={`favorite ${favorites.has(e.stock.symbol)?"on":""}`} aria-label={`${favorites.has(e.stock.symbol)?"Remove":"Add"} ${e.stock.symbol} ${favorites.has(e.stock.symbol)?"from":"to"} watchlist`} onClick={event=>{event.stopPropagation();toggleFavorite(e.stock.symbol);}}><Star size={15} fill={favorites.has(e.stock.symbol)?"currentColor":"none"}/></button></td><td><button className="symbol-button" onClick={()=>selectSymbol(e.stock.symbol)}><strong>{e.stock.symbol}<span>{e.stock.kind==="ETF"?"ETF":""}</span></strong><small>{e.stock.name}</small>{nearOnly&&(()=>{const i=e.ruleValues.findIndex((v,j)=>{const r=prefs.rules.filter(r=>r.enabled)[j];return v!==null&&(r.op==="gt"?v<=r.value:v>=r.value);});const r=prefs.rules.filter(r=>r.enabled)[i];const v=e.ruleValues[i];return r&&v!==null?<small>{r.metric.toUpperCase()} {fmt(Math.abs(v-r.value))} {r.metric==="ema"||r.metric==="drawdown"?"pp":"away"} from {r.op==="gt"?">":"<"} {r.value}</small>:null;})()}</button></td><td className="numeric price-cell" title={`Price bar starts ${new Date(e.stock.asOf).toLocaleString()}`}>${fmt(e.stock.price)}</td>{prefs.rules.filter(r=>r.enabled).map((r,i)=>{const v=e.ruleValues[i];const ok=v!==null&&(r.op==="gt"?v>r.value:v<r.value);return <td key={r.id} className={`numeric mono ${v===null?"muted":ok?"positive":"negative"}`} title={v===null?"Missing or insufficient history":ok?"Pass":`Missed by ${fmt(Math.abs(v-r.value))}${r.metric==="ema"||r.metric==="drawdown"?" percentage points":""}`} >{v===null?"Missing":`${fmt(v)}${r.metric==="ema"||r.metric==="drawdown"?"%":""} · ${ok?"Pass":"Fail"}`}</td>;})}<td><Sparkline values={e.stock.daily.slice(-30).map(b=>b.c)} positive={(e.stock.daily.at(-1)?.c??0)>=(e.stock.daily.at(-30)?.c??e.stock.daily[0]?.c??0)}/></td><td className="numeric"><span className={`match-badge ${e.match?"full":""}`}>{e.match&&<Check size={11}/>} {e.matched}/{e.total}</span></td></tr>)}</tbody></table></div>{filtered.length===0&&<div className="empty-state"><Target size={28}/><h3>{tab==="watchlist"&&!prefs.favorites.length?"Your watchlist starts here":"No symbols meet this view"}</h3><p>{tab==="watchlist"&&!prefs.favorites.length?"Star a symbol in the screener to add it here.":"Try disabling a condition, adjusting a threshold, or showing all symbols."}</p><button className="button small" onClick={()=>{setMatchesOnly(false);setNearOnly(false);setSearch("");setKind("all");if(tab==="watchlist"&&!prefs.favorites.length)setTab("screener");}}>Show all symbols</button></div>}<div className="table-footer"><span>Showing {Math.min(filtered.length,200)} of {filtered.length} results{filtered.length>200?" · export CSV for all results":""}</span><span><span className="keycap">↵</span> Click a row to inspect its chart</span></div></div>
            </>}
            <footer className="workspace-footer"><span><ShieldCheck size={12}/> {demo?"Illustrative data, not actual market prices":"Personal use · data coverage varies by provider"}</span><button onClick={()=>setModal("help")}>Data & methodology <ArrowUpRight size={12}/></button></footer>
          </section>
        </div>
      </main>
    </div>
    {notice&&<div className="toast" role="status"><Check size={17}/>{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice("")}><X size={14}/></button></div>}
    {modal&&<div className="modal-backdrop" onClick={()=>{setModal(null);setError("");}}><div role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`modal ${modal==="help"?"wide":""}`} onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" aria-label="Close dialog" onClick={()=>{setModal(null);setError("");}}><X size={19}/></button>
      {modal==="connect"&&<>
        <div className="modal-icon"><Activity size={24}/></div>
        <h2 id="modal-title">Data provider</h2>
        <label className="modal-label">Price history source
          <select value={provider} disabled={scanning||testing} onChange={e=>changeProvider(e.target.value as Provider)}>
            {Object.entries(PROVIDERS).map(([id,source])=><option key={id} value={id}>{source.name}</option>)}
          </select>
        </label>
        <p>{PROVIDERS[provider].note} {provider!=="alpaca"&&<a href={PROVIDERS[provider].url} target="_blank" rel="noreferrer">Provider details <ArrowUpRight size={12}/></a>}</p>
        {provider==="alpaca"?<div className="connection-success"><ShieldCheck size={16}/>{connected?"Shared Alpaca connection is ready.":"Shared Alpaca connection is unavailable."}</div>:<>
          <label className="modal-label">{connected?"Replace API key":"Your API key"}
            <input value={keyDraft} disabled={scanning||testing} onChange={e=>setKeyDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")useKey();}} type="password" autoComplete="off" maxLength={512} placeholder={connected?"Key set for this tab":"Paste your provider key"}/>
          </label>
          <div className="provider-actions">
            <button className="button small" disabled={scanning||testing||!keyDraft.trim()} onClick={useKey}>Use key for this tab</button>
            {connected&&<button className="button small" disabled={scanning||testing} onClick={()=>{setKeys(old=>({...old,[provider]:undefined}));setTests(old=>({...old,[provider]:undefined}));setKeyDraft("");resetProviderData(false);}}>Forget key</button>}
          </div>
          <p>Keys are used for your requests while this tab is open. No Market Lens sign-in is needed.</p>
        </>}
        <div className="provider-actions">
          <button className="button" disabled={!connected||scanning||testing} onClick={()=>void testProvider()}>{testing?"Testing…":"Test AAPL"}</button>
          <button className="button primary" disabled={!connected||scanning||testing||importing} onClick={()=>{setModal(null);void runScan();}}>{marketMode?"Apply filters":"Run scan"} <ArrowRight size={15}/></button>
        </div>
        {Object.keys(tests).some(id=>tests[id as Provider])&&<div className="provider-test" aria-live="polite">
          <strong>AAPL comparison</strong><small>Each test requests fresh data. Counts show bars received. A 200-week EMA needs 200 completed weekly bars.</small>
          <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Time</th><th>Weekly / Daily / 2H</th></tr></thead><tbody>
            {Object.entries(tests).map(([id,result])=>result&&<tr key={id}><td>{PROVIDERS[id as Provider].name}</td><td>{fmt(result.elapsed,1)} s</td><td>{result.stock?<>{result.stock.weekly.length} / {result.stock.daily.length} / {result.stock.h2.length}<small>As of {new Date(result.stock.asOf).toLocaleDateString()}{result.notice?" · "+result.notice:""}</small></>:<small>{result.error??"No price history returned."}</small>}</td></tr>)}
          </tbody></table></div>
        </div>}
        <details className="provider-test"><summary>Other sources we looked at</summary>{REFERENCE_SOURCES.map(source=><p key={source.name}><a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> · {source.note}</p>)}</details>
      </>}
      {modal==="universe"&&<><div className="modal-icon"><LayoutGrid size={24}/></div><h2 id="modal-title">Choose your universe.</h2><p>Start small or scan the listed US market in resumable batches.</p><div className="universe-options">{[{id:"starter",title:"Starter universe",description:"30 popular stocks and ETFs"},{id:"market",title:"All US stocks & ETFs",description:provider==="alpaca"?"Manually import daily, weekly, and two-hour history":"Available with Alpaca"},{id:"sp500",title:"S&P 500",description:"Current constituent list fetched on scan"},{id:"nasdaq100",title:"Nasdaq-100",description:`Dated list · ${NASDAQ_100_AS_OF}; may have changed`},{id:"etfs",title:"Curated liquid ETFs",description:"A curated list, not a live volume ranking"},{id:"watchlist",title:"My watchlist",description:`${prefs.favorites.length} starred symbols`},{id:"custom",title:"Custom ticker list",description:"Paste symbols separated by commas or spaces"}].map(u=><button key={u.id} disabled={u.id==="market"&&provider!=="alpaca"} className={universe===u.id?"chosen":""} onClick={()=>setPrefs(p=>({...p,universe:u.id}))}><div><strong>{u.title}</strong><small>{u.description}</small></div>{universe===u.id?<Check size={17}/>:<span className="radio-circle"/>}</button>)}</div>{universe==="custom"&&<label className="modal-label">Ticker symbols<textarea rows={5} value={universeText} onChange={e=>setUniverseText(e.target.value)} placeholder="AAPL, MSFT, SPY, VXX…"/><small>{parseSymbols(universeText).length} valid unique symbols</small></label>}<button className="button primary full-width" disabled={scanning||importing} onClick={()=>{setPrefs(p=>({...p,customSymbols:universeText}));pendingRef.current=[];marketJob.current=null;setProgress({done:0,total:0});setModal(null);setNotice("Universe updated.");}}>Use this universe <ArrowRight size={15}/></button></>}
      {modal==="save"&&<><div className="modal-icon"><Filter size={24}/></div><h2 id="modal-title">Save this screen.</h2><p>Keep your {activeRules} active conditions ready for the next scan.</p><label className="modal-label">Screen name<input autoFocus value={screenName} onChange={e=>setScreenName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveScreen();}} placeholder="Weekly trend, RSI pullback" maxLength={60}/></label><button className="button primary full-width" disabled={!screenName.trim()} onClick={saveScreen}>Save screen</button></>}
      {modal==="help"&&<><div className="modal-icon"><Activity size={24}/></div><h2 id="modal-title">Know what you’re screening.</h2><p>Market Lens calculates your indicators from cached close prices, so changing a filter does not require another data request.</p><div className="methodology"><section><h3>Data and timing</h3><p>Alpaca uses consolidated SIP history with a 16-minute safety delay and split adjustment. Other sources have their own delay, history and adjustment rules. Price is the last available close. All timestamps are shown in your device timezone.</p></section><section><h3>RSI and EMA</h3><p>RSI uses Wilder smoothing with an initial mean gain/loss. EMA starts from a simple mean of the first N closes. Weekly history depends on the provider and ticker. Insufficient history shows a dash and does not pass that condition.</p></section><section><h3>Two-hour candles</h3><p>Built from intraday closes where available during the regular 9:30 a.m.–4 p.m. New York session, anchored at 9:30. The final candle ends at 4 p.m. and is shorter. Early-close holidays can differ; compare your chart session settings before relying on exact matches.</p></section><section><h3>Completed candles</h3><p>Enabled by default. Daily and weekly indicators exclude the current unfinished calendar period; two-hour indicators exclude buckets whose end is later than the data cutoff. Weekly early-close holidays may remain excluded until the usual Friday close.</p></section><section><h3>Filters and table</h3><p>All enabled rules must pass. EMA conditions compare the last available price to the chosen EMA in percentage terms. The table shows each enabled condition, its actual value and pass, fail, or missing status. Drawdown uses up to 252 daily closing prices, rather than intraday highs. Shorter listings use available history. ETF labels are inferred from names.</p></section><section><h3>Refresh and alerts</h3><p>Background checks use saved histories and operate in batches. The first valid observation is a baseline; missing or stale data cannot trigger an alert. Browser push requires permission and supports up to 50 symbols. No trading actions are enabled.</p></section><section><h3>No sign-in</h3><p>Alpaca uses a shared backend connection and reuses prices cached within 15 minutes. Other providers use your own key for this tab. Their results and raw credentials are not saved to the shared cache. Your watchlist, filters, and saved screens stay in this browser.</p></section></div><button className="button primary full-width" onClick={()=>setModal(null)}>Back to my screen</button></>}
    </div></div>}
  </div>;
}
