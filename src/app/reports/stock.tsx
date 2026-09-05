import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { filterStockReport, stockReportCsv, type StockFilter } from '@/features/reports/inventory-report';
import { shareCsvReport } from '@/features/reports/report-export';
import { colors } from '@/theme/colors';

export default function StockReportScreen() {
  const db=useSQLiteContext();
  const [items,setItems]=useState<InventoryItemSummary[]>([]);
  const [query,setQuery]=useState('');const [status,setStatus]=useState<StockFilter>('all');
  const [busy,setBusy]=useState(false);const [exporting,setExporting]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{setBusy(true);setError(null);try{setItems(await listInventoryItems(db));}catch(e){setError(e instanceof Error?e.message:'Could not load stock.');}finally{setBusy(false);}},[db]);
  useFocusEffect(useCallback(()=>{void load();},[load]));
  const rows=filterStockReport(items,query,status);
  return <FlatList contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{padding:18,gap:12,paddingBottom:44}}
    data={rows} keyExtractor={item=>item.id} refreshing={busy} onRefresh={()=>void load()}
    ListHeaderComponent={<View style={{gap:14,marginBottom:16}}>
      <Text selectable>Current stock is calculated from all recorded movements. Tap an item to see its movement history.</Text>
      <FormField label="Find item, SKU, or unit" value={query} onChangeText={setQuery}/>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{(['all','active','inactive','low'] as const).map(value=><ActionButton key={value} compact variant={status===value?'primary':'secondary'} onPress={()=>setStatus(value)}>{value==='low'?'Low stock':value.charAt(0).toUpperCase()+value.slice(1)}</ActionButton>)}</View>
      <Text selectable>{rows.length} matching items</Text>
      <ActionButton variant="secondary" disabled={busy||exporting} onPress={()=>{
        setExporting(true);setError(null);void shareCsvReport(stockReportCsv(rows),'stock-report').catch((e:unknown)=>setError(e instanceof Error?e.message:'Export failed.')).finally(()=>setExporting(false));
      }}>{exporting?'Exporting…':'Share filtered stock as CSV'}</ActionButton>
      {error?<Text selectable style={{color:colors.error}}>{error}</Text>:null}
    </View>}
    ListEmptyComponent={<Text selectable>{busy?'Loading…':'No inventory items match these filters.'}</Text>}
    renderItem={({item})=><Pressable accessibilityRole="button" onPress={()=>router.push({pathname:'/inventory/item/[item-id]',params:{'item-id':item.id}})} style={{padding:16,gap:6,borderRadius:12,backgroundColor:colors.surface}}>
      <Text selectable style={{color:colors.label,fontWeight:'700'}}>{item.name}{item.active?'':' · Inactive'}</Text>
      <Text selectable style={{color:colors.secondaryLabel}}>{item.sku??'No SKU'} · {item.currentStock} {item.unitLabel} · Threshold {item.lowStockThreshold}</Text>
      {item.active&&item.currentStock<=item.lowStockThreshold?<Text style={{color:colors.error}}>Low stock</Text>:null}
    </Pressable>}/>;
}
