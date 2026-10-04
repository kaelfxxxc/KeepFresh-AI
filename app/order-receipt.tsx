import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, CheckCircle2, Printer, Share2 } from 'lucide-react-native';
import { useAuth } from '../src/context/AuthContext';
import { supabase } from '../src/lib/supabase';
import { colors } from '../src/theme';

type Receipt = {
  id: string;
  destination: string;
  status: string;
  subtotal: number;
  total: number;
  created_at: string;
  items: { id: string; product_name: string; quantity: number; unit: string; unit_price: number; line_total: number }[];
};

const money = (amount: number) => `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OrderReceiptScreen() {
  const insets = useSafeAreaInsets();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { profile } = useAuth();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReceipt = useCallback(async () => {
    if (!profile || !orderId) return;
    const { data, error } = await supabase.from('inventory_orders')
      .select('id,destination,status,subtotal,total,created_at,inventory_order_items(id,product_name,quantity,unit,unit_price,line_total)')
      .eq('id', orderId)
      .eq('user_id', profile.id)
      .single();
    if (error) {
      Alert.alert('Receipt unavailable', 'The saved order could not be loaded.');
      setReceipt(null);
    } else if (data) {
      setReceipt({ ...data, items: data.inventory_order_items || [] } as Receipt);
    }
    setLoading(false);
  }, [orderId, profile]);

  useEffect(() => { loadReceipt(); }, [loadReceipt]);

  const receiptText = receipt ? [
    'KEEPFRESH AI — ORDER RECEIPT',
    `Receipt: ${receipt.id.toUpperCase()}`,
    `Date: ${new Date(receipt.created_at).toLocaleString()}`,
    `Customer: ${profile?.full_name || profile?.email || 'Account holder'}`,
    `Destination: ${receipt.destination}`,
    `Status: ${receipt.status}`,
    '',
    ...receipt.items.map((item) => `${item.product_name} — ${item.quantity} ${item.unit} × ${money(Number(item.unit_price))} = ${money(Number(item.line_total))}`),
    '',
    `TOTAL: ${money(Number(receipt.total))}`,
    'Payment method: Cash (not marked as paid)',
  ].join('\n') : '';

  const printReceipt = async () => {
    if (!receipt) return;
    // The native print module is not available in the installed app. The system
    // share sheet exposes the platform print action (such as AirPrint) where supported.
    await Share.share({ title: 'KeepFresh Order Receipt', message: receiptText });
  };

  const shareReceipt = async () => {
    if (receiptText) await Share.share({ title: 'KeepFresh Order Receipt', message: receiptText });
  };

  return <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.replace('/(tabs)/inventory')}><ArrowLeft size={21} color="#153D2D" /></Pressable><View style={{ flex: 1 }}><Text style={styles.headerTitle}>Order Receipt</Text><Text style={styles.headerSub}>{receipt ? `KeepFresh AI · #${receipt.id.slice(0, 8).toUpperCase()}` : 'Saved order details'}</Text></View><Pressable style={styles.shareIcon} onPress={shareReceipt}><Share2 size={19} color="#153D2D" /></Pressable></View>
    {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : !receipt ? <View style={styles.errorBox}><Text style={styles.body}>This receipt could not be loaded from your saved orders.</Text></View> : <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
        <View style={styles.confirm}><CheckCircle2 size={24} color="#0D9369" /><View style={{ flex: 1 }}><Text style={styles.confirmTitle}>Order saved</Text><Text style={styles.body}>This receipt was loaded from your order record.</Text></View></View>
        <View style={styles.paper}>
          <View style={styles.paperTop} />
          <View style={styles.brand}><View style={styles.brandMark}><Text style={styles.brandGlyph}>K</Text></View><Text style={styles.brandName}>KeepFresh AI</Text><Text style={styles.body}>ORDER RECEIPT</Text></View>
          <View style={styles.dashed} />
          <ReceiptMeta label="RECEIPT NO." value={`#${receipt.id.slice(0, 8).toUpperCase()}`} />
          <ReceiptMeta label="DATE & TIME" value={new Date(receipt.created_at).toLocaleString()} />
          <ReceiptMeta label="CUSTOMER" value={profile?.full_name || profile?.email || 'Account holder'} />
          <ReceiptMeta label="DESTINATION" value={receipt.destination} />
          <ReceiptMeta label="ORDER STATUS" value={receipt.status.toUpperCase()} />
          <View style={styles.dashed} />
          <View style={styles.tableHead}><Text style={[styles.tableLabel, { flex: 1 }]}>ITEM DESCRIPTION</Text><Text style={styles.tableLabel}>QTY</Text><Text style={[styles.tableLabel, { width: 88, textAlign: 'right' }]}>TOTAL</Text></View>
          {receipt.items.map((item) => <View key={item.id} style={styles.itemRow}><View style={{ flex: 1 }}><Text style={styles.itemName}>{item.product_name}</Text><Text style={styles.body}>{money(Number(item.unit_price))} / {item.unit}</Text></View><Text style={styles.body}>{item.quantity}</Text><Text style={styles.itemAmount}>{money(Number(item.line_total))}</Text></View>)}
          <View style={styles.dashed} />
          <ReceiptMeta label="SUBTOTAL" value={money(Number(receipt.subtotal))} />
          <ReceiptMeta label="PAYMENT" value="Cash · pending" />
          <View style={styles.totalRow}><Text style={styles.totalLabel}>TOTAL DUE</Text><Text style={styles.total}>{money(Number(receipt.total))}</Text></View>
          <Text style={styles.footerNote}>Order placed successfully. Cash payment has not been recorded as settled.</Text>
        </View>
      </ScrollView>
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 12) }]}><Pressable style={styles.printButton} onPress={printReceipt}><Printer size={18} color="white" /><Text style={styles.printText}>Print Receipt</Text></Pressable><Pressable style={styles.downloadButton} onPress={shareReceipt}><Share2 size={18} color="#176143" /></Pressable></View>
    </>}
  </View>;
}

