import fs from "fs";
import path from "path";
import axios from "axios";
import yahooFinance from "yahoo-finance2";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Charts klasörünü oluştur (public klasörü ile aynı seviyede)
const publicDir = path.resolve(__dirname, "../public");
const chartsDir = path.join(publicDir, 'charts');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
if (!fs.existsSync(chartsDir)) {
  fs.mkdirSync(chartsDir, { recursive: true });
}

// Popüler BIST hisseleri
const hisseler = [
	"ASELS.IS", "THYAO.IS", "GARAN.IS", "BIMAS.IS", "AKBNK.IS",
	"EREGL.IS", "SISE.IS", "PETKM.IS", "TUPRS.IS", "TAVHL.IS",
	"ISCTR.IS", "HALKB.IS", "VAKBN.IS", "YKBNK.IS", "TCELL.IS",
	"FROTO.IS", "TOASO.IS", "TSKB.IS", "TTRAK.IS", "MGROS.IS",
	"KCHOL.IS", "AKSUE.IS", "KRDMD.IS", "KOZAL.IS", "KOZAA.IS",
	"ARCLK.IS", "ENKAI.IS", "ISGYO.IS", "KAPLM.IS",
	"IHLGM.IS", "KORDS.IS", "KARSN.IS"
];

/**
 * In-memory cache
 * { [symbol]: { fiyat: number|null, tarih: string|null, error?: string } }
 */
let cacheData = {};
let lastUpdatedAt = null; // ISO string

// Coins cache
let coinsData = [];
let coinsUpdatedAt = null; // ISO string

// USD/TRY exchange rate cache
let usdTryRate = 32.5; // Default rate
let usdTryRateUpdatedAt = null; // ISO string

async function fetchHisseler() {
	const result = {};
	for (const hisse of hisseler) {
		try {
			const symbol = hisse.replace('.IS', '').toUpperCase();
			const tvSymbol = `BIST:${symbol}`;
			
			// Önce Yahoo Finance'tan çek
			let yahooData = null;
			try {
				const quote = await yahooFinance.quote(hisse, { fields: [
					"regularMarketPrice",
					"regularMarketTime",
					"regularMarketChange",
					"regularMarketChangePercent",
					"regularMarketPreviousClose",
					"regularMarketOpen",
					"regularMarketDayHigh",
					"regularMarketDayLow",
					"regularMarketVolume",
					"averageDailyVolume3Month",
					"marketCap",
					"currency",
					"exchange",
					"shortName",
					"longName"
				] });
				if (quote && typeof quote.regularMarketPrice === "number") {
					yahooData = {
						fiyat: Number(quote.regularMarketPrice),
						tarih: new Date(quote.regularMarketTime || Date.now()).toISOString(),
						degisim: typeof quote.regularMarketChange === "number" ? Number(quote.regularMarketChange) : null,
						degisimYuzde: typeof quote.regularMarketChangePercent === "number" ? Number(quote.regularMarketChangePercent) : null,
						oncekiKapanis: typeof quote.regularMarketPreviousClose === "number" ? Number(quote.regularMarketPreviousClose) : null,
						acilis: typeof quote.regularMarketOpen === "number" ? Number(quote.regularMarketOpen) : null,
						yuksek: typeof quote.regularMarketDayHigh === "number" ? Number(quote.regularMarketDayHigh) : null,
						dusuk: typeof quote.regularMarketDayLow === "number" ? Number(quote.regularMarketDayLow) : null,
						hacim: typeof quote.regularMarketVolume === "number" ? Number(quote.regularMarketVolume) : null,
						ortalamaHacim3A: typeof quote.averageDailyVolume3Month === "number" ? Number(quote.averageDailyVolume3Month) : null,
						piyasaDegeri: typeof quote.marketCap === "number" ? Number(quote.marketCap) : null,
						paraBirimi: quote.currency || "TRY",
						borsa: quote.exchange || null,
						ad: quote.shortName || null,
						uzunAd: quote.longName || null
					};
				}
			} catch (yahooErr) {
				console.warn(`⚠️ Yahoo Finance hatası ${hisse}:`, yahooErr?.message || yahooErr);
			}
			
			// TradingView'dan da çek (fallback veya ekstra veri için)
			let tvData = null;
			try {
				const tv = await import('@mathieuc/tradingview').catch(() => null);
				if (tv) {
					const client = new tv.TradingView();
					const quote = await client.getQuote(tvSymbol);
					if (quote && (quote.lp || quote.price)) {
						tvData = {
							price: Number(quote.lp ?? quote.price ?? 0),
							changePercent24h: Number(quote.chp ?? 0),
							high24h: Number(quote.high ?? 0),
							low24h: Number(quote.low ?? 0),
							volume: Number(quote.volume ?? 0),
							provider: 'tradingview',
							isDelayed: true
						};
					}
				}
			} catch (tvErr) {
				// TradingView hatası önemli değil, Yahoo verisi varsa onu kullanırız
				// Sessizce devam et
			}
			
			// Yahoo verisi varsa onu kullan, yoksa TradingView verisini kullan
			if (yahooData && yahooData.fiyat && yahooData.fiyat > 0) {
				result[hisse] = {
					...yahooData,
					// TradingView verilerini de ekle (eğer varsa ve farklıysa)
					tvPrice: tvData?.price || null,
					tvChangePercent24h: tvData?.changePercent24h || null,
					tvHigh24h: tvData?.high24h || null,
					tvLow24h: tvData?.low24h || null,
					tvVolume: tvData?.volume || null,
					updatedAt: new Date().toISOString()
				};
				console.log(`  ✅ ${symbol}: Fiyat ${yahooData.fiyat} TRY (Yahoo)`);
			} else if (tvData && tvData.price > 0) {
				// Sadece TradingView verisi varsa onu kullan
				result[hisse] = {
					fiyat: tvData.price,
					tarih: new Date().toISOString(),
					degisim: tvData.price * (tvData.changePercent24h / 100),
					degisimYuzde: tvData.changePercent24h,
					yuksek: tvData.high24h || null,
					dusuk: tvData.low24h || null,
					hacim: tvData.volume || null,
					piyasaDegeri: null,
					provider: 'tradingview',
					tvPrice: tvData.price,
					tvChangePercent24h: tvData.changePercent24h,
					tvHigh24h: tvData.high24h,
					tvLow24h: tvData.low24h,
					tvVolume: tvData.volume,
					updatedAt: new Date().toISOString(),
					ad: symbol,
					uzunAd: symbol,
					paraBirimi: "TRY",
					borsa: "BIST"
				};
				console.log(`  ✅ ${symbol}: Fiyat ${tvData.price} TRY (TradingView)`);
			} else {
				result[hisse] = { 
					fiyat: null, 
					tarih: null, 
					error: "Veri yok", 
					updatedAt: new Date().toISOString(),
					ad: symbol,
					uzunAd: symbol
				};
				console.log(`  ❌ ${symbol}: Veri alınamadı`);
			}
			
			// Rate limiting için kısa bekleme
			await new Promise(resolve => setTimeout(resolve, 200));
		} catch (e) {
			result[hisse] = { fiyat: null, tarih: null, error: e?.message || String(e), updatedAt: new Date().toISOString() };
		}
	}
	return result;
}

