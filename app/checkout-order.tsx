import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight, FileText, Minus, Plus, MapPin, Package } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';
import { orderCart, type DraftOrderItem } from '../src/services/orderCart';
import type { InventoryItem } from '../src/types';

type Line = { item?: InventoryItem; draft?: DraftOrderItem; quantity: number };
const productName = (line: Line) => line.item?.product_name ?? line.draft?.product_name ?? 'Product';
const productPrice = (line: Line) => Number(line.item?.price ?? line.draft?.price ?? 0);
const productUnit = (line: Line) => line.item?.unit ?? line.draft?.unit ?? 'pcs';
const productStock = (line: Line) => line.item ? Number(line.item.quantity || 0) : 999;
const currency = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OrderCheckoutScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [destination] = useState('Point of Sale');
  const [draftPriceText, setDraftPriceText] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!profile) return;
    const quantities = orderCart.get();
    const drafts = orderCart.getDrafts();
    setDraftPriceText(Object.fromEntries(drafts.map((draft) => [draft.key, draft.price ? String(draft.price) : ''])));
    const ids = Object.keys(quantities).filter((id) => Number(quantities[id]) > 0);
    const result = ids.length
      ? await supabase.from('inventory_items').select('*').eq('user_id', profile.id).in('id', ids).eq('status', 'available')
      : { data: [], error: null };
    setLines([
      ...(result.data || []).map((item: InventoryItem) => ({ item, quantity: Math.min(Number(quantities[item.id]), Number(item.quantity || 0)) })),
      ...drafts.map((draft) => ({ draft, quantity: draft.quantity })),
    ].filter((line: Line) => line.quantity > 0));
    setLoading(false);
  }, [profile]);
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + productPrice(line) * line.quantity, 0), [lines]);
  const totalCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const missingScannedPrice = lines.some((line) => line.draft && productPrice(line) <= 0);
  const adjust = (key: string, delta: number) => setLines((prev) => {
    const next = prev.map((line) => {
      const lineKey = line.item?.id ?? line.draft?.key;
      return lineKey === key ? { ...line, quantity: Math.max(0, Math.min(line.quantity + delta, productStock(line))) } : line;
    }).filter((line) => line.quantity > 0);
    orderCart.set(Object.fromEntries(next.filter((line) => line.item).map((line) => [line.item!.id, line.quantity])));
    orderCart.setDrafts(next.flatMap((line) => line.draft ? [{ ...line.draft, quantity: line.quantity }] : []));
    return next;
  });
  const setDraftPrice = (key: string, text: string) => setLines((prev) => {
    setDraftPriceText((old) => ({ ...old, [key]: text }));
    const parsedPrice = Number(text.replace(',', '.'));
    const price = text.trim() && Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : 0;
    const next = prev.map((line) => line.draft?.key === key
      ? { ...line, draft: { ...line.draft, price } }
      : line);
    orderCart.setDrafts(next.flatMap((line) => line.draft ? [{ ...line.draft, quantity: line.quantity }] : []));
    return next;
  });

  const placeOrder = async () => {
    if (!profile || lines.length === 0 || submitting) return;
    if (missingScannedPrice) {
      Alert.alert('Add a product price', 'Enter a unit price for each newly scanned product before placing the order.');
      return;
    }
    setSubmitting(true);
    try {
      // The database locks and validates all stock rows, writes the order, and
      // deducts stock atomically. The low-stock trigger observes those updates.
      const { data: orderId, error } = await supabase.rpc('place_inventory_order', {
        p_destination: destination,
        p_items: lines.map((line) => line.item
          ? { item_id: line.item.id, quantity: line.quantity }
          : { product_name: line.draft!.product_name, brand: line.draft!.brand, category: line.draft!.category, barcode: line.draft!.barcode, unit: line.draft!.unit, expiration_date: line.draft!.expiration_date, image_url: line.draft!.image_url, price: line.draft!.price, quantity: line.quantity }),
      });
      if (error) throw error;
      orderCart.clear();
      Alert.alert('Check Out Succesfully', 'Your order has been placed.', [
        { text: 'OK', onPress: () => router.replace({ pathname: '/order-receipt', params: { orderId } }) },
      ]);
    } catch (error) {
      const databaseError = error as { message?: string; details?: string; hint?: string; code?: string };
      const diagnostic = [databaseError.message, databaseError.details, databaseError.hint].filter(Boolean).join('\n\n');
      const missingOrderTables = databaseError.code === '42P01' || /inventory_orders|inventory_order_items|place_inventory_order/i.test(databaseError.message || '') && /does not exist|schema cache|could not find/i.test(databaseError.message || '');
      Alert.alert(
        'Could not place order',
        missingOrderTables || /place_inventory_order|function.*does not exist|schema cache/i.test(databaseError.message || '')
          ? 'The checkout migration is missing from your Supabase database. Apply the latest Supabase migrations, then try again.'
          : diagnostic || 'The database did not accept this order. Please try again.',
      );
    } finally { setSubmitting(false); }
  };

  return <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
    <ScrollView contentContainerStyle={{ paddingBottom: 122 }}>
      <View style={styles.topbar}><Pressable style={styles.circle} onPress={() => router.back()}><ArrowLeft size={22} color="#16372A" /></Pressable><View style={{ flex: 1 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Text style={styles.title}>Checkout</Text><Text style={styles.countPill}>{totalCount} items</Text></View><Text style={styles.subtitle}>KeepFresh AI · Sales checkout</Text></View><Pressable style={styles.circle} onPress={() => Alert.alert('Order summary', `${lines.length} product lines selected.`)}><FileText size={20} color="#16372A" /></Pressable></View>
      <View style={[styles.destination, { marginBottom: 22 }]}>
        <View style={styles.destinationIcon}><MapPin size={20} color="#138B64" /></View><View style={{ flex: 1 }}><Text style={styles.eyebrow}>CHECKOUT SESSION <Text style={{ color: '#10B981' }}>●</Text></Text><Text style={styles.destName}>{destination}</Text><Text style={styles.muted}>Items are deducted from available inventory when in stock.</Text></View>
      </View>
      <View style={styles.sectionRow}><Text style={styles.sectionTitle}>SELECTED PRODUCTS ({lines.length})</Text><Text style={styles.auto}><Text style={{ color: '#10B981' }}>●</Text> Inventory and scanned</Text></View>
      {loading ? <ActivityIndicator color={colors.primary} style={{ padding: 36 }} /> : lines.length === 0 ? <View style={styles.empty}><Package size={28} color="#77858B" /><Text style={styles.muted}>Your cart is empty or these items are no longer in stock.</Text><Pressable onPress={() => router.replace('/(tabs)/inventory')}><Text style={styles.change}>Browse products</Text></Pressable></View> : lines.map((line, index) => { const key = line.item?.id ?? line.draft!.key; return <View key={key} style={[styles.lineCard, { borderTopColor: index % 2 ? '#10B981' : '#FBBF24' }]}>
        <View style={styles.lineTop}><View style={styles.productIcon}><Package size={23} color="#138B64" /></View><View style={{ flex: 1 }}><Text style={styles.productName}>{productName(line)}</Text><Text style={styles.productDetails}>{line.item ? `${productStock(line)} ${productUnit(line)}` : `${line.quantity} ${productUnit(line)}`} · <Text style={{ color: colors.primary }}>{line.item?.category || line.draft?.category || (line.item ? 'Inventory' : 'Scanned product')}</Text></Text>{line.item?.expiration_date || line.draft?.expiration_date ? <Text style={styles.freshness}>Best before {line.item?.expiration_date || line.draft?.expiration_date}</Text> : null}</View><View style={{ alignItems: 'flex-end' }}>{line.draft ? <TextInput value={draftPriceText[key] ?? ''} onChangeText={(value) => setDraftPrice(key, value)} placeholder="Unit price" keyboardType="decimal-pad" style={styles.priceInput} /> : <Text style={styles.linePrice}>{currency(productPrice(line) * line.quantity)}</Text>}<Text style={styles.unitPrice}>{currency(productPrice(line))} / unit</Text></View></View>
        <View style={styles.lineFooter}><Text style={styles.itemTotal}>Item total: <Text style={{ color: '#17241D', fontWeight: '700' }}>{currency(productPrice(line) * line.quantity)}</Text></Text><View style={styles.quantityControl}><Pressable onPress={() => adjust(key, -1)}><Minus size={15} color="#59726A" /></Pressable><Text style={styles.quantity}>{line.quantity}</Text><Pressable onPress={() => adjust(key, 1)}><Plus size={15} color={colors.primary} /></Pressable></View></View>
      </View>; })}
      <Pressable style={styles.addMore} onPress={() => router.push('/scan')}><Plus size={18} color="#10A879" /><Text style={styles.addMoreText}>Scan More Products</Text></Pressable>
      <View style={styles.insight}><Text style={{ fontSize: 20 }}>💡</Text><View style={{ flex: 1 }}><Text style={styles.insightTitle}>Checkout summary</Text><Text style={styles.insightCopy}>Inventory stock is deducted when an available item is checked out. New scans are saved on the order.</Text></View></View>
      <View style={styles.summary}><Text style={styles.summaryTitle}>ORDER SUMMARY</Text><SummaryRow label={`Items Total (${totalCount} items)`} value={currency(subtotal)} /><SummaryRow label="Discount" value="₱0.00" green /><SummaryRow label="Delivery" value="₱0.00" /><SummaryRow label="Estimated Tax" value="₱0.00" /><View style={styles.divider} /><View style={styles.totalRow}><View><Text style={styles.totalLabel}>Total Amount</Text><Text style={styles.mutedSmall}>Based on product prices</Text></View><Text style={styles.total}>{currency(subtotal)}</Text></View></View>
      <View style={styles.paymentSection}><Text style={styles.summaryTitle}>PAYMENT METHOD</Text><View style={styles.payment}><View style={[styles.cardIcon, styles.cashIcon]}><Text style={styles.cardIconText}>₱</Text></View><View style={{ flex: 1 }}><Text style={styles.paymentTitle}>Cash</Text><Text style={styles.muted}>Pay with cash when your order is ready.</Text></View><View style={styles.selectedPayment}><Text style={styles.selectedPaymentText}>Selected</Text></View></View><View style={[styles.payment, styles.cashlessPayment]}><View style={[styles.cardIcon, styles.cashlessIcon]}><Text style={styles.cashlessIconText}>•••</Text></View><View style={{ flex: 1 }}><Text style={styles.paymentTitle}>Cashless</Text><Text style={styles.muted}>Coming soon</Text></View></View></View>
    </ScrollView>
    <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}><Pressable disabled={loading || submitting || lines.length === 0} onPress={placeOrder} style={[styles.placeButton, (loading || submitting || !lines.length) && { opacity: 0.6 }]}>{submitting ? <ActivityIndicator color="white" /> : <><Text style={styles.placeText}>Place Order</Text><Text style={styles.totalPill}>{currency(subtotal)}</Text><ArrowRight size={20} color="white" /></>}</Pressable></View>
  </View>;
}

