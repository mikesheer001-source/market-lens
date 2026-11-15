# Market Lens

A public stock and ETF screener. No account, sign-in, or API form is required. Alpaca credentials are encrypted with AES-256-GCM in D1; the encryption key `ALPACA_VAULT_KEY` is a Sites runtime secret.

The first visit starts a 30-symbol real scan if no cache exists. Visitors share cached historical prices. Filters, watchlists and saved screens are browser-local. Refresh and alerts require the page to stay open.

## Behavior

- The starting screen requires price above weekly EMA(200), weekly RSI(14) below 50, daily RSI(14) below 50, and two-hour RSI(14) below 50.
- Add, disable, remove, or edit AND-combined rules for RSI, price/EMA distance, price, and drawdown. Periods are adjustable from 2 to 500, subject to available history.
- Reference table columns always display RSI(14) and weekly EMA(200), independently of custom rule periods.
- Weekly data begins in 2016 where available; daily history is capped to 550 bars, and two-hour data to 300 bars from the latest 90 calendar days. Newly listed instruments may not have enough history to pass a condition.
- Historical SIP requests stop 16 minutes behind real time. A quoted price is the most recent fully elapsed 30-minute bar close, so it may be older. Read the price tooltip or CSV for its source timestamp.
- Prices are split-adjusted without dividend adjustment. RSI uses Wilder smoothing; EMA uses a simple mean seed.
- Two-hour candles use regular-session 30-minute bars anchored to 09:30 America/New_York. The 15:30–16:00 candle is shorter. Early-close holiday buckets and weekly periods use the ordinary session/week boundaries and can differ from a broker chart until the usual close.
- Drawdown uses the highest of up to 252 daily closes, not the 52-week intraday high. Shorter listings use available data.
- ETF names are inferred with a heuristic, rather than an authoritative security classification.
- All-US scanning uses Alpaca's tradable, active listed US stock/ETF assets. Scan batches contain up to two symbols; every pagination token is followed. The browser waits 5.2 seconds between batches. Rate-limit errors pause the scan with a resumable queue while the tab remains open. Returned records persist across reloads; the in-memory scan queue does not.
- Automatic refresh and entry alerts work only while the page stays open. The browser can throttle background tabs. There is no unattended job, email/SMS delivery, or trading implementation.
- Synthetic demo frames are independently generated illustrations and must not be treated as a consistent historical market dataset.

## Backend

`/api/market` exposes only fixed historical-price and listed-symbol operations. It uses runtime credentials exclusively, never credentials from visitors. Data lives under a dedicated public cache namespace; old private account rows are not exposed. Cached symbols are reused for 15 minutes. A D1 atomic global budget allows one upstream batch per five seconds; the browser waits 5.2 seconds between batches. Universe results are cached for one hour. Each batch accepts at most two validated symbols. Public visitors cannot overwrite credentials, delete a connection, or write shared preferences. No trading, account, or order endpoint is exposed.

The connection was installed through a protected one-time form and verified with actual historical SPY prices. The installation endpoint, form and temporary setup secret have been removed. Never place them in source, the browser bundle, or Git. The existing vault secret is retained. Old encrypted per-user connection rows remain unused.

Public market-data display may require redistribution permission from Alpaca and the exchanges. A free personal API plan by itself does not establish those rights.

## Validation

Run `node --experimental-strip-types --test tests/market.test.mjs tests/vault.test.mjs`, TypeScript checking and the Sites build helper before publication.
