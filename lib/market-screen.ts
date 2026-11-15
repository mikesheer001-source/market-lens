import { type Rule, type Stock, closedBars, metrics, passes, ruleValue, correctSecurityKind } from "./market";

export const DAILY_OWNER = "public-market-daily-v1";
export const UNIVERSE_OWNER = "public-universe-v1";
export const INTRADAY_OWNER = "public-market-intraday-v1";

export type ScreenRow = {
  stock: Stock;
  values: ReturnType<typeof metrics>;
  matched: number;
  total: number;
  match: boolean;
  candidate: boolean;
  ruleValues: (number|null)[];
};

export function isIntradayRule(rule:Rule) {
  return (rule.metric==="ema" || rule.metric==="rsi") && rule.timeframe==="h2";
}

export function dailyStock(stock:Stock):Stock|null {
  const daily=closedBars(stock,"daily",true);
  const last=daily.at(-1);
  return last?correctSecurityKind({...stock,daily,price:last.c,asOf:last.t,h2:[]}):null;
}

export function summarize(stock:Stock,rules:Rule[],closedOnly:boolean,includeIntraday:boolean):ScreenRow {
  const active=rules.filter(rule=>rule.enabled);
  // Evaluate every enabled rule independently, even when an earlier rule fails.
  // This makes near-match and missing-history reporting accurate.
  const ruleValues=active.map(rule=>ruleValue(stock,rule,closedOnly));
  const matched=active.filter((rule,i)=>ruleValues[i]!==null && (rule.op==="gt"?ruleValues[i]!>rule.value:ruleValues[i]!<rule.value)).length;
  const candidate=active.filter(rule=>!isIntradayRule(rule)).every(rule=>passes(stock,rule,closedOnly));
  return {
    stock:{...stock,weekly:[],daily:stock.daily.slice(-30),h2:[]},
    values:metrics(stock,closedOnly),ruleValues,matched,total:active.length,match:matched===active.length,candidate,
  };
}
