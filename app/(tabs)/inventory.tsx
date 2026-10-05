import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { storageAreaService } from '../../src/services/storageAreaService';
import { colors, radii, spacing } from '../../src/theme';
import { useContentLayout } from '../../src/hooks/useContentLayout';
import { orderCart } from '../../src/services/orderCart';
import { Search, SlidersHorizontal, ScanBarcode, Plus, ArrowRight, Package, Refrigerator, Snowflake, CookingPot, ShoppingCart, CheckCircle2 } from 'lucide-react-native';
import type { InventoryItem, StorageArea } from '../../src/types';

type Product = InventoryItem & { area?: StorageArea };
const money = (value: number) => `₱${Number(value || 0).toFixed(2)}`;
const areaIcon = (area?: StorageArea) => area?.kind === 'freezer' ? Snowflake : area?.kind === 'pantry' ? CookingPot : Refrigerator;

export default function ProductsScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useContentLayout();
  const { profile } = useAuth();
  const isHousehold = profile?.account_type !== 'establishment';
  const [items, setItems] = useState<Product[]>([]);
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All Products');
  const [sort, setSort] = useState<'Price: Low to High' | 'Name'>('Price: Low to High');
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});

  useFocusEffect(useCallback(() => {
    setCart(orderCart.get());
  }, []));

  const load = useCallback(async () => {
    if (!profile) return;
    const [{ data, error }, storage] = await Promise.all([
      supabase.from('inventory_items').select('*').eq('user_id', profile.id).eq('status', 'available').order('product_name'),
      storageAreaService.list(profile.id).catch(() => [] as StorageArea[]),
    ]);
    if (!error && data) setItems(data.map((item) => ({ ...item, area: storage.find((area) => area.id === item.storage_area_id) })));
    setAreas(storage);
    setLoading(false);
  }, [profile]);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const categories = useMemo(() => ['All Products', ...Array.from(new Set(items.map((item) => item.area?.name).filter(Boolean) as string[]))], [items]);
  const visible = useMemo(() => items
    .filter((item) => category === 'All Products' || item.area?.name === category)
    .filter((item) => `${item.product_name} ${item.brand || ''} ${item.category || ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'Name' ? a.product_name.localeCompare(b.product_name) : Number(a.price || 0) - Number(b.price || 0)), [items, category, search, sort]);
  const selected = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  const inStockCount = items.filter((item) => Number(item.quantity ?? 0) > 0).length;
  const cartTotal = selected.reduce((sum, [id, quantity]) => sum + Number(items.find((item) => item.id === id)?.price || 0) * quantity, 0);
  const setQuantity = (item: Product, quantity: number) => setCart((old) => {
    const next = { ...old, [item.id]: Math.max(0, Math.min(quantity, Number(item.quantity || 0))) };
    orderCart.set(next);
    return next;
  });

  return <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 12, paddingHorizontal: gutter }}
      contentContainerStyle={{ paddingBottom: 160, gap: 12 }}
      ListHeaderComponent={<View style={{ paddingHorizontal: gutter }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>Item List &amp; Products</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}><Text style={[styles.subtitle, { flex: 1 }]} numberOfLines={1}>KeepFresh AI · Kitchen &amp; Grocery Store</Text><View style={styles.stockPill}><Text style={styles.stockText}>{inStockCount} in stock</Text></View></View>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.headerIconButton} onPress={() => router.push('/scan')} accessibilityRole="button" accessibilityLabel="Barcode scanner"><ScanBarcode size={21} color={colors.primary} /></Pressable>
            <Pressable style={styles.headerIconButton} onPress={() => router.push('/inventory/add')} accessibilityRole="button" accessibilityLabel="Add custom item"><Plus size={22} color={colors.primary} /></Pressable>
          </View>
        </View>
        <View style={styles.searchBox}><Search size={18} color="#94A3B8" /><TextInput value={search} onChangeText={setSearch} placeholder="Search food, brand or product..." placeholderTextColor="#98A2B3" style={styles.searchInput} /><SlidersHorizontal size={18} color="#899393" /></View>
        <View style={styles.sectionHeader}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={styles.sectionTitle}>Categories &amp; Aisles</Text><Text style={styles.zonePill}>{areas.length} Zones</Text></View><Pressable onPress={() => router.push('/storage-areas')}><Text style={styles.customize}>Customize</Text></Pressable></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 18 }}>
          {categories.map((name) => { const selectedCategory = name === category; const Icon = name === 'All Products' ? Package : areaIcon(areas.find((area) => area.name === name)); return <Pressable key={name} onPress={() => setCategory(name)} style={[styles.categoryChip, selectedCategory && styles.categoryActive]}><Icon size={19} color={selectedCategory ? 'white' : '#6C8791'} /><View><Text style={[styles.categoryName, selectedCategory && { color: 'white' }]}>{name}</Text><Text style={[styles.categoryCount, selectedCategory && { color: '#DBF5E8' }]}>{name === 'All Products' ? items.length : items.filter((item) => item.area?.name === name).length} items</Text></View></Pressable>; })}
        </ScrollView>
        <View style={styles.catalogHeader}><Text style={styles.catalogTitle}>PRODUCT CATALOG ({visible.length})</Text><Pressable onPress={() => setSort((current) => current === 'Name' ? 'Price: Low to High' : 'Name')}><Text style={styles.sortText}>Sort: <Text style={{ color: colors.primary, fontWeight: '700' }}>{sort}⌄</Text></Text></Pressable></View>
      </View>}
      renderItem={({ item, index }) => <ProductCard item={item} index={index} quantity={cart[item.id] || 0} isHousehold={isHousehold} onCheckout={() => { const next = { ...cart, [item.id]: 1 }; setCart(next); orderCart.set(next); }} onConsume={() => router.push({ pathname: '/inventory/details', params: { id: item.id } })} onQuantity={(quantity) => setQuantity(item, quantity)} />}
      ListEmptyComponent={!loading ? <View style={{ padding: 28, alignItems: 'center' }}><Package size={28} color={colors.textSecondary} /><Text style={{ marginTop: 12, color: colors.textSecondary }}>{search ? 'No products match your search.' : 'No available inventory items yet.'}</Text></View> : null}
      ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} style={{ padding: 32 }} /> : null}
    />
    {!isHousehold && selected.length > 0 && <View style={[styles.cartBar, { left: gutter - 4, right: gutter - 4, bottom: 88 }]}><View style={styles.cartIcon}><ShoppingCart size={21} color="#6CE5BF" /><Text style={styles.cartCount}>{selected.reduce((sum, [, quantity]) => sum + quantity, 0)}</Text></View><View style={{ flex: 1 }}><Text style={styles.cartLabel}>Cart Total</Text><Text style={styles.cartValue}>{money(cartTotal)}</Text></View><Pressable style={styles.cancelButton} onPress={() => { setCart({}); orderCart.clear(); }} accessibilityRole="button" accessibilityLabel="Cancel order and clear cart"><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable style={styles.checkoutButton} onPress={() => { orderCart.set(cart); router.push('/checkout-order'); }}><Text style={styles.checkoutText}>Checkout</Text><ArrowRight size={18} color="#063F2E" /></Pressable></View>}
  </View>;
}

function ProductCard({ item, index, quantity, isHousehold, onCheckout, onConsume, onQuantity }: { item: Product; index: number; quantity: number; isHousehold: boolean; onCheckout: () => void; onConsume: () => void; onQuantity: (quantity: number) => void }) {
  const accent = index % 3 === 1 ? '#059669' : '#F59E0B';
  const [imageFailed, setImageFailed] = useState(false);
  const Icon = areaIcon(item.area);
  const outOfStock = Number(item.quantity ?? 0) <= 0;
  const runningLow = !outOfStock && Number(item.quantity) <= Number(item.low_stock_threshold ?? 2);
  return <View style={[styles.productCard, { borderTopColor: accent }]}>
    <View style={styles.productTop}><View style={styles.productImage}>{item.image_url && !imageFailed ? <Image source={{ uri: item.image_url }} style={styles.image} onError={() => setImageFailed(true)} /> : <Icon size={25} color={colors.primary} />}</View><Text style={[styles.tag, { backgroundColor: outOfStock ? '#E8ECE9' : runningLow ? '#FFF1C2' : '#D5F7E6', color: outOfStock ? '#66746C' : runningLow ? '#94500A' : '#146344' }]} numberOfLines={1}>{outOfStock ? 'Out of stock' : runningLow ? `${item.quantity} left` : 'In Stock'}</Text></View>
    <Text style={styles.price}>{money(Number(item.price || 0))}</Text><Text style={styles.productName} numberOfLines={2}>{item.product_name}</Text><Text style={styles.detail} numberOfLines={1}>{item.quantity} {item.unit} · <Text style={{ color: colors.primary }}>{item.area?.name || item.category || 'Unassigned'}</Text></Text>
    <View style={styles.progressTrack}><View style={[styles.progress, { width: `${Math.min(100, Number(item.quantity || 0) * 20)}%`, backgroundColor: accent }]} /></View>
    {isHousehold ? <Pressable style={[styles.cardButton, outOfStock && styles.cardButtonDisabled]} disabled={outOfStock} onPress={onConsume}><Text style={styles.cardButtonText}>{outOfStock ? 'Out of stock' : 'Consume'}</Text>{!outOfStock && <CheckCircle2 size={16} color="white" />}</Pressable> : quantity > 0 ? <View style={styles.quantityControl}><Pressable onPress={() => onQuantity(quantity - 1)}><Text style={styles.stepper}>−</Text></Pressable><Text style={styles.quantity}>{quantity}</Text><Pressable onPress={() => onQuantity(quantity + 1)}><Text style={styles.stepper}>＋</Text></Pressable></View> : <Pressable style={[styles.cardButton, outOfStock && styles.cardButtonDisabled]} disabled={outOfStock} onPress={onCheckout}><Text style={styles.cardButtonText}>{outOfStock ? 'Out of stock' : 'Check out'}</Text>{!outOfStock && <ArrowRight size={16} color="white" />}</Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.screenBg }, header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 15 }, title: { fontSize: 22, fontWeight: '800', color: '#102A21', letterSpacing: -0.5 }, subtitle: { fontSize: 12, color: '#718096' }, stockPill: { borderRadius: 22, backgroundColor: '#D8F6E7', paddingVertical: 6, paddingHorizontal: 9 }, stockText: { color: '#176145', fontSize: 11, fontWeight: '700' }, headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 }, headerIconButton: { width: 40, height: 40, borderRadius: 14, borderWidth: 1, borderColor: '#E7ECE9', backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' }, searchBox: { height: 48, borderRadius: 16, borderWidth: 1, borderColor: '#E6EBE8', backgroundColor: 'white', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }, searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 }, sectionHeader: { marginTop: 23, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1D2B25' }, zonePill: { backgroundColor: '#DDF7E9', color: '#28694D', fontSize: 11, fontWeight: '700', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 15 }, customize: { color: colors.primary, fontWeight: '600', fontSize: 13 }, categoryChip: { height: 52, minWidth: 128, paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: '#E7ECE9', backgroundColor: 'white', flexDirection: 'row', alignItems: 'center', gap: 9 }, categoryActive: { backgroundColor: '#07543A', borderColor: '#07543A' }, categoryName: { fontSize: 12, fontWeight: '700', color: '#28342D' }, categoryCount: { fontSize: 10, color: '#77828A', marginTop: 2 }, catalogHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, catalogTitle: { fontSize: 13, letterSpacing: 1, fontWeight: '700', color: '#334155' }, sortText: { fontSize: 12, color: '#89929D' }, productCard: { flex: 1, backgroundColor: 'white', borderRadius: 19, padding: 12, borderTopWidth: 3, borderColor: '#EEF1EF', borderWidth: 1, minHeight: 238 }, productTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }, productImage: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFF7E8', borderWidth: 1, borderColor: '#F6EEDC', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, image: { width: '100%', height: '100%' }, tag: { fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, maxWidth: 88 }, price: { fontSize: 18, fontWeight: '800', color: '#103B2A', marginTop: 3 }, productName: { fontSize: 13, color: '#18231E', fontWeight: '600', marginTop: 4, minHeight: 32 }, detail: { fontSize: 11, color: '#697782', marginTop: 2 }, progressTrack: { height: 5, backgroundColor: '#EDF0F4', borderRadius: 5, marginTop: 11, marginBottom: 12 }, progress: { height: 5, borderRadius: 5 }, cardButton: { height: 37, borderRadius: 14, backgroundColor: '#064C34', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, cardButtonDisabled: { backgroundColor: '#9AA69F' }, cardButtonText: { color: 'white', fontSize: 13, fontWeight: '800' }, quantityControl: { height: 37, borderRadius: 14, backgroundColor: '#F8FAF9', borderWidth: 1, borderColor: '#E4EAE6', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, stepper: { fontSize: 17, fontWeight: '700', color: colors.primary }, quantity: { color: '#24322B', fontWeight: '700' }, cartBar: { position: 'absolute', height: 72, borderRadius: 19, backgroundColor: '#06432E', flexDirection: 'row', alignItems: 'center', padding: 11, gap: 8, elevation: 12, shadowColor: '#073F2D', shadowOpacity: 0.2, shadowRadius: 12 }, cartIcon: { width: 38, height: 44, borderRadius: 15, backgroundColor: '#075C40', alignItems: 'center', justifyContent: 'center' }, cartCount: { position: 'absolute', right: -4, top: -5, borderRadius: 10, overflow: 'hidden', backgroundColor: '#F59E0B', color: 'white', fontSize: 10, paddingHorizontal: 4, fontWeight: '800' }, cartLabel: { color: '#80D1B0', fontSize: 12 }, cartValue: { color: 'white', fontSize: 16, fontWeight: '800', marginTop: 2 }, cancelButton: { height: 42, borderRadius: 14, paddingHorizontal: 10, borderWidth: 1, borderColor: '#6CE5BF', alignItems: 'center', justifyContent: 'center' }, cancelText: { color: 'white', fontSize: 11, fontWeight: '700' }, checkoutButton: { height: 46, borderRadius: 15, paddingHorizontal: 10, backgroundColor: '#25C7A1', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, checkoutText: { color: '#073E2C', fontSize: 11, fontWeight: '800' },
});