async function updateCache() {
	try {
		const startTime = Date.now();
		console.log(`\n⏳ [${new Date().toISOString()}] Tüm hisselerin verileri çekiliyor ve JSON'a kaydediliyor...`);
		cacheData = await fetchHisseler();
		lastUpdatedAt = new Date().toISOString();

		// Başarılı ve başarısız veri sayısını hesapla
		const successCount = Object.values(cacheData).filter(item => item.fiyat !== null && item.fiyat > 0).length;
		const errorCount = Object.values(cacheData).filter(item => !item.fiyat || item.fiyat <= 0).length;

		// Yazılacak dosya yolları
		const publicDir = path.resolve(__dirname, "../public");
		const jsonPath = path.join(publicDir, "hisseler.json");
		const txtPath = path.join(publicDir, "hisseler.txt");

		// public dizini mevcut değilse oluştur
		if (!fs.existsSync(publicDir)) {
			fs.mkdirSync(publicDir, { recursive: true });
		}

		// JSON yaz
		const jsonPayload = { updatedAt: lastUpdatedAt, data: cacheData };
		fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");

		// TXT yaz (TSV benzeri)
		const header = "SYMBOL\tFIYAT\tTARIH\tHATA";
		const lines = [header];
		for (const symbol of Object.keys(cacheData)) {
			const { fiyat, tarih, error } = cacheData[symbol];
			lines.push(`${symbol}\t${fiyat ?? ""}\t${tarih ?? ""}\t${error ?? ""}`);
		}
		fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

		const duration = ((Date.now() - startTime) / 1000).toFixed(1);
		console.log(`✅ [${lastUpdatedAt}] Güncelleme tamamlandı (${duration}s): ${successCount} başarılı, ${errorCount} hata`);
		console.log(`📄 Dosyalar yazıldı: public/hisseler.json, public/hisseler.txt\n`);
	} catch (e) {
		console.error(`❌ Güncelleme hatası:`, e);
	} finally {
		// 15 dakika sonra tekrar
		setTimeout(updateCache, 15 * 60 * 1000);
	}
}

// İlk yükleme ve periyodik güncellemeyi başlat
// Server başlar başlamaz hemen çalıştır (0 saniye bekleme)
console.log(`[${new Date().toISOString()}] Server başlatılıyor, ilk veri çekme işlemi başlatılıyor...`);
updateCache();

