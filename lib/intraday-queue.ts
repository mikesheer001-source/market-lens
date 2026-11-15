export type IntradayPending = {symbol:string;intraday_updated_at:number|null};
// Keep starred/default names first, then seed preset histories before refreshing stale ones.
export function sortIntradayQueue(rows:IntradayPending[],priority:Set<string>,preset:Set<string>):IntradayPending[]{
  const rank=(symbol:string)=>priority.has(symbol)?0:preset.has(symbol)?1:2;
  return rows.sort((a,b)=>rank(a.symbol)-rank(b.symbol)||(a.intraday_updated_at??0)-(b.intraday_updated_at??0)||a.symbol.localeCompare(b.symbol));
}
