import test from 'node:test';
import {sortIntradayQueue} from '../lib/intraday-queue.ts';
import assert from 'node:assert/strict';
import {rsi,rsiSeries,ema,aggregateTwoHour,closedBars,parseSymbols,passes,DEFAULT_RULES,makeDemo,inferSecurityKind,correctSecurityKind} from '../lib/market.ts';
test('Wilder RSI agrees with an independently checked 14-period vector',()=>{
 const closes=[44.34,44.09,44.15,43.61,44.33,44.83,45.1,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
 assert.ok(Math.abs(rsi(closes,14)-70.46413502109705)<1e-9);
 assert.equal(rsi(Array(20).fill(10)),50);
 assert.equal(rsi(Array.from({length:20},(_,i)=>i+1)),100);
 assert.equal(rsi(Array.from({length:20},(_,i)=>20-i)),0);
 assert.equal(rsi([1,2,3],14),null);
});
test('EMA uses an SMA seed and requires its full lookback',()=>{
 assert.equal(ema([1,2,3,4],3),3);assert.equal(ema(Array(220).fill(11),200),11);assert.equal(ema(Array(199).fill(10),200),null);
});
test('two-hour aggregation anchors to New York 09:30 across DST',()=>{
 const bars=[{t:'2026-07-06T13:00:00Z',c:99},{t:'2026-07-06T13:30:00Z',c:100},{t:'2026-07-06T15:00:00Z',c:104},{t:'2026-07-06T15:30:00Z',c:105},{t:'2026-07-06T19:30:00Z',c:106},{t:'2026-07-06T20:00:00Z',c:199},{t:'2026-11-02T14:30:00Z',c:200},{t:'2026-11-02T16:00:00Z',c:204}];
 const got=aggregateTwoHour(bars);
 assert.deepEqual(got,[{t:'2026-07-06T13:30:00.000Z',c:104,end:'2026-07-06T15:30:00.000Z'},{t:'2026-07-06T15:30:00.000Z',c:105,end:'2026-07-06T17:30:00.000Z'},{t:'2026-07-06T19:30:00.000Z',c:106,end:'2026-07-06T20:00:00.000Z'},{t:'2026-11-02T14:30:00.000Z',c:204,end:'2026-11-02T16:30:00.000Z'}]);
});
test('completed periods depend on the data cutoff, rather than the device clock',()=>{
 const s={...makeDemo()[0],fetchedAt:'2026-11-04T19:00:00Z',weekly:[{t:'2026-10-26T04:00:00Z',c:1},{t:'2026-11-02T05:00:00Z',c:2}],daily:[{t:'2026-11-03T05:00:00Z',c:1},{t:'2026-11-04T05:00:00Z',c:2}],h2:[{t:'2026-11-04T16:30:00Z',end:'2026-11-04T18:30:00Z',c:1},{t:'2026-11-04T18:30:00Z',end:'2026-11-04T20:30:00Z',c:2}]};
 assert.equal(closedBars(s,'weekly',true).length,1);assert.equal(closedBars(s,'daily',true).length,1);assert.equal(closedBars(s,'h2',true).length,1);assert.equal(closedBars(s,'weekly',false).length,2);
 const friday={...s,fetchedAt:'2026-11-06T21:15:00Z'};assert.equal(closedBars(friday,'weekly',true).length,2);
});
test('missing history fails enabled rules; parsing deduplicates and rejects invalid symbols',()=>{
 const s={...makeDemo()[0],weekly:[]};assert.equal(passes(s,DEFAULT_RULES[0],true),false);assert.equal(passes(s,{...DEFAULT_RULES[0],enabled:false},true),true);
 assert.deepEqual(parseSymbols(' aapl, MSFT AAPL;BRK.B\n invalid$$ SPY '),['AAPL','MSFT','BRK.B','SPY']);
});

test('security classification avoids the Netflix substring and repairs legacy cached entries',()=>{
 assert.equal(inferSecurityKind('Netflix, Inc.'),'Stock');
 assert.equal(inferSecurityKind('SPDR S&P 500 ETF Trust'),'ETF');
 assert.equal(inferSecurityKind('iShares Core S&P 500 ETF'),'ETF');
 assert.deepEqual(correctSecurityKind({symbol:'NFLX',name:'Netflix, Inc.',kind:'ETF'}),{symbol:'NFLX',name:'Netflix, Inc.',kind:'Stock'});
 assert.equal(correctSecurityKind({symbol:'SPY',name:'SPDR S&P 500 ETF Trust',kind:'ETF'}).kind,'ETF');
});
test('the parser retains all 503 constituents across 80-symbol prefetch batches',()=>{
 const symbols=Array.from({length:503},(_,i)=>`T${i}`);
 const parsed=parseSymbols(symbols.join(','));
 const batches=[];for(let i=0;i<parsed.length;i+=80)batches.push(...parseSymbols(parsed.slice(i,i+80).join(',')));
 assert.deepEqual(batches,symbols);
});

test('intraday prewarm prioritizes watched names, then missing preset history before stale rows',()=>{
 const rows=[{symbol:'AAA',intraday_updated_at:10},{symbol:'ZZZ',intraday_updated_at:null},{symbol:'WAT',intraday_updated_at:20},{symbol:'BBB',intraday_updated_at:5},{symbol:'OTH',intraday_updated_at:null}];
 assert.deepEqual(sortIntradayQueue(rows,new Set(['WAT']),new Set(['AAA','BBB','ZZZ'])).map(r=>r.symbol),['WAT','ZZZ','BBB','AAA','OTH']);
});

test('chart RSI series matches the screen RSI for every completed prefix',()=>{
 const prices=[44.34,44.09,44.15,43.61,44.33,44.83,45.1,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.0,47.1,45.2,45.2,47.0];
 for(const period of [2,5,14]){const series=rsiSeries(prices,period);for(let i=0;i<prices.length;i++){const expected=rsi(prices.slice(0,i+1),period);assert.equal(series[i],expected);}}
});
test('two-hour OHLC aggregates actual constituent bars without inventing missing values',()=>{
 const bars=[{t:'2026-03-09T13:30:00Z',o:10,h:13,l:9,c:12,v:100},{t:'2026-03-09T14:00:00Z',o:12,h:15,l:11,c:14,v:80}];
 const result=aggregateTwoHour(bars);
 assert.deepEqual({o:result[0].o,h:result[0].h,l:result[0].l,c:result[0].c,v:result[0].v},{o:10,h:15,l:9,c:14,v:180});
 const mixed=aggregateTwoHour([bars[0],{t:'2026-03-09T14:00:00Z',c:14}]);
 assert.equal(mixed[0].o,undefined); assert.equal(mixed[0].c,14);
});