// --- COINS via TradingView/Yahoo Finance: fetch ALL cryptos every 15 minutes ---
async function fetchAllCryptos(limitPerPage = 250, maxPages = 100) {
  const out = [];
  const seenSymbols = new Set();
  
  // First try TradingView for popular cryptos
  try {
    const TradingView = await import('@mathieuc/tradingview').catch(() => null);
    if (TradingView) {
      const client = new TradingView.TradingView();
      // TradingView'dan daha fazla popüler coin çek
      const popularSymbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'DOTUSDT', 'MATICUSDT', 'AVAXUSDT',
        'LINKUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT', 'ETCUSDT', 'XLMUSDT', 'NEARUSDT', 'APTUSDT', 'FILUSDT', 'HBARUSDT',
        'ARBUSDT', 'VETUSDT', 'ICPUSDT', 'THETAUSDT', 'ALGOUSDT', '1000SATSUSDT', 'NEWTUSDT', 'SYRUPUSDT', 'OPUSDT', 'ARBUSDT',
        'INJUSDT', 'SUIUSDT', 'TIAUSDT', 'SEIUSDT', 'ORDIUSDT', 'RENDERUSDT', 'TAOUSDT', 'WLDUSDT', 'FETUSDT', 'RUNEUSDT',
        'MANTAUSDT', 'ONDOUSDT', 'JTOUSDT', 'FTMUSDT', 'SANDUSDT', 'AXSUSDT', 'THETAUSDT', 'GALAUSDT', 'CHZUSDT', 'ENJUSDT',
        'ZILUSDT', 'IOTAUSDT', 'BATUSDT', 'ZRXUSDT', 'OMGUSDT', 'QTUMUSDT', 'ZECUSDT', 'DASHUSDT', 'XMRUSDT', 'EOSUSDT',
        'TRXUSDT', 'XLMUSDT', 'NEOUSDT', 'IOSTUSDT', 'ONTUSDT', 'HOTUSDT', 'WINUSDT', 'ZILUSDT', 'BTTUSDT', 'DENTUSDT',
        'HIVEUSDT', 'STMXUSDT', 'SNXUSDT', 'AAVEUSDT', 'COMPUSDT', 'MKRUSDT', 'SUSHIUSDT', 'YFIUSDT', 'SFPUSDT', 'DYDXUSDT',
        'CRVUSDT', '1INCHUSDT', 'ENSUSDT', 'IMXUSDT', 'LRCUSDT', 'GRTUSDT', 'SKLUSDT', 'MANAUSDT', 'SANDUSDT', 'AUDIOUSDT',
        'ANKRUSDT', 'CTSIUSDT', 'FLMUSDT', 'DEGOUSDT', 'ALICEUSDT', 'KLAYUSDT', 'CTKUSDT', 'CHRUSDT', 'ALPHAUSDT', 'ZENUSDT',
        'STORJUSDT', 'KSMUSDT', 'WAVESUSDT', 'ANKRUSDT', 'CRVUSDT', 'DASHUSDT', 'ZECUSDT', 'HBARUSDT', 'IOSTUSDT', 'OMGUSDT',
        'BANDUSDT', 'ONTUSDT', 'ZILUSDT', 'NEOUSDT', 'ICXUSDT', 'VTHOUSDT', 'SCUSDT', 'QTUMUSDT', 'GASUSDT', 'XMRUSDT'
      ];
      
      // TradingView'dan coinleri toplu çek (batch işleme ile hızlandır)
      const batchSize = 10;
      for (let i = 0; i < popularSymbols.length; i += batchSize) {
        const batch = popularSymbols.slice(i, i + batchSize);
        await Promise.all(batch.map(async (sym) => {
          try {
            const quote = await client.getQuote(`BINANCE:${sym}`);
            const symbol = sym.replace('USDT', '');
            if (!seenSymbols.has(symbol) && quote && (quote.lp || quote.price)) {
              out.push({
                id: symbol.toLowerCase(),
                symbol: symbol,
                name: quote.short_name || quote.description || symbol,
                current_price: Number(quote.lp ?? quote.price ?? 0),
                price_change_24h: Number((quote.chp ?? 0) / 100 * (quote.lp ?? quote.price ?? 0)),
                price_change_percentage_24h: Number(quote.chp ?? 0),
                high_24h: Number(quote.high ?? 0),
                low_24h: Number(quote.low ?? 0),
                total_volume: Number(quote.volume ?? 0),
                market_cap: Number(quote.market_cap_basic ?? 0),
                market_cap_rank: out.length + 1,
                image: `https://cryptoicons.org/api/icon/${symbol.toLowerCase()}/200`
              });
              seenSymbols.add(symbol);
            }
          } catch (e) {
            // Skip if TradingView fails for this symbol
          }
        }));
        // Rate limiting için kısa bir bekleme
        if (i + batchSize < popularSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  } catch (e) {
    // TradingView not available, continue with Yahoo
  }
  
  // Then Yahoo Finance for all others (daha fazla coin için maxPages artırıldı)
  for (let page = 0; page < maxPages; page++) {
    const offset = page * limitPerPage;
    try {
      const scr = await yahooFinance.screener(
        { scrIds: 'all_cryptocurrencies_us', count: limitPerPage, offset },
        { fields: [
          'symbol','shortName','regularMarketPrice','regularMarketChange','regularMarketChangePercent',
          'regularMarketDayHigh','regularMarketDayLow','regularMarketVolume','marketCap'
        ]}
      );
      const items = scr?.quotes || [];
      if (!items.length) break;
      for (const q of items) {
        const sym = String(q.symbol || '').toUpperCase().replace('-USD', '');
        if (!seenSymbols.has(sym) && Number(q.regularMarketPrice || 0) > 0) {
          out.push({
            id: sym.toLowerCase(),
            symbol: sym,
            name: q.shortName || sym,
            current_price: Number(q.regularMarketPrice || 0),
            price_change_24h: Number(q.regularMarketChange || 0),
            price_change_percentage_24h: Number(q.regularMarketChangePercent || 0),
            high_24h: Number(q.regularMarketDayHigh || 0),
            low_24h: Number(q.regularMarketDayLow || 0),
            total_volume: Number(q.regularMarketVolume || 0),
            market_cap: Number(q.marketCap || 0),
            market_cap_rank: out.length + 1
          });
          seenSymbols.add(sym);
        }
      }
      if (items.length < limitPerPage) break; // last page
    } catch (e) {
      console.error('Yahoo screener hata:', e?.message || e);
      break;
    }
  }
  
  // Sort by market cap
  return out.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
}

async function updateCoinsYahoo() {
  const publicDir = path.resolve(__dirname, "../public");
  const coinsJsonPath = path.join(publicDir, 'coins.json');
  
  // Mevcut JSON'u oku (fallback için)
  let existingData = null;
  try {
    if (fs.existsSync(coinsJsonPath)) {
      const existingContent = fs.readFileSync(coinsJsonPath, 'utf8');
      existingData = JSON.parse(existingContent);
      console.log(`Mevcut coins.json yüklendi: ${existingData?.data?.length || 0} adet coin`);
    }
  } catch (e) {
    console.warn('Mevcut coins.json okunamadı:', e.message);
  }
  
  try {
    console.log(`[${new Date().toISOString()}] TradingView/Yahoo tüm kripto verileri güncelleniyor...`);
    const data = await fetchAllCryptos();
    
    // Eğer veri başarıyla çekildiyse ve boş değilse güncelle
    if (data && data.length > 0) {
      if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
      const payload = { updatedAt: new Date().toISOString(), data };
      fs.writeFileSync(coinsJsonPath, JSON.stringify(payload, null, 2), 'utf8');
      console.log(`✅ Tüm kripto dosyası yazıldı: public/coins.json (${data.length} adet kripto)`);
    } else {
      // Veri çekilemedi ama mevcut veri varsa onu koru
      if (existingData && existingData.data && existingData.data.length > 0) {
        console.warn('⚠️ Yeni veri çekilemedi, mevcut cache korunuyor:', existingData.data.length, 'adet coin');
        // Sadece updatedAt'i güncelle (opsiyonel)
        const payload = { ...existingData, lastAttemptAt: new Date().toISOString() };
        fs.writeFileSync(coinsJsonPath, JSON.stringify(payload, null, 2), 'utf8');
      } else {
        console.error('❌ Veri çekilemedi ve mevcut cache yok!');
      }
    }
  } catch (e) {
    console.error('❌ Kripto güncelleme hatası:', e.message || e);
    // Hata durumunda mevcut cache'i koru
    if (existingData && existingData.data && existingData.data.length > 0) {
      console.warn('⚠️ Hata nedeniyle mevcut cache korunuyor:', existingData.data.length, 'adet coin');
      try {
        const payload = { ...existingData, lastAttemptAt: new Date().toISOString(), error: e.message || 'Unknown error' };
        fs.writeFileSync(coinsJsonPath, JSON.stringify(payload, null, 2), 'utf8');
      } catch (writeErr) {
        console.error('Cache yazma hatası:', writeErr.message);
      }
    }
  } finally {
    setTimeout(updateCoinsYahoo, 15 * 60 * 1000);
  }
}

// İlk başlatmada coins.json kontrolü ve güncellemesi
(async () => {
  const publicDir = path.resolve(__dirname, "../public");
  const coinsJsonPath = path.join(publicDir, 'coins.json');
  
  // İlk başlatmada coins.json yoksa veya boşsa hemen güncelle
  try {
    if (!fs.existsSync(coinsJsonPath)) {
      console.log('⚠️ coins.json bulunamadı, ilk güncelleme başlatılıyor...');
      // updateCoinsYahoo zaten finally bloğunda periyodik güncellemeyi başlatacak
      updateCoinsYahoo();
      return;
    }
    
    const existingContent = fs.readFileSync(coinsJsonPath, 'utf8');
    const existingData = JSON.parse(existingContent);
    
    // Eğer dosya boşsa veya veri yoksa güncelle
    if (!existingData?.data || existingData.data.length === 0) {
      console.log('⚠️ coins.json boş, ilk güncelleme başlatılıyor...');
      // updateCoinsYahoo zaten finally bloğunda periyodik güncellemeyi başlatacak
      updateCoinsYahoo();
      return;
    }
    
    console.log(`✅ Mevcut coins.json yüklendi: ${existingData.data.length} adet coin`);
    
    // Periyodik güncellemeyi başlat (15 dakikada bir)
    setTimeout(updateCoinsYahoo, 15 * 60 * 1000);
  } catch (e) {
    console.error('İlk başlatmada coins.json kontrol hatası:', e.message);
    // Hata durumunda da güncellemeyi başlat (finally bloğu periyodik güncellemeyi başlatacak)
    updateCoinsYahoo();
  }
})();

// --- GLOBAL MARKET STATS: Fetch and cache every 15 minutes ---
async function fetchGlobalMarketStats() {
  try {
    console.log(`[${new Date().toISOString()}] Global market stats güncelleniyor...`);
    
    // CoinGecko Global API
    const globalResponse = await axios.get('https://api.coingecko.com/api/v3/global');
    const globalData = globalResponse.data.data;
    
    // USD/TRY kuru (TCMB veya basit bir API'den alınabilir, şimdilik sabit bir değer kullanabiliriz veya başka bir API)
    let usdTryRate = 32.5; // Varsayılan değer
    try {
      // TCMB API veya alternatif bir API'den USD/TRY alınabilir
      // Şimdilik CoinGecko'dan alabiliriz
      const tryResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=try');
      if (tryResponse.data && tryResponse.data['usd-coin']?.try) {
        usdTryRate = tryResponse.data['usd-coin'].try;
      }
    } catch (e) {
      console.warn('USD/TRY kuru alınamadı, varsayılan değer kullanılıyor:', e.message);
    }
    
    const marketStats = {
      updatedAt: new Date().toISOString(),
      usdTryRate: usdTryRate,
      data: {
        totalMarketCap: {
          usd: globalData.total_market_cap.usd,
          try: globalData.total_market_cap.usd * usdTryRate,
          change24h: globalData.market_cap_change_percentage_24h_usd || 0
        },
        totalVolume: {
          usd: globalData.total_volume.usd,
          try: globalData.total_volume.usd * usdTryRate,
          change24h: 0 // CoinGecko global API'de bu yok, hesaplanabilir
        },
        btcDominance: globalData.market_cap_percentage.btc || 0,
        activeCoins: globalData.active_cryptocurrencies || 0,
        fearGreedIndex: Math.floor(Math.random() * 100) // Mock - Fear & Greed API key gerekiyor
      }
    };
    
    const publicDir = path.resolve(__dirname, "../public");
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(
      path.join(publicDir, 'market-stats.json'),
      JSON.stringify(marketStats, null, 2),
      'utf8'
    );
    console.log(`Global market stats yazıldı: public/market-stats.json`);
  } catch (e) {
    console.error('Global market stats güncelleme hatası:', e);
  } finally {
    // 15 dakika sonra tekrar güncelle
    setTimeout(fetchGlobalMarketStats, 15 * 60 * 1000);
  }
}

// İlk yükleme ve periyodik güncellemeyi başlat
fetchGlobalMarketStats();
async function fetchCoins(limit = 100) {
	const url = "https://api.coingecko.com/api/v3/coins/markets";
	const params = {
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: 250,
    page: 1,
		sparkline: false,
		price_change_percentage: "24h"
	};
  const { data: page1 } = await axios.get(url, { params, headers: { "Accept": "application/json" } });
  const { data: page2 } = await axios.get(url, { params: { ...params, page: 2 }, headers: { "Accept": "application/json" } });
  return [...page1, ...page2];
}

async function updateCoins() {
	try {
		console.log(`[${new Date().toISOString()}] Coin verileri güncelleniyor...`);
    coinsData = await fetchCoins(500);
		coinsUpdatedAt = new Date().toISOString();

		const publicDir = path.resolve(__dirname, "../public");
		const jsonPath = path.join(publicDir, "coins.json");
		const txtPath = path.join(publicDir, "coins.txt");

		if (!fs.existsSync(publicDir)) {
			fs.mkdirSync(publicDir, { recursive: true });
		}

		// JSON: keep original CoinGecko structure array
		const jsonPayload = { updatedAt: coinsUpdatedAt, data: coinsData };
		fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");

		// TXT: id\tsymbol\tname\tprice\t24h%\tvolume
		const header = "ID\tSYMBOL\tNAME\tPRICE\tCHANGE_24H%\tVOLUME";
		const lines = [header];
		for (const c of coinsData) {
			lines.push(`${c.id}\t${c.symbol}\t${c.name}\t${c.current_price}\t${c.price_change_percentage_24h}\t${c.total_volume}`);
		}
		fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

		console.log(`[${coinsUpdatedAt}] Coin dosyaları yazıldı: public/coins.json, public/coins.txt`);
	} catch (e) {
		console.error("Coin güncelleme hatası:", e);
	} finally {
		setTimeout(updateCoins, 5 * 60 * 1000); // 5 dakika
	}
}
// TRY paritesi yaz
async function fetchCoinsTRY() {
  const url = "https://api.coingecko.com/api/v3/coins/markets";
  const params = {
    vs_currency: "try",
    order: "market_cap_desc",
    per_page: 250,
    page: 1,
    sparkline: false,
    price_change_percentage: "24h"
  };
  const { data: page1 } = await axios.get(url, { params, headers: { "Accept": "application/json" } });
  const { data: page2 } = await axios.get(url, { params: { ...params, page: 2 }, headers: { "Accept": "application/json" } });
  return [...page1, ...page2];
}

async function updateCoinsTRY() {
  try {
    console.log(`[${new Date().toISOString()}] Coin TRY verileri güncelleniyor...`);
    const coinsTRY = await fetchCoinsTRY();
    const publicDir = path.resolve(__dirname, "../public");
    const jsonPath = path.join(publicDir, "coins_try.json");
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ updatedAt: new Date().toISOString(), data: coinsTRY }, null, 2), "utf8");
    console.log(`Coin TRY dosyası yazıldı: public/coins_try.json`);
  } catch (e) {
    console.error("Coin TRY güncelleme hatası:", e);
  } finally {
    setTimeout(updateCoinsTRY, 5 * 60 * 1000);
  }
}

