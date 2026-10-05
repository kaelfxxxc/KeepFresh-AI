import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, CalendarDays, BarChart3, Crown, Download, Package, SlidersHorizontal, TrendingUp } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { useSubscription } from '../src/context/SubscriptionContext';
import { establishmentStatisticsService, type SalesOrder, type StatisticsPeriod } from '../src/services/establishmentStatisticsService';
import { FeatureLock, PlanCheckLock } from '../src/components/ui';
import { colors, radii, spacing, shadow } from '../src/theme';
import { DateRangePickerModal } from '../src/components/DateRangePicker';
import { CONTENT_MAX_WIDTH } from '../src/hooks/useContentLayout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const money = (amount: number) => `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const periods: { label: string; value: StatisticsPeriod }[] = [
  { label: '1 Day', value: '1day' }, { label: '7 Days', value: '7days' },
  { label: '30 Days', value: '30days' }, { label: 'Custom', value: 'custom' },
];
const dayKey = (value: string) => new Date(value).toLocaleDateString('en-CA');
const toDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const fromDateKey = (key: string, end = false) => {
  const [year, month, day] = key.split('-').map(Number);
  const result = new Date(year, month - 1, day);
  result.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return result;
};

export default function EstablishmentStatisticsScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 370;
  const pageWidth = Math.min(width, CONTENT_MAX_WIDTH);
  const pageGutter = Math.max(14, (width - pageWidth) / 2);
  const { profile } = useAuth();
  const { entitlements, gates, loading: planLoading, error: planError, refresh: refreshPlan } = useSubscription();
  const [period, setPeriod] = useState<StatisticsPeriod>('7days');
  const todayKey = toDateKey(new Date());
  const initialStart = new Date(); initialStart.setDate(initialStart.getDate() - 6);
  const [customStart, setCustomStart] = useState(toDateKey(initialStart));
  const [customEnd, setCustomEnd] = useState(todayKey);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [exportPickerVisible, setExportPickerVisible] = useState(false);
  const [exportStart, setExportStart] = useState(todayKey);
  const [exportEnd, setExportEnd] = useState(todayKey);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = profile?.account_type === 'establishment' && gates.establishmentStatistics.allowed;

  const load = useCallback(async () => {
    if (!profile || !allowed) { setLoading(false); setRefreshing(false); return; }
    const end = period === 'custom' ? fromDateKey(customEnd, true) : new Date();
    const start = period === 'custom' ? fromDateKey(customStart) : new Date(end);
    if (period === '1day') start.setHours(0, 0, 0, 0);
    else if (period === '7days') start.setDate(start.getDate() - 6);
    else if (period === '30days') start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    try { setOrders(await establishmentStatisticsService.list(profile.id, start, end)); setError(null); }
    catch (e) { setError((e as Error)?.message || 'Could not load saved order data.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [profile, allowed, period, customStart, customEnd]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const stats = useMemo(() => {
    const totals = orders.reduce((sum, order) => sum + order.total, 0);
    const units = orders.reduce((sum, order) => sum + order.items.reduce((s, item) => s + item.quantity, 0), 0);
    const products = new Map<string, number>();
    const byDay = new Map<string, number>();
    orders.forEach((order) => {
      const date = dayKey(order.created_at);
      byDay.set(date, (byDay.get(date) || 0) + order.total);
      order.items.forEach((item) => products.set(item.product_name, (products.get(item.product_name) || 0) + item.quantity));
    });
    const best = [...products.entries()].sort((a, b) => b[1] - a[1])[0];
    const rangeStart = period === 'custom' ? fromDateKey(customStart) : new Date();
    const rangeEnd = period === 'custom' ? fromDateKey(customEnd) : new Date();
    const days = period === '1day' ? 1 : period === '7days' ? 7 : period === '30days' ? 30 : Math.min(Math.max(Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1, 1), 366);
    const bucketSize = days > 21 ? 7 : 1;
    const bucketCount = Math.ceil(days / bucketSize);
    const bars = Array.from({ length: bucketCount }, (_, i) => {
      const d = period === 'custom' ? new Date(rangeStart) : new Date();
      if (period === 'custom') d.setDate(rangeStart.getDate() + i * bucketSize);
      else d.setDate(d.getDate() - days + 1 + i * bucketSize);
      const bucketEnd = new Date(d);
      bucketEnd.setDate(bucketEnd.getDate() + bucketSize);
      const amount = [...byDay.entries()].reduce((sum, [key, value]) => {
        const stamp = fromDateKey(key);
        return stamp >= d && stamp < bucketEnd ? sum + value : sum;
      }, 0);
      const key = dayKey(d.toISOString());
      const label = bucketSize > 1 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : days === 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : String(d.getDate());
      return { key, amount, label };
    });
    return { totals, units, average: orders.length ? totals / orders.length : 0, best, bars };
  }, [orders, period, customStart, customEnd]);

  const exportData = async (startKey: string, endKey: string) => {
    if (!profile) return;
    const start = fromDateKey(startKey);
    const end = fromDateKey(endKey, true);
    let exportOrders: SalesOrder[];
    try {
      exportOrders = await establishmentStatisticsService.list(profile.id, start, end);
    } catch (e) {
      Alert.alert('Download failed', (e as Error)?.message || 'Could not load orders for this date range.');
      return;
    }
    const lines = ['Date,Order,Destination,Status,Total,Items'];
    exportOrders.forEach((order) => lines.push([
      new Date(order.created_at).toLocaleString(), order.id, order.destination, order.status, order.total.toFixed(2),
      order.items.map((item) => `${item.product_name} (${item.quantity} ${item.unit})`).join('; '),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    await Share.share({ title: 'KeepFresh establishment statistics', message: lines.join('\n') });
  };

  if (!entitlements) return <View style={styles.screen}><Header topInset={insets.top} /><PlanCheckLock loading={planLoading} error={planError} onRetry={refreshPlan} /></View>;
  if (profile?.account_type !== 'establishment' || !gates.establishmentStatistics.allowed) return (
    <View style={styles.screen}><Header topInset={insets.top} /><FeatureLock icon={Crown} title={profile?.account_type === 'establishment' ? gates.establishmentStatistics.title : 'Food establishment feature'} message={profile?.account_type === 'establishment' ? gates.establishmentStatistics.message : 'Statistics are available only for food establishment accounts.'} bullets={['Order totals from saved database records', 'Daily order trends and item quantities', 'Shareable CSV report']} ctaLabel="View plans" onPress={() => router.push('/subscription')} /></View>
  );

  const maxBar = Math.max(...stats.bars.map((bar) => bar.amount), 1);
  return <View style={styles.screen}>
    <Header topInset={insets.top} />
    <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: pageGutter }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}>
      <View style={[styles.column, { width: pageWidth - pageGutter * 2 }]}>
      <View style={styles.titleRow}><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.title}>Order Statistics</Text><Text style={styles.subtitle}>Saved order totals & item quantities</Text></View><Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="Download report" onPress={() => { setExportStart(customStart); setExportEnd(customEnd); setExportPickerVisible(true); }}><Download size={18} color={colors.primaryDark} /></Pressable></View>
      <View style={styles.periods}>{periods.map((p) => <Pressable key={p.value} onPress={() => { if (p.value === 'custom') setDatePickerVisible(true); else setPeriod(p.value); }} style={[styles.period, compact && styles.periodCompact, period === p.value && styles.periodActive]}><Text style={[styles.periodText, compact && styles.periodTextCompact, period === p.value && styles.periodTextActive]}>{p.value === 'custom' && period === 'custom' ? `${customStart.slice(5)} – ${customEnd.slice(5)}` : p.label}</Text></Pressable>)}</View>
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 48 }} /> : error ? <View style={styles.card}><Text style={styles.error}>{error}</Text><Pressable onPress={load}><Text style={styles.link}>Retry</Text></Pressable></View> : <>
        <View style={styles.hero}><View style={styles.heroHead}><Text style={styles.eyebrow}>ORDER VALUE</Text><View style={styles.pill}><TrendingUp size={12} color="#08724E" /><Text style={styles.pillText}>{orders.length} orders</Text></View></View><Text style={styles.heroValue}>{money(stats.totals)}</Text><Text style={styles.caption}>Total value of non-cancelled orders in this period</Text><View style={styles.heroFoot}><Text style={styles.caption}>Average order</Text><Text style={styles.footValue}>{money(stats.average)}</Text></View></View>
        <View style={[styles.metrics, compact && styles.metricsCompact]}><Metric icon={Package} title="Items Ordered" value={`${stats.units} units`} caption={`${orders.length} saved orders`} /><Metric icon={BarChart3} title="Top Product" value={stats.best?.[0] || '—'} caption={stats.best ? `${stats.best[1]} units ordered` : 'No item records'} /></View>
        <View style={styles.card}><View style={styles.cardHead}><View><Text style={styles.cardTitle}>Order Value Trend</Text><Text style={styles.caption}>Daily totals from saved orders</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Choose date range for order value trend" style={styles.calendarButton} onPress={() => setDatePickerVisible(true)}><CalendarDays size={18} color={colors.primary} /></Pressable></View><Pressable style={styles.chartRange} onPress={() => setDatePickerVisible(true)}><Text style={styles.chartRangeText}>{period === 'custom' ? `${customStart} – ${customEnd}` : period === '1day' ? 'Today' : period === '7days' ? 'Last 7 days' : 'Last 30 days'}</Text><Text style={styles.chartRangeAction}>Change dates</Text></Pressable><View style={styles.chart}>{stats.bars.map((bar) => <View key={bar.key} style={styles.barColumn}><View style={styles.barTrack}><View style={[styles.bar, { height: `${Math.max(bar.amount / maxBar * 100, bar.amount > 0 ? 8 : 2)}%`, opacity: bar.amount ? 1 : 0.15 }]} /></View><Text style={styles.barLabel}>{bar.label}</Text></View>)}</View><Text style={styles.chartTotal}>{money(stats.totals)} total</Text></View>
        <View style={styles.sectionHeader}><Text style={styles.cardTitle}>Daily Breakdown</Text><Text style={styles.caption}>{orders.length} orders logged</Text></View>
        {orders.length === 0 ? <View style={styles.card}><Text style={styles.caption}>No saved orders in this period. Statistics will appear here when order records exist.</Text></View> : orders.map((order) => <View key={order.id} style={styles.orderCard}><View style={styles.orderTop}><View style={styles.dateBox}><Text style={styles.dateDay}>{new Date(order.created_at).getDate()}</Text><Text style={styles.dateMonth}>{new Date(order.created_at).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={styles.orderDate}>{new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text><Text style={styles.caption} numberOfLines={1}>{order.destination} · {order.items.reduce((sum, item) => sum + item.quantity, 0)} items · {order.status}</Text></View><Text style={styles.orderAmount}>{money(order.total)}</Text></View><View style={styles.orderItems}>{order.items.map((item, i) => <Text key={`${order.id}-${i}`} style={styles.itemText} numberOfLines={1}>{item.product_name} · {item.quantity} {item.unit}</Text>)}</View></View>)}
      </>}
      </View>
    </ScrollView>
    <DateRangePickerModal visible={datePickerVisible} start={customStart} end={customEnd} maxDate={todayKey} title="Trend date range" onCancel={() => setDatePickerVisible(false)} onConfirm={(start, end) => { setCustomStart(start); setCustomEnd(end); setPeriod('custom'); setDatePickerVisible(false); }} onReset={() => { setCustomStart(toDateKey(initialStart)); setCustomEnd(todayKey); setPeriod('7days'); setDatePickerVisible(false); }} />
    <DateRangePickerModal visible={exportPickerVisible} start={exportStart} end={exportEnd} maxDate={todayKey} title="Report date range" onCancel={() => setExportPickerVisible(false)} onConfirm={(start, end) => { setExportStart(start); setExportEnd(end); setExportPickerVisible(false); void exportData(start, end); }} onReset={() => { setExportStart(toDateKey(initialStart)); setExportEnd(todayKey); }} />
  </View>;
}

