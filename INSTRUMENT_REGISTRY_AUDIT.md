# Unified Instrument Registry — Audit Report

Generated as part of the production-grade unified instrument system overhaul.
The platform now sources **all** instrument identity, mapping, options-chain
and futures data exclusively from the official Upstox instrument master
files placed at the project root:

- `D:\algo2\NSE.json`
- `D:\algo2\MCX.json`
- `D:\algo2\BSE.json`

No instrument keys, ISINs, trading symbols, strikes, expiries or contract
lists are hardcoded anywhere in the codebase.

## 1. Load summary

| File      | Records | Valid  | Invalid |
|-----------|--------:|-------:|--------:|
| NSE.json  |  96,189 | 96,189 |       0 |
| MCX.json  |  15,716 | 15,716 |       0 |
| BSE.json  |  27,112 | 27,112 |       0 |
| **Total** | **139,017** | **139,017** | **0** |

All 139,017 records passed validation (`instrument_key`, `segment`,
`trading_symbol` all present and non-empty). 0 malformed records were
skipped.

## 2. Segment (exchange) breakdown

| Segment    | Count  |
|------------|-------:|
| NSE_FO     | 43,307 |
| NSE_COM    | 34,380 |
| MCX_FO     | 15,716 |
| BSE_EQ     | 12,658 |
| BCD_FO     |  9,474 |
| NSE_EQ     |  9,353 |
| NCD_FO     |  9,010 |
| BSE_FO     |  4,908 |
| NSE_INDEX  |    139 |
| BSE_INDEX  |     72 |

## 3. Derivatives — totals

Across NSE_FO, MCX_FO, BSE_FO, NCD_FO, BCD_FO and NSE_COM combined:

| Instrument type | Count  |
|------------------|-------:|
| PE (puts)        | 57,824 |
| CE (calls)       | 57,821 |
| FUT (futures)    |  1,123 |

267 distinct underlyings have at least one derivative contract indexed in
`byUnderlying`.

### Index & equity option/future sample (CE / PE / FUT)

| Underlying  | Total | CE   | PE   | FUT |
|-------------|------:|-----:|-----:|----:|
| NIFTY       | 1,779 |  877 |  899 |   3 |
| BANKNIFTY   | 1,097 |  547 |  547 |   3 |
| FINNIFTY    |   543 |  270 |  270 |   3 |
| RELIANCE    |   245 |  121 |  121 |   3 |

### MCX commodity option/future sample (CE / PE / FUT)

| Underlying  | Total  | CE    | PE    | FUT |
|-------------|-------:|------:|------:|----:|
| GOLD        | 15,093 | 7,538 | 7,538 |  17 |
| SILVER      |  4,924 | 2,457 | 2,457 |  10 |
| CRUDEOIL    |  1,752 |   870 |   870 |  12 |
| NATURALGAS  |    810 |   399 |   399 |  12 |
| COPPER      |    928 |   459 |   459 |  10 |
| ZINC        |    554 |   272 |   272 |  10 |
| ALUMINIUM   |     10 |     0 |     0 |  10 |
| LEAD        |     10 |     0 |     0 |  10 |

ALUMINIUM and LEAD currently have futures only (no listed options in the
master files) — this is expected and reflects the real Upstox data, not a
loader gap.

## 4. Identifier resolution & ambiguity handling

`instrument-registry.ts` builds five lookup maps in two passes:

1. **Pass 1 (cash/index instruments)** — populates `byInstrumentKey`,
   `byCanonicalSymbol`, `byIsin` (first-write-wins) and `byTradingSymbol`
   for all non-derivative instruments (types other than CE/PE/FUT).
2. **Pass 2 (derivatives)** — indexes CE/PE/FUT contracts into
   `byUnderlying` (grouped by `underlying_symbol`/`asset_symbol`), and fills
   any remaining `byTradingSymbol` gaps.

### Cross-listing / collision findings

- **3,797** bare trading symbols are duplicated across NSE_EQ and BSE_EQ
  (e.g. `RELIANCE`, `MARUTI`, `ITC`-style names that also exist on BSE).
  Because NSE.json is loaded before BSE.json and pass 1 only sets a bare
  symbol the first time it's seen, **bare-symbol and ISIN lookups resolve to
  the NSE_EQ instrument by default** (NSE-priority). The BSE instrument
  remains independently resolvable via its own `instrument_key` or
  `BSE_EQ:<symbol>` canonical form.
- **17,996** unique ISINs are present; **4,015** of them are cross-listed on
  more than one segment (typically NSE_EQ + BSE_EQ for the same company).
  The `byIsin` map applies the same first-write-wins (NSE-priority) rule, so
  `INE002A01018` → `NSE_EQ|INE002A01018` (RELIANCE on NSE), not the BSE
  listing.