updateCoinsTRY();

updateCoins();

// --- GLOBAL STATS (every 15 minutes) ---
async function fetchGlobal() {
  const url = "https://api.coingecko.com/api/v3/global";
  const { data } = await axios.get(url, { headers: { "Accept": "application/json" } });
  return data;
}

// USD/TRY kuru çek (Yahoo Finance)
async function fetchUSDTRYRate() {
  try {
    console.log(`[${new Date().toISOString()}] USD/TRY kuru çekiliyor...`);
    const quote = await yahooFinance.quote('TRY=X', { fields: [
      "regularMarketPrice",
      "regularMarketTime",
      "regularMarketPreviousClose"
    ] });
    
    if (quote && typeof quote.regularMarketPrice === "number") {
      const rate = Number(quote.regularMarketPrice);
      console.log(`✅ USD/TRY kuru: ${rate}`);
      return {
        rate: rate,
        updatedAt: new Date(quote.regularMarketTime || Date.now()).toISOString(),
        previousClose: typeof quote.regularMarketPreviousClose === "number" ? Number(quote.regularMarketPreviousClose) : null
      };
    }
    throw new Error('USD/TRY kuru alınamadı');
  } catch (error) {
    console.error(`⚠️ USD/TRY kuru çekilirken hata:`, error?.message || error);
    // Mevcut kuru koru veya varsayılan değeri döndür
    return {
      rate: usdTryRate,
      updatedAt: usdTryRateUpdatedAt || new Date().toISOString(),
      previousClose: null,
      error: error?.message || String(error)
    };
  }
}

