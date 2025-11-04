import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Building2, DollarSign, BarChart3, Calendar, Volume2, Sparkles, Wifi, WifiOff, Plus, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';
import { useRealTimePrices } from '@/hooks/useRealTimePrices';
import PriceChart from '@/components/charts/PriceChart';
import TradingViewEmbed from '@/components/charts/TradingViewEmbed';
import { useAuth } from '@/context/AuthContext';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import NexonoAIChat from '@/components/ai/NexonoAIChat';
import { addDoc, deleteDoc, doc } from 'firebase/firestore';

interface AssetData {
  symbol: string;
  name: string;
  type: 'crypto' | 'stock';
  price?: number;
  image?: string;
  marketCap?: number;
  volume24h?: number;
  change24h?: number;
  changePercent24h?: number;
  high24h?: number;
  low24h?: number;
  supply?: number;
}

interface UserAsset {
  id: string;
  symbol: string;
  name: string;
  type: 'crypto' | 'stock';
  quantity: number;
  purchasePrice: number;
  addedAt: Date;
  image?: string;
}

const AssetDetail = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  // URL path'ine göre type'ı belirle
  const type: 'crypto' | 'stock' = location.pathname.startsWith('/crypto/') ? 'crypto' : 'stock';
  const { user } = useAuth();
  const [asset, setAsset] = useState<AssetData | null>(null);
  const [userAsset, setUserAsset] = useState<UserAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const { getPrice, calculatePnL } = useRealTimePrices();
  const [isFav, setIsFav] = useState(false);
  const [favId, setFavId] = useState<string | null>(null);
  const [tvPrice, setTvPrice] = useState<number | null>(null);
  const [tvChangePct, setTvChangePct] = useState<number | null>(null);
  const [isDataDelayed, setIsDataDelayed] = useState<boolean>(false);
  const [showTRYPrice, setShowTRYPrice] = useState<boolean>(true); // TRY paritesi göster
  const [cryptoTRY, setCryptoTRY] = useState<any>(null);
  const [yahooChartData, setYahooChartData] = useState<Array<{timestamp: number, price: number}>>([]);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    // Sayfa açıldığında AI analizi otomatik göster (mobilde kapalı)
    if (window.innerWidth >= 768) {
      setAiOpen(true);
    }
    setShowDetails(false);
    setActiveTab('overview');
    setIsDataDelayed(type === 'stock'); // Varsayılan olarak stock gecikmeli
  }, [symbol, type]);

  useEffect(() => {
    if (type && symbol) {
      loadAssetData();
    } else {
      setLoading(false);
      setError('Geçersiz URL parametreleri');
    }
  }, [type, symbol]);

  // TradingView verisi artık JSON'dan gelecek - anlık çekme yok
  // JSON'dan gelen veriler zaten 15 dakikada bir güncelleniyor
  useEffect(() => {
    // Stock için JSON'dan gelen verileri kullan
    if (type === 'stock' && asset) {
      // asset.price ve asset.changePercent24h zaten loadStockData'dan geliyor
      // JSON'dan gelen verileri state'e de set et (fallback için)
      if (asset.price !== undefined && asset.price !== null) {
        setTvPrice(asset.price); // JSON'dan gelen fiyat
        setTvChangePct(asset.changePercent24h || 0);
        setIsDataDelayed(true); // Stock her zaman gecikmeli (15 dk cache)
      }
    } else if (type === 'crypto') {
      // Crypto için de JSON'dan veri gelecek ama şimdilik TradingView kullanabiliriz
      // (crypto için ayrı bir JSON güncelleme mekanizması var)
      setIsDataDelayed(false);
    }
  }, [type, symbol, asset]);

  useEffect(() => {
    if (user && symbol) {
      loadUserAsset();
      // favori kontrolü
      (async () => {
        try {
          const favRef = collection(db, 'userFavorites');
          const qFav = query(favRef, where('userId','==',user.uid), where('symbol','==', symbol.toUpperCase()));
          const snap = await getDocs(qFav);
          if (!snap.empty) {
            setIsFav(true);
            setFavId(snap.docs[0].id);
          } else {
            setIsFav(false);
            setFavId(null);
          }
        } catch {}
      })();
    }
  }, [user, symbol]);

  // Hazır grafik verilerini çek (hisse senetleri için) - Backend'de 15 dk'da bir güncelleniyor
  const [selectedChartTimeframe, setSelectedChartTimeframe] = useState('1D');
  
  useEffect(() => {
    if (type === 'stock' && symbol) {
      const fetchChartData = async () => {
        setChartLoading(true);
        try {
          const stockSymbol = symbol.toUpperCase();
          
          // Timeframe'e göre backend'deki timeframe adını belirle
          // Backend'den yeterli veri çek, frontend'de timeframe'e göre filtrele
          let timeframe = '1d';
          switch (selectedChartTimeframe) {
            case '1D':
              timeframe = '1d'; // Günlük: 15m interval, 1d range (günün tüm saatleri)
              break;
            case '1W':
              timeframe = '1mo'; // Hafta için: 1mo'dan son 7 günü frontend'de filtreleyeceğiz
              break;
            case '1M':
              timeframe = '1mo'; // Aylık: 1d interval, 1mo range (30 gün)
              break;
            case '3M':
              timeframe = '3mo'; // 3 Aylık: 1d interval, 3mo range (90 gün)
              break;
            case '1Y':
              timeframe = '1y'; // Yıllık: 1d interval, 1y range (365 gün)
              break;
            default:
              timeframe = '1d';
          }
          
          // Hazır grafik verisini çek (backend'de 15 dk'da bir güncelleniyor)
          console.log(`[Chart] Grafik verisi çekiliyor: ${stockSymbol} ${timeframe}`);
          const response = await fetch(`/api/chart/${stockSymbol}?timeframe=${timeframe}`);
          
          if (response.ok) {
            const result = await response.json();
            console.log(`[Chart] API yanıtı:`, result);
            
            // API response formatı: { symbol, timeframe, data: [...], stats: {...}, meta: {...} }
            if (result.data && Array.isArray(result.data) && result.data.length > 0) {
              // Backend'den gelen data zaten formatlanmış, direkt kullan
              const formattedData = result.data.map((item: any) => ({
                timestamp: typeof item.timestamp === 'number' ? item.timestamp : new Date(item.timestamp || item.date).getTime(),
                price: typeof item.price === 'number' ? item.price : parseFloat(item.price || item.close || 0),
                open: item.open,
                high: item.high,
                low: item.low,
                volume: item.volume
              })).filter((item: any) => item.price > 0 && item.timestamp > 0);
              
              if (formattedData.length > 0) {
                setYahooChartData(formattedData);
                console.log(`✅ Grafik verisi yüklendi: ${stockSymbol} ${timeframe} - ${formattedData.length} nokta`, 
                  result.stats ? `(Min: ${result.stats.lowestPrice}, Max: ${result.stats.highestPrice})` : ''
                );
              } else {
                console.warn(`⚠️ Grafik verisi formatlanamadı: ${stockSymbol} ${timeframe}`);
                setYahooChartData([]);
              }
            } else {
              console.warn(`⚠️ Grafik verisi boş: ${stockSymbol} ${timeframe}`, result);
              setYahooChartData([]);
            }
          } else {
            // Fallback: Eski API'yi dene
            const errorText = await response.text();
            console.warn(`[Chart] Grafik verisi alınamadı (${response.status}): ${stockSymbol} ${timeframe}`, errorText);
            console.log(`[Chart] Fallback API deneniyor: /api/history/${stockSymbol}?period=${timeframe}&interval=${timeframe === '1d' ? '1h' : '1d'}`);
            
            const fallbackResponse = await fetch(`/api/history/${stockSymbol}?period=${timeframe}&interval=${timeframe === '1d' ? '1h' : '1d'}`);
            if (fallbackResponse.ok) {
              const fallbackData = await fallbackResponse.json();
              console.log(`[Chart] Fallback API yanıtı:`, fallbackData);
              if (fallbackData.data && Array.isArray(fallbackData.data) && fallbackData.data.length > 0) {
                const formatted = fallbackData.data.map((item: any) => ({
                  timestamp: typeof item.timestamp === 'number' ? item.timestamp : new Date(item.timestamp || item.date).getTime(),
                  price: typeof item.price === 'number' ? item.price : parseFloat(item.price || item.close || 0),
                  open: item.open,
                  high: item.high,
                  low: item.low,
                  volume: item.volume
                })).filter((item: any) => item.price > 0 && item.timestamp > 0);
                
                if (formatted.length > 0) {
                  setYahooChartData(formatted);
                  console.log(`✅ Fallback grafik verisi yüklendi: ${stockSymbol} - ${formatted.length} nokta`);
                } else {
                  console.warn(`⚠️ Fallback grafik verisi formatlanamadı`);
                  setYahooChartData([]);
                }
              } else {
                console.warn(`⚠️ Fallback grafik verisi boş`);
                setYahooChartData([]);
              }
            } else {
              const fallbackError = await fallbackResponse.text();
              console.error(`[Chart] Fallback API hatası (${fallbackResponse.status}):`, fallbackError);
              setYahooChartData([]);
            }
          }
        } catch (error) {
          console.error('Chart data fetch error:', error);
          setYahooChartData([]);
        } finally {
          setChartLoading(false);
        }
      };

      fetchChartData();
    }
  }, [type, symbol, selectedChartTimeframe]);

  // Timeframe değiştiğinde grafik verisini yeniden yükle
  const handleChartTimeframeChange = (newTimeframe: string) => {
    setSelectedChartTimeframe(newTimeframe);
  };

  // Computed values - HER ZAMAN ÇAĞRILMALI (early return'lerden önce)
  const currentPrice = asset ? getPrice(asset.symbol) : null;
  
  // Stock için öncelik: asset.price (JSON'dan) > tvPrice (JSON'dan gelen, fallback) > currentPrice
  // Crypto için: TRY paritesi > USD fiyatı
  const displayPrice = asset?.type === 'crypto' && cryptoTRY && showTRYPrice 
    ? cryptoTRY.current_price 
    : (asset?.type === 'crypto' && cryptoTRY && !showTRYPrice
      ? (asset?.price || tvPrice || currentPrice?.price || 0)
      : (asset?.type === 'stock'
        ? (asset?.price || tvPrice || currentPrice?.price || 0) // Stock için asset.price öncelikli (JSON'dan)
        : (tvPrice || currentPrice?.price || asset?.price || 0)));
  
  // Stock için JSON'dan gelen değişim verilerini kullan
  const change24h = asset?.type === 'stock'
    ? (asset?.change24h ?? (asset?.price && asset?.changePercent24h ? asset.price * (asset.changePercent24h / 100) : null) ?? 0)
    : (currentPrice?.change24h || asset?.change24h || 0);
  
  const changePercent24h = asset?.type === 'stock'
    ? (asset?.changePercent24h ?? tvChangePct ?? currentPrice?.changePercent24h ?? 0)
    : ((tvChangePct ?? currentPrice?.changePercent24h) || asset?.changePercent24h || 0);

  // Gerçek fiyat verilerine dayalı grafik verisi oluştur (random değil, deterministik)
  const chartData = useMemo(() => {
    if (!asset) return [];
    
    // Hisse senetleri için Yahoo Finance'tan gelen gerçek veriyi kullan
    if (type === 'stock' && yahooChartData.length > 0) {
      return yahooChartData;
    }
    
    // Eğer displayPrice 0 ise ve stock için asset.price varsa onu kullan
    // TradingView'dan gelen tvPrice'ı da kontrol et
    const priceForChart = displayPrice > 0 
      ? displayPrice 
      : (asset?.price || tvPrice || 0);
    
    // Eğer hiç fiyat yoksa, minimal bir grafik oluştur (kullanıcıya bilgi vermek için)
    if (priceForChart <= 0) {
      console.warn('[Chart] Fiyat bilgisi yok, grafik oluşturulamıyor', { displayPrice, assetPrice: asset?.price, tvPrice });
      return [];
    }
    
    const endPrice = priceForChart;
    const now = Date.now();
    
    // Hisse senetleri için fallback (Yahoo verisi yoksa)
    if (type === 'stock') {
      const startPrice = endPrice - (change24h || 0);
      const priceChangePercent = changePercent24h;
      
      const hoursInYear = 365 * 24;
      const interval = 6;
      const points = Math.floor(hoursInYear / interval);
      
      let seed = (asset.symbol?.charCodeAt(0) || 0) + (asset.symbol?.charCodeAt(1) || 0);
      
      const data = Array.from({ length: points }, (_, i) => {
        const t = points > 1 ? i / (points - 1) : 0;
        const baseTrend = startPrice + change24h * t;
        
        const volatility = Math.abs(priceChangePercent) / 100 * 0.5;
        const phase = (i * 0.1) + seed;
        const sineWave = Math.sin(phase) * volatility * 0.3;
        const cosineWave = Math.cos(phase * 1.3) * volatility * 0.2;
        
        const price = baseTrend * (1 + sineWave + cosineWave);
        const minPrice = Math.max(0, startPrice * 0.7);
        const maxPrice = startPrice * 1.3;
        const clampedPrice = Math.max(minPrice, Math.min(maxPrice, price));
        
        const hoursAgo = (points - 1 - i) * interval;
        return {
          timestamp: now - hoursAgo * 60 * 60 * 1000,
          price: Number(clampedPrice.toFixed(2))
        };
      });
      
      return data;
    }
    
    // Crypto için de benzer yaklaşım (gerçek fiyat bazlı)
    const startPrice = endPrice - (change24h || 0);
    const hoursInYear = 365 * 24;
    const interval = 6;
    const points = Math.floor(hoursInYear / interval);
    
    let seed = (asset.symbol?.charCodeAt(0) || 0) + (asset.symbol?.charCodeAt(1) || 0);
    
    const data = Array.from({ length: points }, (_, i) => {
      const t = points > 1 ? i / (points - 1) : 0;
      const baseTrend = startPrice + change24h * t;
      
      const volatility = Math.abs(changePercent24h) / 100 * 0.5;
      const phase = (i * 0.1) + seed;
      const sineWave = Math.sin(phase) * volatility * 0.3;
      const cosineWave = Math.cos(phase * 1.3) * volatility * 0.2;
      
      const price = baseTrend * (1 + sineWave + cosineWave);
      const minPrice = Math.max(0, startPrice * 0.5);
      const maxPrice = startPrice * 2;
      const clampedPrice = Math.max(minPrice, Math.min(maxPrice, price));
      
      const hoursAgo = (points - 1 - i) * interval;
      return {
        timestamp: now - hoursAgo * 60 * 60 * 1000,
        price: Number(clampedPrice.toFixed(6))
      };
    });
    
    return data;
  }, [asset, displayPrice, change24h, changePercent24h, type, cryptoTRY, tvPrice, showTRYPrice, yahooChartData, asset?.price]);

  const loadAssetData = async () => {
    if (!type || !symbol) {
      setLoading(false);
      setError('Geçersiz varlık parametreleri');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      if (type === 'crypto') {
        await loadCryptoData();
      } else if (type === 'stock') {
        await loadStockData();
      } else {
        throw new Error('Geçersiz varlık tipi');
      }
    } catch (err: any) {
      console.error('Varlık verisi yüklenirken hata:', err);
      setError(err?.message || 'Varlık bulunamadı');
    } finally {
      setLoading(false);
    }
  };

  const loadCryptoData = async () => {
    try {
      const [usdRes, tryRes] = await Promise.all([
        fetch('/coins.json', { cache: 'no-store' }),
        fetch('/coins_try.json', { cache: 'no-store' })
      ]);
      const baseJson = usdRes.ok ? await usdRes.json() : { data: [] };
      const tryJson = tryRes.ok ? await tryRes.json() : { data: [] };
      const data = baseJson;
      
      if (data?.data && Array.isArray(data.data)) {
        // Önce tam eşleşme ara
        let crypto = data.data.find((c: any) => 
          c.symbol?.toLowerCase() === symbol?.toLowerCase()
        );
        
        // Eğer bulunamazsa, id ile ara
        if (!crypto) {
          crypto = data.data.find((c: any) => 
            c.id?.toLowerCase() === symbol?.toLowerCase()
          );
        }
        
        // Hala bulunamazsa, name ile ara
        if (!crypto) {
          crypto = data.data.find((c: any) => 
            c.name?.toLowerCase().includes(symbol?.toLowerCase())
          );
        }
        
        if (crypto) {
          // TRY paritesini eşle
          let cryptoTRY = null as any;
          if (Array.isArray(tryJson.data)) {
            cryptoTRY = tryJson.data.find((c: any) =>
              c.symbol?.toLowerCase() === symbol?.toLowerCase() ||
              c.id?.toLowerCase() === crypto.id?.toLowerCase()
            );
          }
          setCryptoTRY(cryptoTRY);
          // Varsayılan olarak TRY göster (eğer varsa)
          setAsset({
            symbol: crypto.symbol?.toUpperCase() || symbol?.toUpperCase() || '',
            name: crypto.name || symbol?.toUpperCase() || '',
            type: 'crypto',
            price: cryptoTRY?.current_price ?? crypto.current_price,
            image: crypto.image || '',
            marketCap: cryptoTRY?.market_cap ?? crypto.market_cap,
            volume24h: cryptoTRY?.total_volume ?? crypto.total_volume,
            change24h: cryptoTRY?.price_change_24h ?? crypto.price_change_24h,
            changePercent24h: cryptoTRY?.price_change_percentage_24h ?? crypto.price_change_percentage_24h,
            high24h: cryptoTRY?.high_24h ?? crypto.high_24h,
            low24h: cryptoTRY?.low_24h ?? crypto.low_24h,
            supply: crypto.total_supply
          });
        } else {
          throw new Error(`Kripto para bulunamadı: ${symbol}`);
        }
      } else {
        throw new Error('Kripto para verileri yüklenemedi');
      }
    } catch (err) {
      console.error('Kripto verisi yüklenirken hata:', err);
      throw err;
    }
  };

  const loadStockData = async () => {
    try {
      console.log(`[Stock] Veri yükleniyor: ${symbol} (JSON'dan)`);
      const response = await fetch('/hisseler.json', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Hisseler.json yüklenemedi (${response.status})`);
      }
      const data = await response.json();
      
      if (data?.data && typeof data.data === 'object') {
        const stockSymbol = `${symbol}.IS`;
        const stock = data.data[stockSymbol];
        
        console.log(`[Stock] Arama: ${stockSymbol}`, stock ? 'Bulundu' : 'Bulunamadı');
        console.log(`[Stock] JSON güncelleme zamanı: ${data.updatedAt || 'Bilinmiyor'}`);
        
        if (stock) {
          // JSON'dan gelen tüm verileri kullan (artık TradingView'dan çekmiyoruz)
          // Backend 15 dakikada bir güncelliyor, tüm veriler JSON'da
          // JSON'dan gelen fiyatı kontrol et - önce fiyat, sonra tvPrice
          const finalPrice = (stock.fiyat !== null && stock.fiyat !== undefined && stock.fiyat > 0) 
            ? stock.fiyat 
            : ((stock.tvPrice !== null && stock.tvPrice !== undefined && stock.tvPrice > 0) 
              ? stock.tvPrice 
              : null);
          const finalChange24h = stock.degisim || (stock.fiyat && stock.degisimYuzde ? stock.fiyat * (stock.degisimYuzde / 100) : null) || null;
          const finalChangePercent24h = stock.degisimYuzde || stock.tvChangePercent24h || null;
          const finalMarketCap = stock.piyasaDegeri || null; // JSON'dan gelen piyasa değeri
          const finalVolume = stock.hacim || stock.tvVolume || null;
          const finalHigh = stock.yuksek || stock.tvHigh24h || null;
          const finalLow = stock.dusuk || stock.tvLow24h || null;
          
          console.log(`[Stock] JSON'dan gelen veriler:`, {
            symbol: stockSymbol,
            fiyat: stock.fiyat,
            tvPrice: stock.tvPrice,
            finalPrice: finalPrice,
            piyasaDegeri: stock.piyasaDegeri,
            hacim: stock.hacim,
            yuksek: stock.yuksek,
            dusuk: stock.dusuk,
            degisim: stock.degisim,
            degisimYuzde: stock.degisimYuzde,
            ad: stock.ad,
            uzunAd: stock.uzunAd
          });
          
          setAsset({
            symbol: symbol?.toUpperCase() || '',
            name: stock.ad || stock.uzunAd || symbol?.toUpperCase() || '',
            type: 'stock',
            price: finalPrice,
            marketCap: finalMarketCap,
            volume24h: finalVolume,
            change24h: finalChange24h,
            changePercent24h: finalChangePercent24h,
            high24h: finalHigh,
            low24h: finalLow
          });
          
          console.log(`[Stock] Asset set edildi (JSON'dan):`, {
            symbol: symbol?.toUpperCase(),
            name: stock.ad || stock.uzunAd,
            price: finalPrice,
            changePercent24h: finalChangePercent24h,
            marketCap: finalMarketCap,
            volume24h: finalVolume,
            high24h: finalHigh,
            low24h: finalLow,
            updatedAt: stock.updatedAt || stock.tarih
          });
        } else {
          throw new Error(`Hisse senedi bulunamadı: ${symbol}`);
        }
      } else {
        throw new Error('Hisse senedi verileri yüklenemedi (data.data geçersiz)');
      }
    } catch (err) {
      console.error('[Stock] Hisse verisi yüklenirken hata:', err);
      throw err;
    }
  };

  const loadUserAsset = async () => {
    if (!user || !symbol) return;
    
    try {
      const assetsRef = collection(db, 'userAssets');
      const q = query(assetsRef, where('userId', '==', user.uid), where('symbol', '==', symbol.toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const data = doc.data();
        setUserAsset({
          id: doc.id,
          ...data,
          addedAt: data.addedAt.toDate()
        } as UserAsset);
      }
    } catch (error) {
      console.error('Kullanıcı varlığı yüklenirken hata:', error);
      // LocalStorage'dan yükle (fallback)
      try {
        const localAssets = localStorage.getItem(`userAssets_${user.uid}`);
        if (localAssets) {
          const assets = JSON.parse(localAssets);
          const userAsset = assets.find((a: any) => a.symbol.toUpperCase() === symbol.toUpperCase());
          if (userAsset) {
            setUserAsset({
              ...userAsset,
              addedAt: new Date(userAsset.addedAt)
            });
          }
        }
      } catch (localError) {
        console.error('LocalStorage\'dan yüklenirken hata:', localError);
      }
    }
  };

  const formatPrice = (price: number, type: 'crypto' | 'stock', useTRY?: boolean) => {
    const shouldUseTRY = useTRY ?? (type === 'stock' || (type === 'crypto' && showTRYPrice && cryptoTRY));
    
    if (shouldUseTRY) {
      return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(price);
    }
    // Kripto para için dolar
    if (type === 'crypto' && price < 1) {
      return `$${price.toFixed(6)}`;
    }
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatLargeNumber = (num: number) => {
    if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toFixed(0);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Varlık bilgileri yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center space-x-4 mb-8">
            <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Varlık Bulunamadı</h1>
              <p className="text-sm text-muted-foreground">{error || 'Aradığınız varlık bulunamadı'}</p>
            </div>
          </div>
          
          <Card className="p-8 text-center">
            <div className="space-y-4">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
                <TrendingUp className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Varlık Bulunamadı</h3>
                <p className="text-muted-foreground mb-4">
                  Aradığınız varlık mevcut değil veya silinmiş olabilir.
                </p>
                <Button onClick={() => navigate('/dashboard')}>
                  Dashboard'a Dön
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 sm:space-x-4 min-w-0 flex-1">
              <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')} className="flex-shrink-0">
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
                {asset?.image && (
                  <img 
                    src={asset.image} 
                    alt={asset.name}
                    className="w-10 h-10 rounded-full"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-bold truncate">{asset?.symbol || symbol?.toUpperCase()}</h1>
                    <Badge variant={type === 'crypto' ? 'default' : 'secondary'} className="flex-shrink-0">
                      {type === 'crypto' ? 'CRYPTO' : 'STOCK'}
                    </Badge>
                    {/* Canlı/Gecikmeli Veri Göstergesi (TV tarzı) */}
                    {asset && (
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        {isDataDelayed || asset.type === 'stock' ? (
                          <div className="flex items-center space-x-1 px-2 py-1 rounded-full border border-orange-500/40 bg-orange-500/10">
                            <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                            <span className="text-xs text-orange-500 font-medium">Gecikmeli</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1 px-2 py-1 rounded-full border border-green-500/40 bg-green-500/10">
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs text-green-500 font-medium">Canlı</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{asset?.name || symbol?.toUpperCase()}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <Button 
                variant="ghost"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:outline-none active:bg-transparent hover:bg-transparent"
                onClick={async () => {
                  if (!user) { navigate('/login'); return; }
                  if (!asset) return;
                  try {
                    if (isFav && favId) {
                      await deleteDoc(doc(db,'userFavorites', favId));
                      setIsFav(false); setFavId(null);
                    } else {
                      const ref = await addDoc(collection(db,'userFavorites'), {
                        userId: user.uid,
                        symbol: asset.symbol,
                        name: asset.name,
                        type: asset.type,
                        image: asset.image || null,
                        addedAt: new Date()
                      });
                      setIsFav(true); setFavId(ref.id);
                    }
                  } catch {}
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <Heart className={`h-4 w-4 transition-colors ${isFav ? 'text-red-500 fill-red-500' : 'text-muted-foreground hover:text-red-500'}`} />
              </Button>
              <Button 
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9"
                onClick={() => {
                  const payload = {
                    id: asset.symbol,
                    symbol: asset.symbol,
                    name: asset.name,
                    type: asset.type,
                    image: asset.image
                  } as any;
                  navigate('/add-asset', { state: { preselect: payload } });
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Dialog open={aiOpen} onOpenChange={setAiOpen}>
                <DialogTrigger asChild>
                  <Button 
                    size="icon"
                    className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_0_12px_rgba(16,185,129,0.8)] h-8 w-8 sm:h-9 sm:w-9"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent 
                  className="
                    w-[95vw]
                    max-w-[95vw]
                    sm:!w-[70vw]
                    sm:!max-w-[800px]
                    max-h-[90vh]
                    sm:!max-h-[80vh]
                    h-auto
                    sm:!h-auto
                    rounded-2xl
                    sm:!rounded-3xl
                    !p-0 
                    !m-0
                    !border !border-border/50
                    !bg-background
                    !overflow-hidden 
                    !flex 
                    !flex-col
                    !left-[50%]
                    sm:!left-[50%]
                    !top-[50%]
                    sm:!top-[50%]
                    !bottom-auto
                    sm:!bottom-auto
                    !translate-x-[-50%]
                    sm:!translate-x-[-50%]
                    !translate-y-[-50%]
                    sm:!translate-y-[-50%]
                    !fixed
                    !shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]
                    data-[state=open]:animate-in
                    data-[state=closed]:animate-out
                    data-[state=closed]:fade-out-0
                    data-[state=open]:fade-in-0
                    data-[state=closed]:zoom-out-95
                    data-[state=open]:zoom-in-95
                    data-[state=closed]:slide-out-to-bottom
                    data-[state=open]:slide-in-from-bottom
                    sm:data-[state=closed]:slide-out-to-left-1/2
                    sm:data-[state=closed]:slide-out-to-top-[48%]
                    sm:data-[state=open]:slide-in-from-left-1/2
                    sm:data-[state=open]:slide-in-from-top-[48%]
                    duration-300
                    [&>button:has(span.sr-only)]:hidden
                    !gap-0
                  " 
                  aria-describedby={undefined}
                >
                  <DialogHeader className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border/50 flex flex-row items-center justify-between bg-background/95 backdrop-blur-sm sticky top-0 z-10">
                    <div className="flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0">
                      <Button variant="ghost" size="sm" className="h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0" onClick={() => setAiOpen(false)}>
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <DialogTitle className="text-sm sm:text-base font-semibold truncate">NEXONO AI - {asset?.name || symbol?.toUpperCase()}</DialogTitle>
                    </div>
                    <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => {
                          setAiOpen(false);
                          setActiveTab('overview');
                          setShowDetails(false);
                        }}
                        className="text-xs sm:text-sm hidden sm:inline-flex"
                      >
                        Detaylar
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 sm:h-9 sm:w-9" onClick={() => setAiOpen(false)}>
                        ✕
                      </Button>
                    </div>
                    <DialogDescription className="sr-only">Varlık için AI sohbet penceresi</DialogDescription>
                  </DialogHeader>
                  <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                    <NexonoAIChat 
                      currentAsset={asset ? {
                        symbol: asset.symbol,
                        name: asset.name,
                        type: asset.type,
                        price: displayPrice,
                        changePercent24h: changePercent24h
                      } : undefined}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8 pb-safe">
        <div className="max-w-6xl mx-auto space-y-3 sm:space-y-6 md:space-y-8">
          {/* Fiyat Bilgileri */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="p-4 sm:p-6 md:p-8 bg-gradient-to-r from-primary/10 to-secondary/10 border-primary/20">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 md:gap-6">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    {asset.type === 'crypto' && cryptoTRY && (
                      <div className="flex items-center gap-1 bg-background/50 rounded-lg p-1">
                        <Button
                          variant={showTRYPrice ? "default" : "ghost"}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setShowTRYPrice(true)}
                        >
                          ₺
                        </Button>
                        <Button
                          variant={!showTRYPrice ? "default" : "ghost"}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setShowTRYPrice(false)}
                        >
                          $
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="text-xl sm:text-3xl md:text-4xl font-bold break-words">
                    {loading ? (
                      <span className="text-muted-foreground">Yükleniyor...</span>
                    ) : asset && (asset.price !== null && asset.price !== undefined && asset.price > 0) ? (
                      formatPrice(asset.price, asset.type, showTRYPrice)
                    ) : (displayPrice && displayPrice > 0) ? (
                      formatPrice(displayPrice, asset.type, showTRYPrice)
                    ) : (
                      <span className="text-muted-foreground">Veri yok</span>
                    )}
                  </div>
                  <div className="text-xs sm:text-sm text-muted-foreground mt-1">
                    Güncel Fiyat
                    {!loading && asset && asset.price !== null && asset.price !== undefined && asset.price > 0 && (
                      <span className="ml-2 text-xs">(JSON - 15dk cache)</span>
                    )}
                  </div>
                </div>
                <div className="text-center">
                  <div className={`text-xl sm:text-2xl font-bold flex items-center justify-center space-x-1 ${
                    ((asset?.change24h ?? change24h) ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}>
                    <TrendingUp className={`h-5 w-5 ${((asset?.change24h ?? change24h) ?? 0) < 0 ? 'rotate-180' : ''}`} />
                    <span>
                      {((asset?.change24h ?? change24h) ?? 0) >= 0 ? '+' : ''}{formatPrice(Math.abs(asset?.change24h ?? change24h ?? 0), asset.type, showTRYPrice)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">24s Değişim</div>
                </div>
                <div className="text-center">
                  <div className={`text-xl sm:text-2xl font-bold ${
                    ((asset?.changePercent24h ?? changePercent24h) ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {((asset?.changePercent24h ?? changePercent24h) ?? 0) >= 0 ? '+' : ''}{((asset?.changePercent24h ?? changePercent24h) ?? 0).toFixed(2)}%
                  </div>
                  <div className="text-sm text-muted-foreground">24s Değişim (%)</div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Detaylı Bilgiler */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 sm:space-y-6">
              <TabsList className="flex w-full gap-1 overflow-x-auto whitespace-nowrap scrollbar-hide relative z-10 bg-muted p-1 rounded-md">
                <TabsTrigger value="overview" className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm min-w-[84px] sm:min-w-0">Durum</TabsTrigger>
                <TabsTrigger value="chart" className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm min-w-[84px] sm:min-w-0">Grafik</TabsTrigger>
                <TabsTrigger value="details" className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm min-w-[84px] sm:min-w-0">Detaylar</TabsTrigger>
                <TabsTrigger value="portfolio" className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm min-w-[84px] sm:min-w-0">Portföyüm</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 sm:space-y-6">
                <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {/* 24s En Yüksek */}
                  <Card className="p-4 sm:p-6">
                    <div className="flex items-center space-x-3">
                      <TrendingUp className="h-6 w-6 text-green-500" />
                      <div className="flex-1">
                        <div className="text-2xl font-bold">
                          {asset.high24h ? formatPrice(asset.high24h, asset.type, showTRYPrice) : 'N/A'}
                        </div>
                        <div className="text-sm text-muted-foreground">24s En Yüksek</div>
                      </div>
                    </div>
                  </Card>

                  {/* 24s En Düşük */}
                  <Card className="p-4 sm:p-6">
                    <div className="flex items-center space-x-3">
                      <TrendingUp className="h-6 w-6 text-red-500 rotate-180" />
                      <div className="flex-1">
                        <div className="text-2xl font-bold">
                          {asset.low24h ? formatPrice(asset.low24h, asset.type, showTRYPrice) : 'N/A'}
                        </div>
                        <div className="text-sm text-muted-foreground">24s En Düşük</div>
                      </div>
                    </div>
                  </Card>

                  {/* 24s Hacim */}
                  <Card className="p-4 sm:p-6">
                    <div className="flex items-center space-x-3">
                      <Volume2 className="h-6 w-6 text-blue-500" />
                      <div className="flex-1">
                        <div className="text-2xl font-bold">
                          {asset.volume24h ? formatLargeNumber(asset.volume24h) : 'N/A'}
                        </div>
                        <div className="text-sm text-muted-foreground">24s Hacim</div>
                      </div>
                    </div>
                  </Card>

                  {/* Piyasa Değeri */}
                  <Card className="p-4 sm:p-6">
                    <div className="flex items-center space-x-3">
                      <DollarSign className="h-6 w-6 text-purple-500" />
                      <div className="flex-1">
                        <div className="text-2xl font-bold">
                          {asset.marketCap !== undefined && asset.marketCap !== null && asset.marketCap > 0 ? (
                            asset.type === 'stock' 
                              ? `₺${formatLargeNumber(asset.marketCap)}`
                              : `$${formatLargeNumber(asset.marketCap)}`
                          ) : (
                            <span className="text-muted-foreground text-lg">N/A</span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Piyasa Değeri
                          {asset.marketCap !== undefined && asset.marketCap !== null && asset.marketCap > 0 && (
                            <span className="ml-2 text-xs">(JSON - 15dk cache)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Toplam Arz (Sadece crypto için) */}
                  {asset.type === 'crypto' && (
                    <Card className="p-4 sm:p-6">
                      <div className="flex items-center space-x-3">
                        <BarChart3 className="h-6 w-6 text-orange-500" />
                        <div className="flex-1">
                          <div className="text-2xl font-bold">
                            {asset.supply ? formatLargeNumber(asset.supply) : 'N/A'}
                          </div>
                          <div className="text-sm text-muted-foreground">Toplam Arz</div>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* Güncel Fiyat (Özet) */}
                  <Card className="p-4 sm:p-6">
                    <div className="flex items-center space-x-3">
                      <Building2 className="h-6 w-6 text-emerald-500" />
                      <div className="flex-1">
                        <div className="text-2xl font-bold">
                          {loading ? (
                            <span className="text-muted-foreground text-lg">Yükleniyor...</span>
                          ) : asset && (asset.price !== null && asset.price !== undefined && asset.price > 0) ? (
                            formatPrice(asset.price, asset.type, showTRYPrice)
                          ) : (displayPrice && displayPrice > 0) ? (
                            formatPrice(displayPrice, asset.type, showTRYPrice)
                          ) : (
                            <span className="text-muted-foreground text-lg">Veri yok</span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Güncel Fiyat
                          {!loading && asset && asset.price !== null && asset.price !== undefined && asset.price > 0 && (
                            <span className="ml-2 text-xs">
                              (JSON - 15dk cache)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* 24s Değişim (Özet) */}
                  <Card className="p-4 sm:p-6">
                    <div className="flex items-center space-x-3">
                      <TrendingUp className={`h-6 w-6 ${(asset.changePercent24h ?? changePercent24h) >= 0 ? 'text-green-500' : 'text-red-500'} ${(asset.changePercent24h ?? changePercent24h) < 0 ? 'rotate-180' : ''}`} />
                      <div className="flex-1">
                        <div className={`text-2xl font-bold ${(asset.changePercent24h ?? changePercent24h) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {(asset.changePercent24h ?? changePercent24h) >= 0 ? '+' : ''}{(asset.changePercent24h ?? changePercent24h).toFixed(2)}%
                        </div>
                        <div className="text-sm text-muted-foreground">24s Değişim (%)</div>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Ek Bilgiler */}
                {asset.type === 'stock' && (
                  <Card className="p-4 sm:p-6 mt-4 sm:mt-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold flex items-center space-x-2">
                        <BarChart3 className="h-5 w-5" />
                        <span>Hisse Bilgileri</span>
                      </h3>
                      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">Sembol</div>
                          <div className="text-lg font-semibold">{asset.symbol}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">Şirket Adı</div>
                          <div className="text-lg font-semibold">{asset.name}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">Veri Durumu</div>
                          <div className="flex items-center space-x-2">
                            {isDataDelayed ? (
                              <>
                                <span className="inline-block w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                                <span className="text-sm text-orange-500">Gecikmeli</span>
                              </>
                            ) : (
                              <>
                                <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-sm text-green-500">Canlı</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="chart">
                {type === 'crypto' ? (
                  <Card className="p-3 sm:p-6">
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <BarChart3 className="h-5 w-5 text-primary" />
                        <h3 className="text-lg font-semibold">Canlı Grafik</h3>
                      </div>
                      <div className="h-[300px] sm:h-[450px] md:h-[500px]">
                        <TradingViewEmbed 
                          symbol={`BINANCE:${(asset.symbol || symbol || '').toUpperCase()}USDT`}
                          interval="60"
                          theme="dark"
                          height={typeof window !== 'undefined' && window.innerWidth < 640 ? 300 : 500}
                        />
                      </div>
                    </div>
                  </Card>
                ) : (
                  <>
                    {chartLoading && (
                      <Card className="p-6">
                        <div className="flex flex-col items-center justify-center h-[400px] space-y-4">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                          <p className="text-sm text-muted-foreground">Grafik verileri yükleniyor...</p>
                        </div>
                      </Card>
                    )}
                    {!chartLoading && chartData.length > 0 && (
                      <PriceChart
                        data={chartData}
                        title={`${asset.name} (${asset.symbol})`}
                        timeframe={selectedChartTimeframe}
                        isPositive={changePercent24h >= 0}
                        currency="TRY"
                        onTimeframeChange={handleChartTimeframeChange}
                        currentPrice={displayPrice}
                        change24h={change24h}
                        changePercent24h={changePercent24h}
                      />
                    )}
                    {!chartLoading && chartData.length === 0 && (
                      <Card className="p-6">
                        <div className="flex flex-col items-center justify-center h-[400px] space-y-4">
                          <BarChart3 className="h-12 w-12 text-muted-foreground" />
                          <div className="text-center">
                            <h3 className="text-lg font-semibold mb-2">Grafik Verisi Bulunamadı</h3>
                            <p className="text-sm text-muted-foreground mb-4">
                              {asset.price || tvPrice ? 
                                'Grafik verileri henüz hazır değil. Backend verileri yüklenene kadar bekleyin (15 dakika içinde).' :
                                'Fiyat bilgisi bulunamadı. Veriler yüklenene kadar bekleyin.'}
                            </p>
                            {(asset.price || tvPrice) && (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                  Fiyat: {formatPrice(asset.price || tvPrice || 0, 'stock')}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {asset.price ? 'Kaynak: hisseler.json' : tvPrice ? 'Kaynak: TradingView (gecikmeli)' : ''}
                                </p>
                              </div>
                            )}
                            <div className="mt-4 text-xs text-muted-foreground">
                              <p>💡 İpucu: Backend grafik verileri 15 dakikada bir güncellenir.</p>
                              <p>Sayfayı yenileyerek tekrar deneyebilirsiniz.</p>
                            </div>
                          </div>
                        </div>
                      </Card>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="details" className="mt-4 sm:mt-6">
                <Card className="p-6">
                  <div className="space-y-6">
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold">Detaylı Bilgiler</h3>
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label className="text-sm text-muted-foreground">Sembol</Label>
                        <p className="font-medium">{asset.symbol}</p>
                      </div>
                      <div>
                        <Label className="text-sm text-muted-foreground">Ad</Label>
                        <p className="font-medium">{asset.name}</p>
                      </div>
                      <div>
                        <Label className="text-sm text-muted-foreground">Tip</Label>
                        <Badge variant={asset.type === 'crypto' ? 'default' : 'secondary'}>
                          {asset.type === 'crypto' ? 'Kripto Para' : 'Hisse Senedi'}
                        </Badge>
                      </div>
                      <div>
                        <Label className="text-sm text-muted-foreground">Güncel Fiyat</Label>
                        <p className="font-medium">{formatPrice(displayPrice, asset.type, showTRYPrice)}</p>
                      </div>
                    </div>
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="portfolio" className="mt-4 sm:mt-6">
                <Card className="p-6">
                  <div className="space-y-6">
                    <div className="flex items-center space-x-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold">Portföyümdeki {asset.symbol}</h3>
                    </div>
                    
                    {userAsset ? (
                      <div className="space-y-6">
                        {(() => {
                          const pnl = calculatePnL(userAsset.symbol, userAsset.quantity, userAsset.purchasePrice);
                          return (
                            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                              <Card className="p-4">
                                <div className="space-y-2">
                                  <div className="text-sm text-muted-foreground">Miktar</div>
                                  <div className="text-2xl font-bold">{userAsset.quantity}</div>
                                </div>
                              </Card>
                              
                              <Card className="p-4">
                                <div className="space-y-2">
                                  <div className="text-sm text-muted-foreground">Alış Fiyatı</div>
                                  <div className="text-2xl font-bold">
                                    {formatPrice(userAsset.purchasePrice, userAsset.type, showTRYPrice)}
                                  </div>
                                </div>
                              </Card>
                              
                              {pnl && (
                                <Card className="p-4">
                                  <div className="space-y-2">
                                    <div className="text-sm text-muted-foreground">Güncel Değer</div>
                                    <div className="text-2xl font-bold">
                                      {formatPrice(pnl.currentValue, userAsset.type, showTRYPrice)}
                                    </div>
                                  </div>
                                </Card>
                              )}
                              
                              {pnl && (
                                <Card className="p-4">
                                  <div className="space-y-2">
                                    <div className="text-sm text-muted-foreground">Kar/Zarar</div>
                                    <div className={`text-2xl font-bold ${pnl.isProfit ? 'text-green-500' : 'text-red-500'}`}>
                                      {pnl.isProfit ? '+' : ''}{formatPrice(pnl.totalPnL, userAsset.type, showTRYPrice)}
                                    </div>
                                    <div className={`text-sm ${pnl.isProfit ? 'text-green-500' : 'text-red-500'}`}>
                                      {pnl.isProfit ? '+' : ''}{pnl.pnlPercent.toFixed(2)}%
                                    </div>
                                  </div>
                                </Card>
                              )}
                            </div>
                          );
                        })()}
                        
                        <Card className="p-4">
                          <div className="space-y-4">
                            <h4 className="font-semibold">Detaylı Bilgiler</h4>
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="text-sm text-muted-foreground">Toplam Yatırım</div>
                                <div className="font-medium">
                                  {formatPrice(userAsset.quantity * userAsset.purchasePrice, userAsset.type, showTRYPrice)}
                                </div>
                              </div>
                              <div>
                                <div className="text-sm text-muted-foreground">Eklenme Tarihi</div>
                                <div className="font-medium">
                                  {userAsset.addedAt.toLocaleDateString('tr-TR')}
                                </div>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                          <DollarSign className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h4 className="text-lg font-semibold mb-2">Bu varlığa sahip değilsiniz</h4>
                        <p className="text-muted-foreground mb-4">
                          Bu varlığı portföyünüze eklemek için varlık ekleme sayfasını ziyaret edin.
                        </p>
                        <Button onClick={() => navigate('/add-asset')}>
                          Varlık Ekle
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default AssetDetail;