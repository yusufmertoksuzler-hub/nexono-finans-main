import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, ReferenceLine } from 'recharts';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, BarChart3, Activity, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PriceData {
  timestamp: number;
  price: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number;
}

interface PriceChartProps {
  data: PriceData[];
  title: string;
  timeframe: string;
  isPositive: boolean;
  currency?: 'USD' | 'TRY';
  onTimeframeChange?: (timeframe: string) => void;
  currentPrice?: number;
  change24h?: number;
  changePercent24h?: number;
}

export const PriceChart: React.FC<PriceChartProps> = ({ 
  data, 
  title, 
  timeframe, 
  isPositive, 
  currency = 'USD',
  onTimeframeChange,
  currentPrice,
  change24h,
  changePercent24h
}) => {
  const [isMobile, setIsMobile] = useState(false);
  // Parent'tan gelen timeframe prop'unu kullan, yoksa '1D' default
  const [selectedTimeframe, setSelectedTimeframe] = useState(timeframe || '1D');
  const [showMovingAverage, setShowMovingAverage] = useState(true);
  
  // Parent'tan gelen timeframe prop'u değiştiğinde state'i güncelle
  useEffect(() => {
    if (timeframe) {
      setSelectedTimeframe(timeframe);
    }
  }, [timeframe]);
  
  const handleTimeframeChange = (newTimeframe: string) => {
    setSelectedTimeframe(newTimeframe);
    if (onTimeframeChange) {
      onTimeframeChange(newTimeframe);
    }
  };

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Timeframe'e göre filtreleme
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    // Verileri timestamp'e göre sırala (küçükten büyüğe)
    const sorted = [...data]
      .filter(d => d && d.timestamp && d.price && !isNaN(d.timestamp) && !isNaN(d.price))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    const now = Date.now();
    
    // 1D (1 Gün): Son 24 saati göster
    if (selectedTimeframe === '1D') {
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      return sorted.filter(d => d.timestamp >= oneDayAgo);
    }
    
    // 1W (1 Hafta): Son 7 günü göster
    if (selectedTimeframe === '1W') {
      const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
      return sorted.filter(d => d.timestamp >= oneWeekAgo);
    }
    
    // 1M (1 Ay): Son 30 günü göster
    if (selectedTimeframe === '1M') {
      const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
      return sorted.filter(d => d.timestamp >= oneMonthAgo);
    }
    
    // 3M (3 Ay): Son 90 günü göster
    if (selectedTimeframe === '3M') {
      const threeMonthsAgo = now - (90 * 24 * 60 * 60 * 1000);
      return sorted.filter(d => d.timestamp >= threeMonthsAgo);
    }
    
    // 1Y (1 Yıl) ve diğerleri için tüm verileri göster
    return sorted;
  }, [data, selectedTimeframe]);

  // Moving Average hesapla (basit 7 noktalık)
  const dataWithMA = useMemo(() => {
    const windowSize = Math.min(7, Math.floor(filteredData.length / 3)); // Veri uzunluğuna göre ayarla
    return filteredData.map((point, index) => {
      if (index < windowSize - 1) {
        return { ...point, ma: point.price };
      }
      const slice = filteredData.slice(index - windowSize + 1, index + 1);
      const avg = slice.reduce((sum, p) => sum + p.price, 0) / windowSize;
      return { ...point, ma: avg };
    });
  }, [filteredData]);

  // İstatistikler ve Y ekseni domain (min-max aralığı)
  const stats = useMemo(() => {
    const prices = filteredData.map(d => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance) / avg * 100; // Yüzde volatilite
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const change = lastPrice - firstPrice;
    const changePercent = firstPrice > 0 ? (change / firstPrice) * 100 : 0;
    
    // Y ekseni için domain belirle (min'den max'a, biraz padding ile)
    const range = max - min;
    const padding = range * 0.1; // %10 padding (daha fazla nefes alanı)
    const yAxisDomain = [
      min - padding, // En düşük fiyattan padding kadar aşağı
      max + padding   // En yüksek fiyattan padding kadar yukarı
    ];
    
    return {
      min,
      max,
      avg,
      volatility: volatility.toFixed(2),
      change,
      changePercent: changePercent.toFixed(2),
      range: max - min,
      rangePercent: firstPrice > 0 ? ((max - min) / firstPrice) * 100 : 0,
      yAxisDomain // Grafik için min-max domain
    };
  }, [filteredData]);
  
  const formatPrice = (value: number) => {
    if (currency === 'TRY') {
      return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    if (selectedTimeframe === '1D' || timeframe === '1D') {
      return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' });
  };

  return (
    <Card className="p-3 sm:p-6 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm border-border/50">
      {/* Header with Stats */}
      <div className="mb-4 sm:mb-6 space-y-3">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-base sm:text-xl font-bold text-foreground truncate">{title}</h3>
            {/* Güncel Fiyat ve Değişim */}
            {(currentPrice !== undefined && currentPrice !== null) && (
              <div className="flex items-center space-x-3 mt-1">
                <div className="text-lg sm:text-2xl font-bold">
                  {formatPrice(currentPrice)}
                </div>
                {(change24h !== undefined && change24h !== null) && (
                  <div className={`text-sm sm:text-base font-semibold flex items-center space-x-1 ${
                    change24h >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}>
                    <TrendingUp className={`h-4 w-4 ${change24h < 0 ? 'rotate-180' : ''}`} />
                    <span>{change24h >= 0 ? '+' : ''}{formatPrice(Math.abs(change24h))}</span>
                  </div>
                )}
                {(changePercent24h !== undefined && changePercent24h !== null) && (
                  <div className={`text-sm sm:text-base font-semibold ${
                    changePercent24h >= 0 ? 'text-green-500' : 'text-red-500'
                  }`}>
                    ({changePercent24h >= 0 ? '+' : ''}{changePercent24h.toFixed(2)}%)
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
            )}
            <span className={`text-sm sm:text-base font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {stats.changePercent >= 0 ? '+' : ''}{stats.changePercent}%
            </span>
          </div>
        </div>
        

        {/* Timeframe Tabs */}
        <Tabs value={selectedTimeframe} onValueChange={handleTimeframeChange} className="w-full">
          <TabsList className="grid w-full grid-cols-5 h-9 sm:h-10">
            <TabsTrigger value="1D" className="text-[10px] sm:text-xs">1G</TabsTrigger>
            <TabsTrigger value="1W" className="text-[10px] sm:text-xs">1H</TabsTrigger>
            <TabsTrigger value="1M" className="text-[10px] sm:text-xs">1A</TabsTrigger>
            <TabsTrigger value="3M" className="text-[10px] sm:text-xs">3A</TabsTrigger>
            <TabsTrigger value="1Y" className="text-[10px] sm:text-xs">1Y</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Moving Average Toggle */}
        <div className="flex items-center justify-between text-xs sm:text-sm">
          <span className="text-muted-foreground">{timeframe} Fiyat Hareketi</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowMovingAverage(!showMovingAverage)}
          >
            {showMovingAverage ? 'MA: Açık' : 'MA: Kapalı'}
          </Button>
        </div>
      </div>
      
      <div className="h-[250px] sm:h-[400px] lg:h-[450px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dataWithMA} margin={{ top: 10, right: isMobile ? 5 : 15, left: isMobile ? -20 : 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.4}/>
                <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="hsl(var(--border))" 
              opacity={0.4}
              vertical={!isMobile}
            />
            <XAxis 
              dataKey="timestamp"
              tickFormatter={formatTime}
              stroke="hsl(var(--muted-foreground))"
              fontSize={isMobile ? 10 : 12}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              interval={isMobile ? 'preserveStartEnd' : 'preserveEnd'}
              minTickGap={isMobile ? 40 : 20}
            />
            <YAxis 
              tickFormatter={formatPrice}
              stroke="hsl(var(--muted-foreground))"
              fontSize={isMobile ? 10 : 12}
              tickLine={false}
              axisLine={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              width={isMobile ? 50 : 80}
              tickCount={isMobile ? 5 : 7}
              domain={stats.yAxisDomain}
              type="number"
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '2px solid hsl(var(--border))',
                borderRadius: '12px',
                color: 'hsl(var(--foreground))',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
                padding: isMobile ? '8px 10px' : '12px 16px',
                fontSize: isMobile ? '12px' : '14px',
                fontWeight: '600'
              }}
              labelFormatter={(timestamp) => {
                const date = new Date(timestamp as number);
                return date.toLocaleString('tr-TR', { 
                  day: '2-digit', 
                  month: 'short', 
                  hour: '2-digit', 
                  minute: '2-digit' 
                });
              }}
              formatter={(value: any, name: string, props: any) => {
                if (name === 'price') {
                  return [formatPrice(value), 'Fiyat'];
                }
                if (name === 'ma') {
                  return [formatPrice(value), 'MA(7)'];
                }
                return [value, name];
              }}
              labelStyle={{ fontWeight: 'bold', marginBottom: '6px', fontSize: isMobile ? '13px' : '15px' }}
              cursor={{ stroke: isPositive ? '#10b981' : '#ef4444', strokeWidth: 2, strokeDasharray: '5 5' }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={isPositive ? '#10b981' : '#ef4444'}
              strokeWidth={isMobile ? 2.5 : 3}
              fill="url(#colorGradient)"
              activeDot={{ 
                r: isMobile ? 6 : 8, 
                stroke: isPositive ? '#10b981' : '#ef4444',
                strokeWidth: 2,
                fill: 'hsl(var(--background))',
                strokeDasharray: '0'
              }}
              dot={false}
            />
            {showMovingAverage && (
              <Line
                type="monotone"
                dataKey="ma"
                stroke="#8b5cf6"
                strokeWidth={isMobile ? 1.5 : 2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
            {/* Ortalama referans çizgisi */}
            <ReferenceLine 
              y={stats.avg} 
              stroke="hsl(var(--muted-foreground))" 
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              label={{ value: 'Ortalama', position: 'right', fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      {/* Alt bilgi - OHLC İstatistikleri (Google Finance stili) */}
      {filteredData.length > 0 && (
        <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-border/50">
          <div className="grid grid-cols-3 gap-4 text-xs sm:text-sm">
            <div>
              <span className="text-muted-foreground font-medium">Açılış:</span>
              <span className="ml-2 font-bold text-foreground">
                {formatPrice(filteredData[0].price)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground font-medium">Yüksek:</span>
              <span className="ml-2 font-bold text-green-500">
                {formatPrice(stats.max)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground font-medium">Düşük:</span>
              <span className="ml-2 font-bold text-red-500">
                {formatPrice(stats.min)}
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

export default PriceChart;