// USD/TRY kuru güncelle ve JSON'a kaydet
async function updateUSDTRYRate() {
  try {
    const rateData = await fetchUSDTRYRate();
    usdTryRate = rateData.rate;
    usdTryRateUpdatedAt = rateData.updatedAt;
    
    const publicDir = path.resolve(__dirname, "../public");
    const jsonPath = path.join(publicDir, "usd-try-rate.json");
    
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    const payload = {
      rate: usdTryRate,
      updatedAt: usdTryRateUpdatedAt,
      previousClose: rateData.previousClose,
      error: rateData.error || null
    };
    
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`✅ USD/TRY kuru kaydedildi: ${jsonPath} (${usdTryRate})`);
  } catch (error) {
    console.error('❌ USD/TRY kuru güncelleme hatası:', error?.message || error);
  }
}

async function updateGlobal() {
  try {
    console.log(`[${new Date().toISOString()}] Global veriler güncelleniyor...`);
    const globalData = await fetchGlobal();
    const publicDir = path.resolve(__dirname, "../public");
    const jsonPath = path.join(publicDir, "global.json");
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({ updatedAt: new Date().toISOString(), data: globalData }, null, 2), "utf8");
    console.log(`Global dosyası yazıldı: public/global.json`);
  } catch (e) {
    console.error("Global güncelleme hatası:", e);
  } finally {
    setTimeout(updateGlobal, 15 * 60 * 1000);
  }
}

updateGlobal();

// USD/TRY kuru güncelleme - server başlar başlamaz ve her 15 dakikada bir
updateUSDTRYRate();
setTimeout(function updateUSDTRYRateInterval() {
  updateUSDTRYRate();
  setTimeout(updateUSDTRYRateInterval, 15 * 60 * 1000);
}, 15 * 60 * 1000);

// --- AI PROXY (OpenRouter with Gemini) ---
const app = express();

// CORS ayarları - Railway için
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:8080',
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.SITE_URL,
    process.env.RENDER_EXTERNAL_URL,
  ].filter(Boolean),
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const SITE_URL = process.env.SITE_URL || "http://localhost:5173";

app.post("/api/ai/chat", async (req, res) => {
  try {
    const { messages, temperature = 0.7, max_tokens = 2000, model } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages zorunlu" });
    }

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: model || "google/gemini-2.0-flash-exp:free",
        messages: messages,
        temperature: temperature,
        max_tokens: max_tokens,
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": SITE_URL,
          "X-Title": "NEXONO",
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return res.json(response.data);
  } catch (err) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { error: String(err?.message || err) };
    console.error('[AI PROXY ERROR]', {
      status,
      error: data,
      apiKeyPrefix: OPENROUTER_API_KEY ? OPENROUTER_API_KEY.substring(0, 10) + '...' : 'MISSING',
    });
    
    // 401 hatası için daha detaylı mesaj
    if (status === 401) {
      return res.status(401).json({
        error: {
          message: 'API anahtarı geçersiz veya yetkisiz. Lütfen OpenRouter API anahtarınızı kontrol edin.',
          type: 'authentication_error',
          details: data.error || data,
        },
      });
    }
    
    return res.status(status).json(data);
  }
});

// Static files serving - Frontend build'i serve et
const distPath = path.resolve(__dirname, '../dist');
console.log(`[server] Checking dist directory at: ${distPath}`);
const distExists = fs.existsSync(distPath);
console.log(`[server] dist exists: ${distExists}`);

if (distExists) {
  app.use(express.static(distPath));
  console.log(`[server] ✅ Static assets served from ${distPath}`);

  app.get('/', (_req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    return res.status(404).json({
      error: 'index.html not found',
      hint: 'Frontend build missing. Please run npm run build before starting the server.'
    });
  });
} else {
  app.get('/', (_req, res) => {
    res.status(500).json({
      error: 'Frontend build not found',
      hint: 'dist directory missing. Ensure npm run build runs before starting the server.',
      distPath
    });
  });
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`[server] Server başlatıldı: http://${HOST}:${PORT}`);
  console.log(`[server] AI proxy dinlemede: http://localhost:${PORT}/api/ai/chat`);
  console.log(`[server] OpenRouter API Key: ${OPENROUTER_API_KEY ? OPENROUTER_API_KEY.substring(0, 15) + '...' : 'MISSING'}`);
  console.log(`[server] Model: google/gemini-2.0-flash-exp:free`);
});

// --- TradingView live quote endpoint (optimized with longer cache) ---
const tvCache = new Map(); // key -> { data, ts }
const tvErrorCache = new Map(); // key -> { count, lastError }

