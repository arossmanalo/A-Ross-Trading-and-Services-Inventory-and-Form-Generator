import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { FINANCIAL_METRICS, getFinancialReport, type FinancialReport, type ReportFilter } from '@/features/reports/financial-report';
import { shareFinancialReport } from '@/features/reports/report-export';
import { colors } from '@/theme/colors';

const PHP = new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});
type LoadedReport = {report:FinancialReport;filter:ReportFilter;customerName:string};

export default function FinancialReportsScreen() {
  const db=useSQLiteContext();
  const today=getLocalBusinessDate();
  const [from,setFrom]=useState(today.slice(0,7)+'-01');
  const [to,setTo]=useState(today);
  const [customers,setCustomers]=useState<CustomerSummary[]>([]);
  const [customerId,setCustomerId]=useState('');
  const [query,setQuery]=useState('');
  const [loaded,setLoaded]=useState<LoadedReport|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const version=useRef(0);
  useFocusEffect(useCallback(()=>{
    const request=++version.current;
    void listCustomers(db).then(rows=>{if(request===version.current)setCustomers(rows);}).catch((e:unknown)=>setError(e instanceof Error?e.message:'Could not load customers.'));
    return ()=>{version.current++;};
  },[db]));
  const generate = async () => {
    const request=++version.current;setBusy(true);setError(null);
    const filter={from,to,customerId};
    try {
      const report=await getFinancialReport(db,filter);
      if (request===version.current) setLoaded({report,filter,customerName:customers.find(c=>c.id===customerId)?.name??'All customers'});
    } catch(e) {setError(e instanceof Error?e.message:'Could not calculate report.');} finally {setBusy(false);}
  };
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:18,gap:16,paddingBottom:44}}>
    <Text selectable>Sales and expenses use statement dates. Collections use payment dates. Outstanding shows today’s balance on statements from the selected period.</Text>
    <FormField label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} editable={!busy}/>
    <FormField label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} editable={!busy}/>
    <FormField label="Find customer (including inactive)" value={query} onChangeText={setQuery}/>
    <ActionButton variant={customerId?'secondary':'primary'} disabled={busy} onPress={()=>setCustomerId('')}>All customers</ActionButton>
    <Text selectable>Selected: {customers.find(c=>c.id===customerId)?.name??'All customers'}</Text>
    {query.trim()?customers.filter(c=>c.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0,15).map(c=><Pressable key={c.id} accessibilityRole="button" disabled={busy} onPress={()=>{setCustomerId(c.id);setQuery('');}} style={{padding:14,backgroundColor:colors.surface,borderRadius:10}}><Text style={{color:colors.label}}>{c.name}{c.active?'':' (inactive)'}</Text></Pressable>):null}
    <ActionButton disabled={busy} onPress={()=>void generate()}>{busy?'Working…':'Generate report'}</ActionButton>
    {loaded?<>
      <Text selectable style={{fontWeight:'700',color:colors.label}}>Results: {loaded.filter.from} to {loaded.filter.to} · {loaded.customerName}</Text>
      <Text selectable>{loaded.report.statementCount} finalized statements</Text>
      {FINANCIAL_METRICS.map(({key,label})=><View key={key} style={{padding:16,gap:6,backgroundColor:colors.surface,borderRadius:12}}><Text selectable style={{color:colors.secondaryLabel}}>{label}</Text><Text selectable style={{color:colors.label,fontSize:23,fontWeight:'700',fontVariant:['tabular-nums']}}>{PHP.format(loaded.report[key]/100)}</Text></View>)}
      <Text selectable>Net Revenue After Recorded Expenses excludes untracked item acquisition and internal labor costs.</Text>
      <ActionButton variant="secondary" disabled={busy} onPress={()=>{
        setBusy(true);setError(null);
        void shareFinancialReport(loaded.report,loaded.filter,loaded.customerName).catch((e:unknown)=>setError(e instanceof Error?e.message:'Export failed.')).finally(()=>setBusy(false));
      }}>Share these results as CSV</ActionButton>
    </>:null}
    {error?<Text selectable style={{color:colors.error}}>{error}</Text>:null}
  </ScrollView>;
}