function ReceiptMeta({ label, value }: { label: string; value: string }) {
  return <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text style={styles.metaValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#EFFBF1' }, header: { height: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: '#DDECE0' }, back: { width: 38, height: 38, justifyContent: 'center' }, headerTitle: { color: '#16372A', fontSize: 17, fontWeight: '800' }, headerSub: { color: '#73837A', fontSize: 11, marginTop: 2 }, shareIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }, confirm: { backgroundColor: 'white', borderColor: '#C8EFDA', borderWidth: 1, padding: 14, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 15 }, confirmTitle: { color: '#16372A', fontSize: 13, fontWeight: '800', marginBottom: 3 }, body: { color: '#6F7E76', fontSize: 11, lineHeight: 16 }, paper: { backgroundColor: 'white', borderRadius: 18, overflow: 'hidden', paddingHorizontal: 18, paddingBottom: 22, elevation: 2 }, paperTop: { height: 7, backgroundColor: '#07543A', marginHorizontal: -18, marginBottom: 20 }, brand: { alignItems: 'center', marginBottom: 18 }, brandMark: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E8F7EE', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, brandGlyph: { color: '#07543A', fontSize: 20, fontWeight: '900' }, brandName: { color: '#17382B', fontSize: 17, fontWeight: '800', marginBottom: 3 }, dashed: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#D8E1DC', marginVertical: 12 }, metaRow: { minHeight: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, metaLabel: { color: '#77837D', fontSize: 9, fontWeight: '700', letterSpacing: 0.3, flex: 1 }, metaValue: { color: '#22342B', fontSize: 10, fontWeight: '600', textAlign: 'right', flex: 1.3 }, tableHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#E5EAE7' }, tableLabel: { color: '#56645C', fontSize: 9, fontWeight: '800' }, itemRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: '#EEF1EF', paddingVertical: 8 }, itemName: { color: '#1C2E24', fontSize: 11, fontWeight: '700', marginBottom: 3 }, itemAmount: { color: '#263B30', fontSize: 10, fontWeight: '700', width: 88, textAlign: 'right' }, totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 13, marginTop: 6, borderTopWidth: 1, borderColor: '#DDE5E0' }, totalLabel: { color: '#16372A', fontSize: 15, fontWeight: '900' }, total: { color: '#07543A', fontSize: 21, fontWeight: '900' }, footerNote: { color: '#78857E', fontSize: 9, textAlign: 'center', lineHeight: 14, marginTop: 16 }, actionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 11, backgroundColor: 'rgba(239,251,241,0.98)', borderTopWidth: 1, borderColor: '#DDECE0', flexDirection: 'row', gap: 10 }, printButton: { height: 52, flex: 1, borderRadius: 18, backgroundColor: '#06432E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, printText: { color: 'white', fontSize: 13, fontWeight: '800' }, downloadButton: { width: 52, height: 52, borderRadius: 18, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D8E7DC' }, errorBox: { margin: 20, backgroundColor: 'white', borderRadius: 16, padding: 20 },
});