app.get('/api/tv/:symbol', async (req, res) => {
  let symbol = String(req.params.symbol || '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  
  // Symbol normalization: BIST: prefix'ini temizle
  symbol = symbol.replace('BIST:', '').replace('BIST%3A', '');
  
  const now = Date.now();
  const c = tvCache.get(symbol);
  
  // Cache for 30 seconds (increased from 5s to reduce API calls)
  if (c && now - c.ts < 30000) {
    return res.json(c.data);
  }
  
  // Rate limiting: if this symbol failed recently, return cached or skip
  const errInfo = tvErrorCache.get(symbol);
  if (errInfo && now - errInfo.lastError < 60000 && errInfo.count > 3) {
    // Return cached data if available, or return last known good data
    if (c) return res.json(c.data);
    return res.status(429).json({ error: 'rate_limited', cached: false });
  }
  
  try {
    let data = null;
    // BIST hisseleri için kontrol et
    const isBIST = hisseler.some(h => h.replace('.IS', '').toUpperCase() === symbol.toUpperCase());
    
    // Try TradingView-API if available
    try {
      const tv = await import('@mathieuc/tradingview');
      const client = new tv.TradingView();
      let sym;
      
      if (isBIST) {
        // BIST hisseleri için TradingView formatı: BIST:SYMBOL
        sym = `BIST:${symbol}`;
      } else if (symbol.includes(':')) {
        // Zaten formatlı (örn: BINANCE:BTCUSDT)
        sym = symbol;
      } else {
        // Crypto için default
        sym = `BINANCE:${symbol}USDT`;
      }
      
      const quote = await client.getQuote(sym);
      // BIST hisseleri gecikmeli, crypto canlı
      const isDelayed = isBIST || symbol.includes('.IS');
      data = {
        symbol: symbol,
        provider: 'tradingview',
        price: Number(quote.lp ?? quote.price ?? 0),
        changePercent24h: Number(quote.chp ?? 0),
        high24h: Number(quote.high ?? 0),
        low24h: Number(quote.low ?? 0),
        ts: now,
        isDelayed: isDelayed
      };
      // Reset error count on success
      tvErrorCache.delete(symbol);
    } catch (e) {
      // fallback to Yahoo
      try {
        let yahooSymbol;
        if (isBIST) {
          // BIST hisseleri için .IS ekle
          yahooSymbol = `${symbol}.IS`;
        } else {
          // Crypto için -USD ekle
          yahooSymbol = symbol.endsWith('-USD') ? symbol : `${symbol}-USD`;
        }
        
        const q = await yahooFinance.quote(yahooSymbol, { fields: [
          'regularMarketPrice','regularMarketChangePercent','regularMarketDayHigh','regularMarketDayLow'
        ]});
        // Yahoo Finance için de BIST kontrolü
        const isDelayed = isBIST || symbol.includes('.IS');
        data = {
          symbol,
          provider: 'yahoo',
          price: Number(q.regularMarketPrice || 0),
          changePercent24h: Number(q.regularMarketChangePercent || 0),
          high24h: Number(q.regularMarketDayHigh || 0),
          low24h: Number(q.regularMarketDayLow || 0),
          ts: now,
          isDelayed: isDelayed
        };
        // Reset error count on success
        tvErrorCache.delete(symbol);
      } catch (fallbackErr) {
        throw e; // Throw original error
      }
    }
    tvCache.set(symbol, { data, ts: now });
    return res.json(data);
  } catch (err) {
    // Track errors but don't spam console
    const errCount = (tvErrorCache.get(symbol)?.count || 0) + 1;
    tvErrorCache.set(symbol, { count: errCount, lastError: now });
    
    // Only log occasionally to reduce console noise
    if (errCount % 5 === 0) {
      console.warn(`TV endpoint error for ${symbol}:`, err?.message || 'Unknown error');
    }
    
    // Return cached data if available instead of error
    if (c) {
      return res.json(c.data);
    }
    
    return res.status(500).json({ error: 'tv_error', cached: false });
  }
});

// --- HISTORICAL DATA endpoint (Yahoo Finance) ---
const historyCache = new Map(); // key -> { data, ts }
app.get('/api/history/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  const period = req.query.period || '1y'; // 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
  const interval = req.query.interval || '1d'; // 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
  
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  
  const cacheKey = `${symbol}_${period}_${interval}`;
  const now = Date.now();
  const cached = historyCache.get(cacheKey);
  
  // Cache for 15 minutes
  if (cached && now - cached.ts < 900000) {
    return res.json(cached.data);
  }
  
  try {
    let yahooSymbol = symbol;
    
    // BIST hisseleri için .IS ekle
    // Eğer symbol BIST: ile başlıyorsa temizle
    let cleanSymbol = symbol.replace('BIST:', '').replace('BIST%3A', '');
    
    if (!cleanSymbol.includes('.') && !cleanSymbol.includes('-')) {
      // BIST hisseleri listesinde kontrol et
      if (hisseler.some(h => h.replace('.IS', '').toUpperCase() === cleanSymbol.toUpperCase())) {
        yahooSymbol = `${cleanSymbol}.IS`;
      } else {
        // Crypto olabilir, olduğu gibi kullan
        yahooSymbol = cleanSymbol;
      }
    } else {
      yahooSymbol = cleanSymbol;
    }
    
    // Period'u Yahoo Finance formatına çevir
    let period1, period2;
    const nowSeconds = Math.floor(Date.now() / 1000);
    
    switch (period) {
      case '1d':
        period1 = nowSeconds - (1 * 24 * 60 * 60);
        break;
      case '5d':
        period1 = nowSeconds - (5 * 24 * 60 * 60);
        break;
      case '1mo':
        period1 = nowSeconds - (30 * 24 * 60 * 60);
        break;
      case '3mo':
        period1 = nowSeconds - (90 * 24 * 60 * 60);
        break;
      case '6mo':
        period1 = nowSeconds - (180 * 24 * 60 * 60);
        break;
      case '1y':
        period1 = nowSeconds - (365 * 24 * 60 * 60);
        break;
      case '2y':
        period1 = nowSeconds - (2 * 365 * 24 * 60 * 60);
        break;
      case '5y':
        period1 = nowSeconds - (5 * 365 * 24 * 60 * 60);
        break;
      default:
        period1 = nowSeconds - (365 * 24 * 60 * 60); // Default 1 year
    }
    period2 = nowSeconds;
    
    // Yahoo Finance'tan geçmiş verileri çek
    const historical = await yahooFinance.historical(yahooSymbol, {
      period1: period1,
      period2: period2,
      interval: interval,
    });
    
    if (!historical || historical.length === 0) {
      // Fallback: cached data varsa onu döndür
      if (cached) {
        return res.json(cached.data);
      }
      return res.status(404).json({ error: 'Historical data not found', symbol: yahooSymbol });
    }
    
    // Format: timestamp ve price (close price)
    const formatted = historical.map(item => ({
      timestamp: new Date(item.date).getTime(),
      price: Number(item.close || 0),
      open: Number(item.open || 0),
      high: Number(item.high || 0),
      low: Number(item.low || 0),
      volume: Number(item.volume || 0),
    })).sort((a, b) => a.timestamp - b.timestamp);
    
    const result = {
      symbol: symbol,
      period: period,
      interval: interval,
      data: formatted,
      count: formatted.length
    };
    
    historyCache.set(cacheKey, { data: result, ts: now });
    
    return res.json(result);
  } catch (err) {
    console.error(`Historical data error for ${symbol}:`, err?.message || err);
    
    // Return cached if available
    if (cached) {
      return res.json(cached.data);
    }
    
    return res.status(500).json({ 
      error: 'Failed to fetch historical data', 
      message: err?.message || 'Unknown error',
      symbol: symbol 
    });
  }
});

// --- COIN/TL PARITELERI (every 10 minutes) ---
async function fetchCoinTLPairs() {
  try {
    const url = "https://api.coingecko.com/api/v3/coins/markets";
    const params = {
      vs_currency: "try",
      order: "market_cap_desc",
      per_page: 50,
      page: 1,
      sparkline: false,
      price_change_percentage: "24h"
    };
    const { data } = await axios.get(url, { params, headers: { "Accept": "application/json" } });
    return data;
  } catch (error) {
    console.error("Coin/TL pariteleri çekilirken hata:", error);
    return [];
  }
}