function Header({ topInset }: { topInset: number }) {
  return (
    <View style={[styles.header, { paddingTop: topInset, height: topInset + 54 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.headerSide}>
        <ArrowLeft size={21} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>KeepFresh AI</Text>
      <View style={[styles.headerSide, styles.headerEnd]}>
        <SlidersHorizontal size={19} color={colors.textPrimary} />
      </View>
    </View>
  );
}
function Metric({ icon: Icon, title, value, caption }: { icon: any; title: string; value: string; caption: string }) { return <View style={styles.metric}><View style={styles.metricIcon}><Icon size={17} color={colors.primary} /></View><Text style={styles.metricTitle}>{title}</Text><Text style={styles.metricValue} numberOfLines={1}>{value}</Text><Text style={styles.caption} numberOfLines={1}>{caption}</Text></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F0FBF2' }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, borderColor: '#E5F1E7', gap: 8 }, headerSide: { width: 40, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }, headerEnd: { alignItems: 'flex-end' }, headerTitle: { flex: 1, minWidth: 0, textAlign: 'center', fontWeight: '700', color: '#173528', fontSize: 14 }, content: { paddingTop: 14, paddingBottom: 48, alignItems: 'center' }, column: { maxWidth: CONTENT_MAX_WIDTH }, titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 }, title: { color: '#183729', fontSize: 21, fontWeight: '800' }, subtitle: { color: '#77867D', fontSize: 11, marginTop: 3 }, action: { width: 40, height: 40, backgroundColor: 'white', borderRadius: 13, borderWidth: 1, borderColor: '#E3ECE5', alignItems: 'center', justifyContent: 'center' }, periods: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 }, period: { flexGrow: 1, flexBasis: '22%', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 5, backgroundColor: 'white', borderRadius: 18 }, periodCompact: { flexBasis: '45%' }, periodActive: { backgroundColor: '#104F35' }, periodText: { color: '#5F6B64', fontSize: 11, fontWeight: '600', textAlign: 'center' }, periodTextCompact: { fontSize: 10 }, periodTextActive: { color: 'white' }, hero: { backgroundColor: 'white', borderRadius: 17, padding: 17, borderWidth: 1, borderColor: '#E6EEE8', ...shadow.card }, heroHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#708078', fontSize: 10, fontWeight: '700', letterSpacing: .5 }, pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DDF8EA', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }, pillText: { color: '#08724E', fontSize: 10, fontWeight: '700' }, heroValue: { color: '#0F3021', fontSize: 30, fontWeight: '800', marginTop: 7 }, caption: { color: '#75827A', fontSize: 10, marginTop: 4 }, heroFoot: { borderTopWidth: 1, borderColor: '#EFF2F0', marginTop: 13, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, footValue: { color: '#36584A', fontSize: 12, fontWeight: '700' }, metrics: { flexDirection: 'row', gap: 10, marginTop: 12 }, metricsCompact: { gap: 7 }, metric: { flex: 1, minWidth: 0, backgroundColor: 'white', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#E6EEE8', ...shadow.card }, metricIcon: { width: 31, height: 31, borderRadius: 10, backgroundColor: '#E4F5EA', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, metricTitle: { color: '#69776F', fontSize: 10 }, metricValue: { color: '#183729', fontSize: 17, fontWeight: '800', marginTop: 3 }, card: { backgroundColor: 'white', borderRadius: 17, padding: 15, marginTop: 13, borderWidth: 1, borderColor: '#E6EEE8', ...shadow.card }, cardHead: { flexDirection: 'row', justifyContent: 'space-between' }, cardTitle: { color: '#20392D', fontSize: 14, fontWeight: '700' }, calendarButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#EAF7EE', alignItems: 'center', justifyContent: 'center' }, chartRange: { marginTop: 8, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, chartRangeText: { color: '#536D5E', fontSize: 10, fontWeight: '600' }, chartRangeAction: { color: colors.primary, fontSize: 10, fontWeight: '700' }, chart: { height: 140, flexDirection: 'row', gap: 5, marginTop: 9 }, barColumn: { flex: 1, alignItems: 'center' }, barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' }, bar: { width: '100%', backgroundColor: '#10613E', borderRadius: 5 }, barLabel: { color: '#748078', fontSize: 9, marginTop: 6 }, chartTotal: { color: '#537161', fontSize: 10, borderTopWidth: 1, borderColor: '#EFF2F0', paddingTop: 10, marginTop: 11 }, sectionHeader: { marginTop: 20, marginBottom: 9 }, orderCard: { backgroundColor: 'white', borderRadius: 16, padding: 12, marginBottom: 9, borderWidth: 1, borderColor: '#E6EEE8', ...shadow.card }, orderTop: { flexDirection: 'row', alignItems: 'center', gap: 9 }, dateBox: { width: 39, height: 42, borderRadius: 11, backgroundColor: '#E7F5EB', justifyContent: 'center', alignItems: 'center' }, dateDay: { color: '#143D2A', fontSize: 16, fontWeight: '800' }, dateMonth: { color: '#648070', fontSize: 8, fontWeight: '700' }, orderDate: { color: '#24382E', fontSize: 12, fontWeight: '700' }, orderAmount: { color: '#142D20', fontSize: 13, fontWeight: '800' }, orderItems: { borderTopWidth: 1, borderColor: '#EFF2F0', marginTop: 10, paddingTop: 7, gap: 3 }, itemText: { color: '#718078', fontSize: 10 }, export: { height: 48, borderRadius: 25, backgroundColor: '#105338', marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, exportText: { color: 'white', fontWeight: '700', fontSize: 12 }, error: { color: colors.danger, fontSize: 12 }, link: { color: colors.primary, fontWeight: '700', marginTop: 8 },
});