function SummaryRow({ label, value, green }: { label: string; value: string; green?: boolean }) { return <View style={styles.summaryRow}><Text style={[styles.summaryLabel, green && { color: '#297456' }]}>{label}</Text><Text style={[styles.summaryValue, green && { color: '#297456' }]}>{value}</Text></View>; }

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.screenBg }, topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, marginBottom: 18 }, circle: { width: 42, height: 42, borderRadius: 22, backgroundColor: 'white', borderWidth: 1, borderColor: '#E8ECEA', alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 22, fontWeight: '800', color: '#172820' }, countPill: { backgroundColor: '#DDF7E8', color: '#176143', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: '700' }, subtitle: { fontSize: 12, color: '#849099', marginTop: 3 }, destination: { marginHorizontal: 18, borderRadius: 18, padding: 14, backgroundColor: 'white', flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22, shadowColor: '#1D4934', shadowOpacity: 0.05, shadowRadius: 9, elevation: 2 }, destinationIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#E8FAF1', alignItems: 'center', justifyContent: 'center' }, eyebrow: { fontSize: 10, fontWeight: '800', color: '#42715C', letterSpacing: 0.4 }, destName: { fontSize: 13, fontWeight: '700', color: '#25342B', marginTop: 4 }, muted: { fontSize: 11, color: '#87939A', marginTop: 3 }, change: { color: '#15875F', fontSize: 12, fontWeight: '700', backgroundColor: '#F0FBF5', borderColor: '#CDEEDB', borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11 }, sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, marginBottom: 12 }, sectionTitle: { color: '#546371', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 }, auto: { color: '#355846', fontSize: 11, fontWeight: '600' }, lineCard: { marginHorizontal: 18, borderRadius: 19, backgroundColor: 'white', padding: 14, borderTopWidth: 3, marginBottom: 14, shadowColor: '#173C2B', shadowOpacity: 0.045, shadowRadius: 8, elevation: 2 }, lineTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, productIcon: { width: 47, height: 47, borderRadius: 15, backgroundColor: '#EAF8F1', alignItems: 'center', justifyContent: 'center' }, productName: { fontSize: 14, fontWeight: '700', color: '#17231D' }, productDetails: { fontSize: 11, color: '#7A8790', marginTop: 4 }, freshness: { color: '#3684A1', backgroundColor: '#EDF9FC', overflow: 'hidden', borderRadius: 7, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 3, fontSize: 10, marginTop: 5 }, linePrice: { fontSize: 14, fontWeight: '800', color: '#15221A' }, priceInput: { width: 86, height: 35, borderWidth: 1, borderColor: '#DCE7E0', borderRadius: 9, paddingHorizontal: 7, color: '#15221A', fontSize: 12, textAlign: 'right' }, unitPrice: { fontSize: 10, color: '#9AA3AC', marginTop: 3 }, lineFooter: { borderTopWidth: 1, borderColor: '#F0F2F1', marginTop: 12, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, itemTotal: { color: '#95A1A8', fontSize: 11 }, quantityControl: { height: 35, width: 92, borderRadius: 13, borderWidth: 1, borderColor: '#E2E7E9', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#FBFCFC' }, quantity: { fontSize: 12, color: '#19251E', fontWeight: '700' }, addMore: { height: 54, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#89D9BA', marginHorizontal: 18, marginBottom: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, addMoreText: { fontSize: 13, fontWeight: '700', color: '#24543C' }, insight: { marginHorizontal: 18, marginBottom: 15, borderRadius: 17, backgroundColor: '#EAFBF5', borderWidth: 1, borderColor: '#BDEEDB', padding: 14, flexDirection: 'row', gap: 10 }, insightTitle: { color: '#244A39', fontWeight: '700', fontSize: 12 }, optimized: { backgroundColor: '#C9F5E3', color: '#08724E', fontSize: 9, overflow: 'hidden', paddingHorizontal: 5, borderRadius: 5 }, insightCopy: { color: '#577365', fontSize: 11, lineHeight: 16, marginTop: 5 }, summary: { marginHorizontal: 18, marginBottom: 15, borderRadius: 19, backgroundColor: 'white', padding: 16, shadowColor: '#173C2B', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }, summaryTitle: { color: '#93A0AC', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 10 }, summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }, summaryLabel: { color: '#687681', fontSize: 12 }, summaryValue: { color: '#26332D', fontSize: 12, fontWeight: '600' }, divider: { height: 1, backgroundColor: '#EEF1F0', marginVertical: 9 }, totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, totalLabel: { fontSize: 15, fontWeight: '800', color: '#19251E' }, mutedSmall: { color: '#A2AAB0', fontSize: 10, marginTop: 4 }, total: { color: '#16573A', fontWeight: '800', fontSize: 21 }, paymentSection: { marginHorizontal: 18, marginBottom: 15, gap: 9 }, payment: { borderRadius: 16, backgroundColor: 'white', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#E8EEEA' }, cashlessPayment: { opacity: 0.7 }, cardIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, cashIcon: { backgroundColor: '#E8FAF1' }, cashlessIcon: { backgroundColor: '#F1F3F2' }, cardIconText: { color: '#138B64', fontSize: 20, fontWeight: '800' }, cashlessIconText: { color: '#7C8984', fontSize: 14, fontWeight: '800' }, selectedPayment: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#E8FAF1' }, selectedPaymentText: { color: '#138B64', fontSize: 10, fontWeight: '700' }, paymentTitle: { fontSize: 12, fontWeight: '700', color: '#1C2922' }, empty: { marginHorizontal: 18, backgroundColor: 'white', alignItems: 'center', gap: 10, padding: 28, borderRadius: 18 }, bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, backgroundColor: 'rgba(246,248,245,0.97)', borderTopWidth: 1, borderColor: '#E8EEEA' }, placeButton: { height: 56, borderRadius: 18, backgroundColor: '#0D8055', alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row', paddingHorizontal: 17, shadowColor: '#0D8055', shadowOpacity: 0.19, shadowRadius: 10, elevation: 4 }, placeText: { color: 'white', fontWeight: '800', fontSize: 14 }, totalPill: { color: 'white', fontSize: 11, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 13 }, });