async function updateCoinTLPairs() {
  try {
    console.log(`[${new Date().toISOString()}] Coin/TL pariteleri güncelleniyor...`);
    const coinTLData = await fetchCoinTLPairs();
    const publicDir = path.resolve(__dirname, "../public");
    const jsonPath = path.join(publicDir, "coins-tl.json");
    
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    const jsonPayload = { 
      updatedAt: new Date().toISOString(), 
      data: coinTLData 
    };
    fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");
    console.log(`Coin/TL pariteleri yazıldı: public/coins-tl.json`);
  } catch (e) {
    console.error("Coin/TL pariteleri güncelleme hatası:", e);
  } finally {
    setTimeout(updateCoinTLPairs, 10 * 60 * 1000); // 10 dakika
  }
}

updateCoinTLPairs();

// --- YAHOO FINANCE CHART DATA (15 dakikada bir tüm hisseler için) ---
// In-memory cache (RAM'de tutulur, hızlı erişim için)
const chartCache = new Map(); // { "ASELS": { "1d": {...}, "1mo": {...}, ... }, timestamp }

async function fetchYahooChartData(symbol, interval, range) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (response.data && response.data.chart && response.data.chart.result && response.data.chart.result[0]) {
      const result = response.data.chart.result[0];
      const timestamps = result.timestamp || [];
      const quotes = result.indicators?.quote?.[0] || {};
      const closes = quotes.close || [];
      const opens = quotes.open || [];
      const highs = quotes.high || [];
      const lows = quotes.low || [];
      const volumes = quotes.volume || [];
      
      // Meta bilgileri de al
      const meta = result.meta || {};
      
      if (timestamps.length === 0 || closes.length === 0) {
        return null;
      }
      
      // GERÇEK FİYAT VERİLERİ ile DETAYLI grafik oluştur
      const chartData = timestamps.map((ts, index) => {
        const closePrice = closes[index];
        const openPrice = opens[index];
        const highPrice = highs[index];
        const lowPrice = lows[index];
        const volume = volumes[index] || 0;
        
        // Geçerli veri kontrolü
        if (closePrice === null || closePrice === undefined || isNaN(closePrice) || closePrice <= 0) {
          return null;
        }
        
        const timestamp = ts * 1000; // JavaScript timestamp (milliseconds)
        const date = new Date(timestamp);
        
        // Veri noktası için ek bilgiler
        const change = index > 0 ? closePrice - closes[index - 1] : 0;
        const changePercent = index > 0 && closes[index - 1] > 0 
          ? ((change / closes[index - 1]) * 100) 
          : 0;
        
        return {
          timestamp: timestamp,
          date: date.toISOString(),
          dateString: date.toLocaleDateString('tr-TR'), // Türkçe tarih formatı
          timeString: date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }), // Saat: Dakika
          
          // Fiyat verileri
          price: Number(closePrice.toFixed(2)), // Kapanış fiyatı (ana grafik için)
          open: openPrice ? Number(openPrice.toFixed(2)) : null,
          high: highPrice ? Number(highPrice.toFixed(2)) : null,
          low: lowPrice ? Number(lowPrice.toFixed(2)) : null,
          close: Number(closePrice.toFixed(2)),
          
          // Hacim verileri
          volume: volume || 0,
          volumeFormatted: volume >= 1000000 
            ? `${(volume / 1000000).toFixed(2)}M` 
            : volume >= 1000 
              ? `${(volume / 1000).toFixed(2)}K` 
              : volume.toString(),
          
          // Değişim verileri
          change: Number(change.toFixed(2)),
          changePercent: Number(changePercent.toFixed(2)),
          
          // Trend bilgisi
          isUp: change >= 0,
          isDown: change < 0,
          
          // OHLC spread (açılış-kapanış farkı)
          spread: highPrice && lowPrice ? Number((highPrice - lowPrice).toFixed(2)) : 0,
          
          // İşlem günü bilgisi
          dayOfWeek: date.toLocaleDateString('tr-TR', { weekday: 'long' }),
          month: date.getMonth() + 1,
          year: date.getFullYear()
        };
      }).filter(item => item !== null && item.price > 0 && !isNaN(item.price));
      
      // Verileri timestamp'e göre sırala (küçükten büyüğe)
      chartData.sort((a, b) => a.timestamp - b.timestamp);
      
      // Genel istatistikler hesapla
      const stats = chartData.length > 0 ? {
        dataPointCount: chartData.length,
        firstPrice: chartData[0].price,
        lastPrice: chartData[chartData.length - 1].price,
        highestPrice: Math.max(...chartData.map(d => d.high || d.price)),
        lowestPrice: Math.min(...chartData.map(d => d.low || d.price)),
        totalChange: chartData.length > 1 ? chartData[chartData.length - 1].price - chartData[0].price : 0,
        totalChangePercent: chartData.length > 1 && chartData[0].price > 0 
          ? ((chartData[chartData.length - 1].price - chartData[0].price) / chartData[0].price * 100).toFixed(2)
          : 0,
        totalVolume: chartData.reduce((sum, d) => sum + (d.volume || 0), 0),
        avgVolume: chartData.reduce((sum, d) => sum + (d.volume || 0), 0) / chartData.length
      } : null;
      
      return chartData.length > 0 ? {
        data: chartData,
        stats: stats,
        meta: {
          symbol: symbol,
          interval: interval,
          range: range,
          currency: meta.currency || 'TRY',
          exchangeName: meta.exchangeName || 'BIST',
          instrumentType: meta.instrumentType || 'EQUITY',
          firstTradeDate: meta.firstTradeDate || null,
          lastTradeDate: meta.tradingPeriods?.flat()[0]?.end || null
        }
      } : null;
    }
    return null;
  } catch (error) {
    console.error(`Yahoo chart data fetch error for ${symbol}:`, error.message);
    return null;
  }
}

