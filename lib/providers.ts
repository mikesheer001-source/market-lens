export const PROVIDERS = {
  alpaca: { name: "Alpaca", batch: 6, note: "Shared connection. Delayed SIP with daily, weekly and 2-hour history." },
  businessquant: { name: "Business Quant", batch: 1, note: "Daily and recent minute history. The free plan has a daily request cap.", url: "https://businessquant.com/docs/api/overview" },
  fmp: { name: "Financial Modeling Prep", batch: 1, note: "Daily history. Intraday access and historical depth depend on your plan.", url: "https://site.financialmodelingprep.com/developer/docs" },
  finnhub: { name: "Finnhub", batch: 1, note: "The screener needs the stock-candles entitlement. A free key may only have access to quotes.", url: "https://finnhub.io/docs/api/stock-candles" },
  twelve: { name: "Twelve Data", batch: 1, note: "Daily, weekly and intraday bars where supported by your plan. Each timeframe uses a credit.", url: "https://twelvedata.com/docs" },
  alpha: { name: "Alpha Vantage", batch: 1, note: "Free daily and weekly bars. The free scan omits premium intraday history.", url: "https://www.alphavantage.co/support/#api-key" },
  tiingo: { name: "Tiingo", batch: 1, note: "Adjusted daily history and IEX intraday where your account has access.", url: "https://www.tiingo.com/pricing" },
  massive: { name: "Massive (Polygon)", batch: 1, note: "Two years of Basic history through the previous day, including intraday bars. Too short for a 200-week EMA.", url: "https://massive.com/pricing?product=stocks" },
  simfin: { name: "SimFin", batch: 1, note: "End-of-day stock history. The screener derives weekly closes and leaves 2-hour RSI blank.", url: "https://www.simfin.com/en/prices/" },
  eodhd: { name: "EODHD", batch: 1, note: "Free history is limited to a year. Intraday requires an eligible plan.", url: "https://eodhd.com/financial-apis/api-for-historical-data-and-volumes" },
  marketstack: { name: "Marketstack", batch: 1, note: "Free end-of-day history is limited to a year. This scan uses end-of-day data.", url: "https://marketstack.com/pricing/" },
} as const;

export type Provider = keyof typeof PROVIDERS;
export type Alternative = Exclude<Provider, "alpaca">;

export const REFERENCE_SOURCES = [
  {name:"SEC EDGAR", note:"Filings and fundamentals only. It has no historical market candles.", url:"https://www.sec.gov/search-filings/edgar-application-programming-interfaces"},
  {name:"Yahoo Finance / yfinance", note:"Unofficial access intended for personal use. No supported public screener feed.", url:"https://ranaroussi.github.io/yfinance/"},
  {name:"DefeatBeta", note:"Research dataset with periodic updates. No live market feed for scans.", url:"https://github.com/defeat-beta/defeatbeta-api"},
] as const;

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.hasOwn(PROVIDERS,value);
}
