import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { colors, radii, spacing, shadow } from '../../src/theme';
import { NavHeader } from '../../src/components/ui';
import { usePageGutter } from '../../src/hooks/useContentLayout';

type Row = { id:string; message_type:string; message_text:string; status:'pending'|'sent'|'delivered'|'failed'; created_at:string };
export default function SmsHistoryScreen() {
  const { profile } = useAuth(); const { gutter } = usePageGutter();
  const [rows,setRows] = useState<Row[]>([]); const [loading,setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const { data,error } = await supabase.from('sms_messages').select('id,message_type,message_text,status,created_at').eq('user_id',profile.id).order('created_at',{ascending:false}).limit(100);
    if (!error) setRows((data ?? []) as Row[]);
    setLoading(false);
  },[profile]);
  useFocusEffect(useCallback(()=>{ load(); },[load]));
  return <View style={styles.container}>
    <NavHeader title="SMS history" subtitle="Delivery status for KeepFresh messages" />
    <ScrollView contentContainerStyle={{padding: gutter, gap: spacing.sm}} refreshControl={<RefreshControl refreshing={loading} onRefresh={load}/> }>
      {!rows.length && !loading ? <Text style={styles.empty}>No SMS messages yet.</Text> : rows.map((row)=><View key={row.id} style={styles.card}>
        <View style={styles.top}><Text style={styles.kind}>{row.message_type.replace('_',' ').toUpperCase()}</Text><Text style={[styles.status,styles[`status_${row.status}`]]}>{row.status.toUpperCase()}</Text></View>
        <Text style={styles.body}>{row.message_text}</Text>
        <Text style={styles.date}>{new Date(row.created_at).toLocaleString()}</Text>
      </View>)}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  container:{flex:1,backgroundColor:colors.screenBg}, card:{backgroundColor:colors.surface,borderRadius:radii.lg,padding:spacing.md,...shadow.card},
  top:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},kind:{fontSize:11,fontWeight:'700',color:colors.textSecondary},status:{fontSize:11,fontWeight:'800'},status_pending:{color:'#A56A00'},status_sent:{color:colors.primary},status_delivered:{color:'#168347'},status_failed:{color:'#B42318'},
  body:{fontSize:14,color:colors.textPrimary,marginTop:spacing.sm},date:{fontSize:11,color:colors.textSecondary,marginTop:spacing.sm},empty:{textAlign:'center',color:colors.textSecondary,marginTop:spacing.xl}
});