async function updateStockCharts() {
  try {
    const startTime = Date.now();
    console.log(`\n⏳ [${new Date().toISOString()}] Tüm hisselerin grafik verileri güncelleniyor (GERÇEK FİYATLAR - SAAT SAAT)...`);
    
    // Her hisse için saatlik verileri çek (son 5 gün, saatlik interval)
    // Bu veriler daha sonra timeframe'lere göre filtrelenebilir
    const hourlyTimeframe = { name: 'hourly', interval: '1h', range: '5d' }; // Son 5 gün, saatlik
    
    // Ayrıca timeframe'ler için de veri çek
    const timeframes = [
      { name: '1d', interval: '1h', range: '5d' },      // Günlük: Son 5 gün, saatlik (günün tüm saatleri için)
      { name: '1mo', interval: '1d', range: '1mo' },    // Aylık: Son 30 gün, günlük (~30 nokta)
      { name: '3mo', interval: '1d', range: '3mo' },    // 3 Aylık: Son 90 gün, günlük (~90 nokta)
      { name: '1y', interval: '1d', range: '1y' }       // Yıllık: Son 365 gün, günlük (~365 nokta)
    ];
    
    let successCount = 0;
    let errorCount = 0;
    
    // Her hisse için (hisseler listesindeki tüm BIST hisseleri)
    for (const hisse of hisseler) {
      const symbol = hisse.replace('.IS', '').toUpperCase(); // ASELS.IS -> ASELS
      const chartData = {};
      let hasAnyData = false;
      
      // Önce saatlik verileri çek (tüm saatler için)
      try {
        const hourlyResult = await fetchYahooChartData(hisse, hourlyTimeframe.interval, hourlyTimeframe.range);
        if (hourlyResult && hourlyResult.data && hourlyResult.data.length > 0) {
          chartData[hourlyTimeframe.name] = {
            interval: hourlyTimeframe.interval,
            range: hourlyTimeframe.range,
            data: hourlyResult.data,
            stats: hourlyResult.stats || null,
            meta: hourlyResult.meta || null,
            count: hourlyResult.data.length,
            updatedAt: new Date().toISOString()
          };
          hasAnyData = true;
          console.log(`  ✅ ${symbol} saatlik: ${hourlyResult.data.length} veri noktası (Min: ${hourlyResult.stats?.lowestPrice}, Max: ${hourlyResult.stats?.highestPrice})`);
        }
      } catch (err) {
        console.error(`  ❌ Error fetching ${symbol} saatlik veri:`, err.message);
      }
      
      // Rate limiting için kısa bekleme
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Her timeframe için veri çek
      for (const tf of timeframes) {
        try {
          const result = await fetchYahooChartData(hisse, tf.interval, tf.range);
          if (result && result.data && result.data.length > 0) {
            chartData[tf.name] = {
              interval: tf.interval,
              range: tf.range,
              data: result.data,
              stats: result.stats || null,
              meta: result.meta || null,
              count: result.data.length,
              updatedAt: new Date().toISOString()
            };
            hasAnyData = true;
            console.log(`  ✅ ${symbol} ${tf.name}: ${result.data.length} veri noktası (Min: ${result.stats?.lowestPrice}, Max: ${result.stats?.highestPrice})`);
          } else {
            console.log(`  ⚠️ ${symbol} ${tf.name}: Veri yok`);
          }
        } catch (err) {
          console.error(`  ❌ Error fetching ${symbol} ${tf.name}:`, err.message);
        }
        
        // Rate limiting için kısa bekleme (Yahoo API'yi yormamak için)
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Hem RAM cache'e hem JSON dosyasına kaydet
      if (hasAnyData) {
        // RAM cache'e kaydet (hızlı erişim için)
        chartCache.set(symbol, {
          ...chartData,
          timestamp: Date.now()
        });
        
        // Disk'e kaydet (kalıcılık için)
        const chartFilePath = path.join(chartsDir, `${symbol.toLowerCase()}.json`);
        fs.writeFileSync(chartFilePath, JSON.stringify(chartData, null, 2), 'utf8');
        
        successCount++;
      } else {
        errorCount++;
      }
      
      // Her hisse arasında kısa bekleme
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ [${new Date().toISOString()}] Grafik güncelleme tamamlandı (${duration}s): ${successCount} başarılı, ${errorCount} hata\n`);
  } catch (error) {
    console.error('❌ Grafik güncelleme hatası:', error);
  } finally {
    // 15 dakika (900 saniye) sonra tekrar çalıştır
    setTimeout(updateStockCharts, 15 * 60 * 1000);
  }
}

// İlk çalıştırma ve periyodik güncelleme (server başladıktan 5 saniye sonra)
setTimeout(() => {
  updateStockCharts();
}, 5000);

// Grafik verilerini servis eden endpoint (Python örneğindeki gibi)
app.get('/api/chart/:symbol', (req, res) => {
  let symbol = String(req.params.symbol || '').toUpperCase();
  const timeframe = req.query.timeframe || '1d'; // 1d, 1mo, 3mo, 1y
  
  if (!symbol) {
    return res.status(400).json({ error: 'symbol required' });
  }
  
  // Symbol normalization: BIST: prefix'ini temizle ve .IS ekle
  symbol = symbol.replace('BIST:', '').replace('BIST%3A', '');
  
  // BIST hisseleri için .IS ekle (eğer yoksa)
  if (!symbol.includes('.') && !symbol.includes('-')) {
    // BIST hisseleri listesinde kontrol et
    if (hisseler.some(h => h.replace('.IS', '').toUpperCase() === symbol.toUpperCase())) {
      // Symbol zaten temiz (ASELS, THYAO gibi), direkt kullan
      // Cache'de ve dosyada .IS olmadan saklanıyor
    } else {
      // Crypto olabilir, olduğu gibi kullan
    }
  }
  
  try {
    // Önce RAM cache'den kontrol et (daha hızlı)
    const cached = chartCache.get(symbol);
    if (cached && cached[timeframe]) {
      return res.json({
        symbol,
        timeframe,
        ...cached[timeframe],
        source: 'cache'
      });
    }
    
    // RAM cache'de yoksa disk'ten oku
    const chartFilePath = path.join(chartsDir, `${symbol.toLowerCase()}.json`);
    
    if (!fs.existsSync(chartFilePath)) {
      return res.status(404).json({ 
        error: 'Chart data not found', 
        symbol,
        message: 'Veri henüz hazır değil. Lütfen birkaç dakika sonra tekrar deneyin.'
      });
    }
    
    const chartData = JSON.parse(fs.readFileSync(chartFilePath, 'utf8'));
    
    // RAM cache'e yükle (bir sonraki istek için)
    chartCache.set(symbol, {
      ...chartData,
      timestamp: Date.now()
    });
    
    if (chartData[timeframe]) {
      return res.json({
        symbol,
        timeframe,
        ...chartData[timeframe],
        source: 'disk'
      });
    }
    
    // Timeframe bulunamazsa tüm grafikleri döndür
    return res.json({
      symbol,
      timeframes: chartData,
      source: 'disk'
    });
  } catch (error) {
    console.error(`Chart data read error for ${symbol}:`, error);
    return res.status(500).json({ 
      error: 'Failed to read chart data',
      message: error.message 
    });
  }
});

// SPA routing - Tüm route'ları frontend'e yönlendir (API route'ları hariç)
// Express 5'te * wildcard desteklenmiyor, middleware kullanıyoruz
// Bu middleware'i TÜM API route'larından SONRA ekliyoruz
app.use((req, res, next) => {
  // API route'ları değilse frontend'e yönlendir
  if (!req.path.startsWith('/api') && !req.path.startsWith('/hisseler.json') && 
      !req.path.startsWith('/coins.json') && !req.path.startsWith('/coins_try.json') &&
      !req.path.startsWith('/usd-try-rate.json') && !req.path.startsWith('/coins-tl.json')) {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Frontend build not found' });
    }
  } else {
    next(); // API route'ları ve JSON dosyaları için next() çağır
  }
});


