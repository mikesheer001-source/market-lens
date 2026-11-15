"use client";
import {useEffect, useId, useMemo, useRef, useState} from "react";
import {priceScaleFromDrag, timeScaleFromDrag} from "@/lib/chart-gestures";
import {emaSeries, rsiSeries, hasOHLC, type Bar, type Rule} from "@/lib/market";

type Mode="candles"|"bars"|"line"|"area";
const fmt=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?"—":v.toLocaleString("en-US",{maximumFractionDigits:2,minimumFractionDigits:2});
export default function InteractiveChart({bars,identity,initialCount=150,rules=[]}:{bars:Bar[];identity:string;initialCount?:number;rules?:Rule[]}) {
 const [mode,setMode]=useState<Mode>("candles"),[ema,setEma]=useState(true),[rsi,setRsi]=useState(true),[ep,setEp]=useState(20),[rp,setRp]=useState(14),[ec,setEc]=useState("#e3bb6e"),[rc,setRc]=useState("#ca9ee6"),[up,setUp]=useState("#80d4bb"),[down,setDown]=useState("#e79591"),[log,setLog]=useState(false),[count,setCount]=useState(initialCount),[end,setEnd]=useState(bars.length),[hover,setHover]=useState<number|null>(null);
 const [priceScale,setPriceScale]=useState(1),[rsiLow,setRsiLow]=useState(30),[rsiHigh,setRsiHigh]=useState(70);
 const [editor,setEditor]=useState<"ema"|"rsi"|null>(null);
 const clipId=useId();
 const [settings,setSettings]=useState(false),[showRules,setShowRules]=useState(true),[volume,setVolume]=useState(false),[plotWidth,setPlotWidth]=useState(1000),[expanded,setExpanded]=useState(false); const drag=useRef<{x:number;end:number;pointerId:number}|null>(null); const axisDrag=useRef<{axis:"price"|"time";pointerId:number;x:number;y:number;scale:number;count:number;end:number}|null>(null); const lastTap=useRef<{axis:string;time:number;x:number;y:number}|null>(null); const emaLegend=useRef<HTMLButtonElement>(null),rsiLegend=useRef<HTMLButtonElement>(null); const plot=useRef<SVGSVGElement>(null); const previousLength=useRef(bars.length); const wrap=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=wrap.current;if(!el)return;const observer=new ResizeObserver(entries=>setPlotWidth(Math.max(290,Math.round(entries[0].contentRect.width))));observer.observe(el);return ()=>observer.disconnect();},[bars.length>0]);
 useEffect(()=>{const el=plot.current;if(!el)return;const wheel=(event:WheelEvent)=>{if(!event.ctrlKey)return;event.preventDefault();setCount(n=>Math.max(15,Math.min(Math.max(15,bars.length),Math.round(n*(event.deltaY<0?.8:1.25)))));};el.addEventListener("wheel",wheel,{passive:false});return ()=>el.removeEventListener("wheel",wheel);},[bars.length]);
 useEffect(()=>{setEnd(bars.length);setCount(initialCount);setPriceScale(1);setHover(null);previousLength.current=bars.length;},[identity,initialCount]);
 useEffect(()=>{const previous=previousLength.current;setEnd(current=>current>=previous?bars.length:Math.min(current,bars.length));previousLength.current=bars.length;},[bars.length]);
 const closes=useMemo(()=>bars.map(b=>b.c),[bars]); const emaValues=useMemo(()=>emaSeries(closes,ep),[closes,ep]); const rsiValues=useMemo(()=>rsiSeries(closes,rp),[closes,rp]);
 const last=bars.length?(end<=0?bars.length:Math.min(end,bars.length)):0,start=Math.max(0,last-count),shown=bars.slice(start,last); const hasCandles=shown.length>0&&shown.every(hasOHLC); const actual=(mode==="candles"||mode==="bars")&&!hasCandles?"line":mode;
 const W=plotWidth,H=326,L=12,R=65,T=14,B=44, width=W-L-R,height=H-T-B;
 const ruleRsis=rules.filter(r=>r.enabled&&r.metric==="rsi").map(r=>({rule:r,values:rsiSeries(closes,r.period)}));
 const ruleEmas=rules.filter(r=>r.enabled&&r.metric==="ema").map(r=>({rule:r,values:emaSeries(closes,r.period)}));
 const vals=shown.flatMap((b,i)=>[...(actual==="candles"||actual==="bars"?[b.h!,b.l!]:[b.c]),...(ema&&emaValues[start+i]!=null?[emaValues[start+i]!]:[])]).concat(showRules?ruleEmas.flatMap(e=>e.values.slice(start,last).flatMap(v=>v===null?[]:[v,v*(1+e.rule.value/100)])):[]).concat(showRules?rules.filter(r=>r.enabled&&r.metric==="price").map(r=>r.value):[]).filter(v=>Number.isFinite(v)&&(!log||v>0));
 const trans=(v:number)=>log?Math.log(v):v, inv=(v:number)=>log?Math.exp(v):v;
 const lo0=vals.length?Math.min(...vals.map(trans)):0,hi0=vals.length?Math.max(...vals.map(trans)):1,pad=(hi0-lo0)*.1||.01,mid=(hi0+lo0)/2,half=((hi0-lo0)/2+pad)*priceScale,lo=mid-half,hi=mid+half;
 const x=(i:number)=>L+(i+.5)*width/Math.max(1,shown.length),y=(v:number)=>T+(hi-trans(v))/(hi-lo)*height;
 const path=(values:(number|null)[], fn:(v:number)=>number)=>{let started=false;return values.map((v,i)=>{if(v===null||!Number.isFinite(v)||(log&&fn===y&&v<=0)){started=false;return "";} const cmd=started?"L":"M";started=true;return `${cmd}${x(i).toFixed(2)},${fn(v).toFixed(2)}`;}).join(" ");};
 const pricePath=path(shown.map(b=>b.c),y),emaPath=path(emaValues.slice(start,last),y),rsiPath=path(rsiValues.slice(start,last),v=>100-v*.85);
 const volumeMax=Math.max(...shown.flatMap(b=>typeof b.v==="number"&&Number.isFinite(b.v)&&b.v>=0?[b.v]:[]),1);
 const selected=hover===null?last-1:Math.max(start,Math.min(last-1,hover)), point=bars[selected];
 const zoom=(factor:number)=>{setCount(n=>Math.max(15,Math.min(Math.max(15,bars.length),Math.round(n*factor))));};
 const closeEditor=(which:"ema"|"rsi")=>{setEditor(null);requestAnimationFrame(()=>(which==="ema"?emaLegend.current:rsiLegend.current)?.focus());};
 const openIndicator=(which:"ema"|"rsi")=>setEditor(current=>current===which?null:which);
 const resetAxis=(axis:"price"|"time")=>{
  if(axis==="price") setPriceScale(1);
  else {setCount(initialCount);setEnd(bars.length);setHover(null);}
 };
 const axisDown=(axis:"price"|"time",e:React.PointerEvent<HTMLDivElement>)=>{
  e.stopPropagation();
  if(axisDrag.current || !e.isPrimary || (e.pointerType==="mouse" && e.button!==0)) return;
  axisDrag.current={axis,pointerId:e.pointerId,x:e.clientX,y:e.clientY,scale:priceScale,count:Math.min(count,bars.length),end:last};
  e.currentTarget.setPointerCapture(e.pointerId);
 };
 const axisMove=(e:React.PointerEvent<HTMLDivElement>)=>{
  e.stopPropagation();
  const state=axisDrag.current;
  if(!state || state.pointerId!==e.pointerId) return;
  if(state.axis==="price") setPriceScale(priceScaleFromDrag(state.scale,e.clientY-state.y));
  else {
   const next=timeScaleFromDrag(state.count,state.end,e.clientX-state.x,bars.length);
   setCount(next.count);setEnd(next.end);
  }
 };
 const axisUp=(e:React.PointerEvent<HTMLDivElement>)=>{
  e.stopPropagation();
  const state=axisDrag.current;
  if(!state || state.pointerId!==e.pointerId) return;
  axisDrag.current=null;
  if(e.type!=="pointerup") {lastTap.current=null;return;}
  if(Math.hypot(e.clientX-state.x,e.clientY-state.y)>8) {lastTap.current=null;return;}
  const now=Date.now(), previous=lastTap.current;
  if(previous?.axis===state.axis && now-previous.time<350 && Math.hypot(e.clientX-previous.x,e.clientY-previous.y)<24) {
   resetAxis(state.axis);lastTap.current=null;
  } else lastTap.current={axis:state.axis,time:now,x:e.clientX,y:e.clientY};
 };
 const indicatorEditor=(which:"ema"|"rsi")=>editor===which&&<div className="indicator-editor" role="group" aria-label={`${which.toUpperCase()} settings`} onKeyDown={e=>{if(e.key==="Escape")closeEditor(which);}}>
  <strong>{which.toUpperCase()} settings</strong>
  <label>Length <input type="number" min="2" max="500" step="1" aria-label={`${which.toUpperCase()} length`} value={which==="ema"?ep:rp} onChange={e=>{const v=Math.max(2,Math.min(500,Math.round(Number(e.target.value)||2)));which==="ema"?setEp(v):setRp(v);}}/></label>
  <label>Color <input type="color" aria-label={`${which.toUpperCase()} line color`} value={which==="ema"?ec:rc} onChange={e=>which==="ema"?setEc(e.target.value):setRc(e.target.value)}/></label>
  {which==="rsi"&&<><label>Lower guide <input type="number" min="0" max="100" step="1" aria-label="RSI lower guide" value={rsiLow} onChange={e=>setRsiLow(Math.max(0,Math.min(100,Math.round(Number(e.target.value)||0))))}/></label><label>Upper guide <input type="number" min="0" max="100" step="1" aria-label="RSI upper guide" value={rsiHigh} onChange={e=>setRsiHigh(Math.max(0,Math.min(100,Math.round(Number(e.target.value)||0))))}/></label></>}
  <button onClick={()=>closeEditor(which)} aria-label={`Close ${which.toUpperCase()} settings`}>Done</button>
 </div>;
 const pointer=(e:React.PointerEvent<SVGSVGElement>)=>{const rect=e.currentTarget.getBoundingClientRect();const i=Math.floor(((e.clientX-rect.left)/rect.width*W-L)/width*shown.length);setHover(Math.max(start,Math.min(last-1,start+i)));if(drag.current&&drag.current.pointerId===e.pointerId){const delta=Math.round((e.clientX-drag.current.x)/rect.width*count);setEnd(Math.max(Math.min(count,bars.length),Math.min(bars.length,drag.current.end-delta)));}};
 if(!bars.length)return <div className="empty-chart">No history is available for this timeframe.</div>;
 return <div ref={wrap} className={`interactive-chart ${expanded?"chart-expanded":""}`}>
  <div className="chart-options"><label>Price <select aria-label="Price chart style" value={mode} onChange={e=>setMode(e.target.value as Mode)}><option value="candles">Candles</option><option value="bars">OHLC bars</option><option value="line">Line</option><option value="area">Area</option></select></label><label>Scale <select aria-label="Price scale" value={log?"log":"linear"} onChange={e=>setLog(e.target.value==="log")}><option value="linear">Linear</option><option value="log">Logarithmic</option></select></label><button onClick={()=>setSettings(!settings)} aria-expanded={settings}>Indicators & style</button><button onClick={()=>zoom(.7)} aria-label="Zoom in">＋</button><button onClick={()=>zoom(1.4)} aria-label="Zoom out">−</button><button onClick={()=>{setCount(initialCount);setEnd(bars.length);setPriceScale(1);}}>Reset view</button><button onClick={()=>setPriceScale(1)} aria-label="Auto fit price scale">Auto price</button><button onClick={()=>{setEnd(bars.length);setHover(null);}}>Latest</button><button onClick={()=>{if(document.fullscreenElement)document.exitFullscreen();else if(wrap.current?.requestFullscreen)wrap.current.requestFullscreen().catch(()=>setExpanded(v=>!v));else setExpanded(v=>!v);}}>{expanded?"Close expanded":"Fullscreen"}</button></div>
  {settings&&<div className="chart-settings"><label><input type="checkbox" checked={showRules} onChange={e=>setShowRules(e.target.checked)}/> Screen overlays</label><label><input type="checkbox" checked={volume} onChange={e=>setVolume(e.target.checked)}/> Volume</label><label><input type="checkbox" checked={ema} onChange={e=>setEma(e.target.checked)}/> EMA</label><label>Period <input aria-label="EMA period" type="number" min="2" max="500" value={ep} onChange={e=>setEp(Math.max(2,Math.min(500,Math.round(Number(e.target.value)||2))))}/></label><label>Color <input aria-label="EMA color" type="color" value={ec} onChange={e=>setEc(e.target.value)}/></label><label><input type="checkbox" checked={rsi} onChange={e=>{setRsi(e.target.checked);if(!e.target.checked)setEditor(null);}}/> RSI</label><label>Period <input aria-label="RSI period" type="number" min="2" max="500" value={rp} onChange={e=>setRp(Math.max(2,Math.min(500,Math.round(Number(e.target.value)||2))))}/></label><label>Color <input aria-label="RSI color" type="color" value={rc} onChange={e=>setRc(e.target.value)}/></label><label>Up <input aria-label="Up color" type="color" value={up} onChange={e=>setUp(e.target.value)}/></label><label>Down <input aria-label="Down color" type="color" value={down} onChange={e=>setDown(e.target.value)}/></label></div>}
  {(mode==="candles"||mode==="bars")&&!hasCandles&&<div className="chart-context">OHLC history is unavailable for this selection. Showing actual closes as a line.</div>}
  <div className="chart-readout">{point&&<><span>{new Date(point.t).toLocaleString()}</span>{hasOHLC(point)&&<><span>O {fmt(point.o)}</span><span>H {fmt(point.h)}</span><span>L {fmt(point.l)}</span></>}<span>C {fmt(point.c)}</span>{ema&&<button ref={emaLegend} className="indicator-legend" style={{color:ec}} onClick={()=>openIndicator("ema")} aria-expanded={editor==="ema"} aria-label={`Edit EMA ${ep} settings`}>EMA({ep}) {fmt(emaValues[selected])} ⚙</button>}{rsi&&<span style={{color:rc}}>RSI({rp}) {fmt(rsiValues[selected])}</span>}</>}</div>
  {indicatorEditor("ema")}
  <div className="chart-plot-wrap"><svg ref={plot} className="interactive-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${identity} price chart. Drag to pan; use zoom controls to change the view.`} onPointerDown={e=>{if(drag.current||axisDrag.current||!e.isPrimary||(e.pointerType==="mouse"&&e.button!==0))return;drag.current={x:e.clientX,end:last,pointerId:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);pointer(e);}} onPointerMove={e=>{if(e.isPrimary&&(!drag.current||drag.current.pointerId===e.pointerId))pointer(e);}} onPointerUp={e=>{if(drag.current?.pointerId===e.pointerId)drag.current=null;}} onPointerCancel={e=>{if(drag.current?.pointerId===e.pointerId){drag.current=null;setHover(null);}}} onLostPointerCapture={e=>{if(drag.current?.pointerId===e.pointerId){drag.current=null;setHover(null);}}} onPointerLeave={e=>{if(e.pointerType!=="touch"&&!drag.current)setHover(null);}}>
  <defs><clipPath id={clipId}><rect x={L} y={T} width={width} height={height}/></clipPath></defs>
  {[0,.25,.5,.75,1].map(f=>{const v=inv(lo+(hi-lo)*f);return <g key={f}><line x1={L} x2={W-R} y1={y(v)} y2={y(v)} stroke="#344638" strokeDasharray="3 5"/><text x={W-R+6} y={y(v)+4} fill="#9aaf9c" fontSize="11">{fmt(v)}</text></g>})}
  <g clipPath={`url(#${clipId})`}>
  {actual==="area"&&<path d={`${pricePath} L${x(shown.length-1)},${H-B} L${x(0)},${H-B} Z`} fill={up} opacity=".13"/>}
  {(actual==="line"||actual==="area")&&<path d={pricePath} fill="none" stroke={up} strokeWidth="2"/>}
  {(actual==="candles"||actual==="bars")&&shown.map((b,i)=>{const color=b.c>=b.o!?up:down,bw=Math.max(1,Math.min(12,width/shown.length*.65));return <g key={`${b.t}-${i}`} stroke={color} fill={color}><line x1={x(i)} x2={x(i)} y1={y(b.h!)} y2={y(b.l!)} />{actual==="candles"?<rect x={x(i)-bw/2} width={bw} y={Math.min(y(b.o!),y(b.c))} height={Math.max(1,Math.abs(y(b.o!)-y(b.c)))}/>:<><line x1={x(i)-bw/2} x2={x(i)} y1={y(b.o!)} y2={y(b.o!)}/><line x1={x(i)} x2={x(i)+bw/2} y1={y(b.c)} y2={y(b.c)}/></>}</g>})}
  {showRules&&ruleEmas.map(({rule,values})=><g key={rule.id}><path d={path(values.slice(start,last),y)} fill="none" stroke="#e7d6a3" strokeWidth="1.5"/><path d={path(values.slice(start,last).map(v=>v===null?null:v*(1+rule.value/100)),y)} fill="none" stroke="#e7d6a3" strokeWidth="1" strokeDasharray="4 4"/></g>)}{showRules&&rules.filter(r=>r.enabled&&r.metric==="price"&&(!log||r.value>0)).map(r=><line key={r.id} x1={L} x2={W-R} y1={y(r.value)} y2={y(r.value)} stroke="#c8d8c0" strokeDasharray="4 4"/>)}
  {ema&&<path d={emaPath} fill="none" stroke={ec} strokeWidth="1.7"/>}{hover!==null&&selected>=start&&selected<last&&<line x1={x(selected-start)} x2={x(selected-start)} y1={T} y2={H-B} stroke="#9bad9d" strokeDasharray="3 3"/>}
  </g>
  {shown.length>0&&[0,.5,1].map(f=>{const i=Math.round((shown.length-1)*f);return <text key={f} x={x(i)} y={H-5} textAnchor={f===0?"start":f===1?"end":"middle"} fill="#9aaf9c" fontSize="10">{(identity.includes("5-minute")||identity.includes("h2")?new Date(shown[i].t).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):new Date(shown[i].t).toLocaleDateString())}</text>})}
  </svg>
  <div className="axis-target price-axis-target" role="slider" tabIndex={0} aria-label="Price scale" aria-valuemin={5} aria-valuemax={2000} aria-valuenow={Math.round(priceScale*100)} aria-valuetext={`${Math.round(priceScale*100)} percent of auto range`} title="Drag up or down to scale price; double tap to auto fit" style={{right:0,top:`${T/H*100}%`,width:`${R/W*100}%`,height:`${height/H*100}%`}} onPointerDown={e=>axisDown("price",e)} onPointerMove={axisMove} onPointerUp={axisUp} onPointerCancel={axisUp} onLostPointerCapture={axisUp} onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();setPriceScale(v=>priceScaleFromDrag(v,e.key==="ArrowUp"?-20:20));}if(e.key==="Home")resetAxis("price");}}><span>↕</span></div>
  <div className="axis-target time-axis-target" role="slider" tabIndex={0} aria-label="Time zoom" aria-valuemin={Math.min(15,bars.length)} aria-valuemax={bars.length} aria-valuenow={Math.min(count,bars.length)} aria-valuetext={`${Math.min(count,bars.length)} bars visible`} title="Drag left or right to zoom time; double tap to reset" style={{left:`${L/W*100}%`,bottom:0,width:`${width/W*100}%`,height:`${B/H*100}%`}} onPointerDown={e=>axisDown("time",e)} onPointerMove={axisMove} onPointerUp={axisUp} onPointerCancel={axisUp} onLostPointerCapture={axisUp} onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();const next=timeScaleFromDrag(Math.min(count,bars.length),last,e.key==="ArrowRight"?30:-30,bars.length);setCount(next.count);setEnd(next.end);}if(e.key==="Home")resetAxis("time");}}><span>↔</span></div>
  </div>
  {showRules&&ruleEmas.length>0&&<div className="chart-context">Screen overlays: {ruleEmas.map(({rule})=>`EMA(${rule.period}) and ${rule.value>=0?"+":""}${rule.value}% threshold`).join(" · ")}</div>}
  {volume&&(shown.some(b=>typeof b.v==="number")?<div className="interactive-rsi"><div>Volume</div><svg viewBox={`0 0 ${W} 80`} role="img" aria-label="Volume"><g fill="#6b9a7f">{shown.map((b,i)=>{if(typeof b.v!=="number"||!Number.isFinite(b.v)||b.v<0)return null;const h=b.v/volumeMax*65;return <rect key={b.t} x={x(i)-Math.max(1,width/shown.length*.3)} y={72-h} width={Math.max(1,width/shown.length*.6)} height={h}/>})}</g></svg></div>:<div className="chart-context">Volume is unavailable for this history.</div>)}
  {(rsi||(showRules&&ruleRsis.length>0))&&<div className="interactive-rsi"><div>{rsi&&<button ref={rsiLegend} className="indicator-legend" style={{color:rc}} onClick={()=>openIndicator("rsi")} aria-expanded={editor==="rsi"} aria-label={`Edit RSI ${rp} settings`}>Chart RSI ({rp}) · {fmt(rsiValues[selected])} ⚙</button>}{showRules&&ruleRsis.map(({rule,values})=><span key={rule.id} style={{color:"#e7d6a3"}}>Screen RSI ({rule.period}) · {fmt(values[selected])} {rule.op==="gt"?">":"<"} {rule.value} </span>)}</div>{indicatorEditor("rsi")}<svg viewBox={`0 0 ${W} 110`} role="img" aria-label="RSI indicator pane">{[rsiLow,50,rsiHigh].map((v,index)=><g key={index}><line x1={L} x2={W-R} y1={100-v*.85} y2={100-v*.85} stroke="#526552" strokeDasharray="3 5"/><text x={W-R+6} y={104-v*.85} fill="#9aaf9c" fontSize="11">{v}</text></g>)}{showRules&&rules.filter(r=>r.enabled&&r.metric==="rsi"&&r.value>=0&&r.value<=100).map(r=><line key={r.id} x1={L} x2={W-R} y1={100-r.value*.85} y2={100-r.value*.85} stroke="#e7d6a3" strokeDasharray="6 3"/>)}{rsi&&<path d={rsiPath} fill="none" stroke={rc} strokeWidth="1.7"/>}{showRules&&ruleRsis.map(({rule,values})=><path key={rule.id} d={path(values.slice(start,last),v=>100-v*.85)} fill="none" stroke="#e7d6a3" strokeWidth="1.5"/>)}{hover!==null&&selected>=start&&selected<last&&<line x1={x(selected-start)} x2={x(selected-start)} y1="10" y2="100" stroke="#9bad9d" strokeDasharray="3 3"/>}</svg></div>}
  <div className="chart-context">Drag chart to pan · drag price axis to scale or time axis to zoom · double tap an axis to reset · use + / − or Ctrl + wheel to zoom · indicators are chart-only and do not change screening conditions.</div>
 </div>;
}
