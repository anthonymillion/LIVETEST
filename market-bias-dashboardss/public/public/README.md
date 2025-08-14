# Market Bias Dashboard — Live (15s auto-refresh)

**Panels (left/right like your screenshot):**
- GOLD: COT (Quandl), Options (FMP), Macro Overlay (DXY, US10Y, VIX), Final Bias
- NASDAQ-100: COT (Quandl), Options (FMP), Breadth (FMP+StockData), Macro Overlay, Final Bias
- Bottom: Economic Calendar (FMP→EODHD), News (NewsAPI→Currents)

## Run
```bash
npm install
cp .env.sample .env   # paste your keys
npm start
# open http://localhost:3000