- Bare symbol `GOLD` resolves to `NSE_COM|1` (`NSE_COM:GOLD`, type `COM`),
  not an MCX contract — this is a real non-derivative instrument present in
  NSE.json and wins the bare-symbol slot in pass 1 (cash/index instruments
  take priority over derivatives). MCX gold **futures** (`MCX_FO:GOLD FUT ...`)
  remain fully accessible via `getCurrentFuture('GOLD')` /
  `getFutureContracts('GOLD')`, which aggregate derivative contracts by
  underlying symbol across all segments (currently 17 GOLD futures contracts
  spanning NSE_COM and MCX_FO).

These are documented data characteristics of the authoritative master files,
not defects — no hardcoded overrides were introduced to "fix" them.

## 5. Performance

- Full registry build (139,017 records → 5 lookup maps + derivative index):
  ~0.3s (one-time, on first access; cached for process lifetime).
- 10,000 `resolve()` lookups: **6ms** (sub-microsecond per lookup, O(1) map
  access).

## 6. Architecture changes

### New files
- `backend/src/modules/market-data/instrument-loader.ts` — loads and
  validates `NSE.json` / `MCX.json` / `BSE.json` from the project root at
  first use; exposes `getAll()` and `getStats()`.
- `backend/src/modules/market-data/instrument-registry.ts` — single source
  of truth. Builds `byInstrumentKey`, `byCanonicalSymbol`, `byIsin`,
  `byTradingSymbol`, `byUnderlying`. Exposes:
  - `resolve(input)`, `getInstrumentKey`, `getCanonicalSymbol`,
    `getTradingSymbol`, `search`
  - Options: `getOptionContracts`, `getCEContracts`, `getPEContracts`,
    `getNearestExpiry`, `getATMStrike`, `getOptionChain`
  - Futures: `getFutureContracts`, `getCurrentFuture`, `getNextFuture`

### Rewritten files
- `backend/src/modules/market-data/instrument-mapping.ts` — now a thin
  backward-compatible wrapper delegating every method to
  `instrumentRegistry`. No `INSTRUMENT_MAP` table remains.
- `backend/src/modules/market-data/instrument.service.ts` — rebuilt on top
  of `instrumentRegistry`; adds `resolve`, `search` (multi-exchange),
  `getOptionChain`, `getFutureContracts`, `getCurrentFuture`,
  `getNextFuture`.
- `frontend/src/lib/instrument-mapping.ts` — the old hardcoded
  `INSTRUMENT_MAP`/`INSTRUMENT_DIRECTORY` table has been removed entirely.
  The frontend now resolves identifiers on demand via
  `GET /market/instruments/resolve`, caching results client-side
  (`resolveInstruments`, `useInstrumentDirectory` hook, `symbolLabel`,
  `getInstrumentKey`, `getCanonicalSymbol`). `DEFAULT_WATCHLIST` remains as a
  seed list of instrument keys only — no labels/ISINs/exchanges are
  hardcoded alongside it.
- `frontend/src/lib/symbols.ts` — unchanged deprecated re-export shim
  (`export * from './instrument-mapping'`).

### New/extended API endpoints (`market-data.routes.ts`)
- `GET /market/instruments/search?q=&exchanges=&limit=` — multi-exchange
  search (previously NSE-only).
- `GET /market/instruments/resolve?symbols=a,b,c` — resolves any mix of
  instrument keys / canonical symbols / ISINs / bare symbols to full
  `InstrumentInfo` records (or `null` if unresolved).
- `GET /market/instruments/options?underlying=&expiry=` — option chain.
- `GET /market/instruments/futures?underlying=` — `{ current, next, all }`
  futures contracts.

### Frontend component updates
- `Watchlist.tsx` — drops the local `INSTRUMENT_DIRECTORY` filter, relies
  entirely on `/market/instruments/search`; resolves watchlist labels via
  `useInstrumentDirectory(symbols)`.
- `TickerBar.tsx` — index/watchlist lists are now plain instrument-key
  arrays (no hardcoded display labels); labels resolved via
  `useInstrumentDirectory` + `symbolLabel`.
- `HistoricalChart.tsx` — resolves the active symbol set via
  `useInstrumentDirectory(symbols)` before rendering labels.

## 7. Backward compatibility

- `market-data.service.ts` (`getQuotes`, `getLtp`, `getHistoricalCandles`,
  `getHistory`) and `websocket.service.ts` continue to call
  `instrumentMappingService.getInstrumentKey` / `getCanonicalSymbol`, which
  now transparently delegate to `instrumentRegistry`. Quote remap logic
  (Upstox responds with `SEGMENT:TradingSymbol` canonical keys, remapped back
  to the caller's requested identifier) is unchanged and verified working
  against the full 139K-record registry.
- All three supported identifier formats (instrument key, canonical symbol,
  bare trading symbol) plus ISIN resolve correctly end-to-end, including the
  RELIANCE NSE/BSE ISIN cross-listing case.
- Existing strategies (MACD, EMA, RSI, Breakout, Mean Reversion, Scalping)
  consume symbols through `market-data.service.ts` / `instrumentMappingService`
  and require no changes.

## 8. Build verification

- `cd backend && npx tsc --noEmit -p tsconfig.json` — **passes, 0 errors**.
- `cd frontend && npx tsc --noEmit -p tsconfig.json` — **passes, 0 errors**.
