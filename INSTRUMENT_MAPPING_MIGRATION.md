# Instrument Mapping Migration Report

## 1. Root cause

The watchlist/ticker showed data for indices but not for most equities because
of **two independent problems**:

1. **Wrong ISIN → instrument key mappings** in `frontend/src/lib/symbols.ts`
   and `frontend/src/components/TickerBar.tsx`. Several labels pointed at the
   *wrong* company's instrument key:

   | Label (claimed)     | Old instrument key (wrong)      | What it actually is | Correct instrument key            |
   |---------------------|----------------------------------|----------------------|-------------------------------------|
   | INFY                | `NSE_EQ\|INE148A01014`            | **Does not exist** in NSE MIS master | `NSE_EQ\|INE009A01021` |
   | RELIANCE            | `NSE_EQ\|INE009A01021`            | INFOSYS LIMITED      | `NSE_EQ\|INE002A01018` |
   | BAJFINANCE          | `NSE_EQ\|INE669C01036`            | TECH MAHINDRA LIMITED| `NSE_EQ\|INE296A01032` |
   | ITC                 | `NSE_EQ\|INE029A01011`            | BHARAT PETROLEUM CORP| `NSE_EQ\|INE154A01025` |
   | WIPRO               | `NSE_EQ\|INE117A01022`            | ABB INDIA LIMITED    | `NSE_EQ\|INE075A01022` |

   (TCS, HDFCBANK, SBIN, ICICIBANK, MARUTI were already correct.)

2. **Quote-response key mismatch** (the actual "indices load, stocks don't"
   symptom): Upstox's `/market-quote/quotes` and `/market-quote/ltp`
   endpoints return their response object keyed by `SEGMENT:TradingSymbol`
   (e.g. `NSE_EQ:INFY`), **not** by the `instrument_key` (`NSE_EQ|INE...`)
   that was sent in the request. `marketDataService.getQuotes()` previously
   passed the Upstox response straight through, so the frontend's
   `quotes[instrumentKey]` lookup never matched for `NSE_EQ:*` keys.

## 2. Single source of truth

### Backend — `backend/src/modules/market-data/instrument-mapping.ts`
Loads `backend/data/NSE_MIS.json` (1500 NSE_EQ instruments) and
`backend/data/MCX_MIS.json`, plus 3 static index entries
(`NSE_INDEX|Nifty 50`, `NSE_INDEX|Nifty Bank`, `BSE_INDEX|SENSEX`).

Exposes:
- `InstrumentMapping` (instrumentKey, canonicalSymbol, tradingSymbol, name, exchange, isin)
- `getAll()`, `resolve(input)`, `getInstrumentKey(input)`, `getCanonicalSymbol(input)`, `getTradingSymbol(input)`

`resolve()` accepts all three formats: `NSE_EQ|INE009A01021`, `NSE_EQ:INFY`, `INFY`.

### Frontend — `frontend/src/lib/instrument-mapping.ts`
Curated mapping table for the default watchlist/ticker symbols (corrected
ISINs above) plus the same `resolve` / `getInstrumentKey` / `getCanonicalSymbol`
/ `symbolLabel` / `isIndexSymbol` helpers, and the derived `INSTRUMENT_DIRECTORY`,
`SYMBOL_LABELS`, `DEFAULT_WATCHLIST` exports (same shapes as the old `symbols.ts`).

`frontend/src/lib/symbols.ts` is now a thin `export * from './instrument-mapping'`
re-export kept only for backward compatibility — no logic lives there anymore.

## 3. Files changed

| File | Change |
|------|--------|
| `backend/src/modules/market-data/instrument-mapping.ts` | **New** — mapping layer |
| `backend/src/modules/market-data/market-data.service.ts` | `getQuotes` now normalizes requested symbols to instrument keys, calls Upstox, then **remaps the response from `SEGMENT:TradingSymbol` back to the originally requested identifier**. `getHistoricalCandles`, `getHistory`, `getLtp` now normalize via `getInstrumentKey` (accept any of the 3 formats). |
| `backend/src/modules/market-data/instrument.service.ts` | Rewritten to source data from `instrument-mapping.ts`; `InstrumentInfo` now includes `isin` and `canonicalSymbol`. Dead MCX-loading code removed. |
| `backend/src/modules/market-data/websocket.service.ts` | Subscriptions and `connectUpstoxFeed` instrument keys normalized via `getInstrumentKey`. |
| `frontend/src/lib/instrument-mapping.ts` | **New** — single source of truth, corrected ISIN mappings |
| `frontend/src/lib/symbols.ts` | Now re-exports `instrument-mapping.ts` (backward compat) |
| `frontend/src/components/Watchlist.tsx` | Imports from `instrument-mapping`; manual "Add Symbol" input is normalized via `getInstrumentKey` (accepts `NSE_EQ\|INE...`, `NSE_EQ:INFY`, or `INFY`) |
| `frontend/src/components/TickerBar.tsx` | Removed duplicated/incorrect hardcoded `WATCHLIST`/`SYMBOL_LABELS`; uses corrected keys + `symbolLabel()` from `instrument-mapping` |
| `frontend/src/components/HistoricalChart.tsx` | Import path updated to `instrument-mapping` |

## 4. Quote flow (end-to-end, now consistent)

```
Frontend symbol (any of: NSE_EQ|INE..., NSE_EQ:SYM, SYM)
  → marketApi.quotes(symbols) → GET /market/quotes?symbols=...
  → marketDataService.getQuotes()
      - instrumentMappingService.getInstrumentKey(requested) → instrument key for Upstox call
      - upstoxClient.getQuotes(instrumentKeys)  →  Upstox responds keyed by "SEGMENT:TradingSymbol"
      - instrumentMappingService.getCanonicalSymbol(requested) → look up that key in Upstox response
      - result[requested] = Quote   (same key the caller sent, round-tripped)
  → Frontend: quotes[symbol] now resolves correctly for both indices and equities
```

## 5. Validation

- `npx tsc --noEmit` passes for both `backend` and `frontend`.
- Verified all 10 default watchlist ISINs against `backend/data/NSE_MIS.json` (1500 entries) — all resolve to the correct trading symbol/company name now.

## 6. Known limitations / follow-ups (not addressed, out of scope for this fix)

- **MCX_FO commodity instrument keys are futures contracts with fixed expiry
  dates** (e.g. `MCX_FO|466583` = "GOLD FUT 05 AUG 26"). These will become
  stale once the contract expires and Upstox rolls to the next month — at
  that point `MCX_MIS.json` needs refreshing and the 5 commodity entries in
  both `instrument-mapping.ts` files updated to the new `instrument_key`s.
- `backend/data/NSE_MIS.json` / `MCX_MIS.json` are a curated 1500-instrument
  MIS subset, not the full ~47MB `NSE.json` master placed in the project
  root. If a desired stock isn't in the watchlist search results, it likely
  isn't in this MIS subset and would need to be added to `NSE_MIS.json` (the
  mapping layer picks it up automatically — no code change needed).
- No duplicate/unmapped instrument keys were found among the 10 default
  watchlist symbols, MCX commodities, or 3 indices after correction.
