import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { FormField } from '@/components/form-field';
import { ReportFrame } from '@/components/report-frame';
import {
  ReportControls,
  ReportEmpty,
  ReportFigure,
  ReportRow,
  ReportSummary,
  reportListStyles,
} from '@/components/report-layout';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { filterStockReport, stockReportCsv, type StockFilter } from '@/features/reports/inventory-report';
import { shareCsvReport } from '@/features/reports/report-export';

const STATUS_OPTIONS: Array<{ value: StockFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'low', label: 'Low stock' },
];

export default function StockReportScreen() {
  const db = useSQLiteContext();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StockFilter>('all');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setItems(await listInventoryItems(db));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load stock.');
    } finally {
      setBusy(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = filterStockReport(items, query, status);

  return (
    <ReportFrame>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={reportListStyles.content}
        data={rows}
        keyExtractor={(item) => item.id}
        refreshing={busy}
        onRefresh={() => void load()}
        ListHeaderComponent={(
          <>
            <ReportControls
              intro="Current stock is calculated from all recorded movements. Tap an item to see its movement history."
              error={error}
              actions={(
                <ActionButton
                  variant="secondary"
                  disabled={busy || exporting}
                  onPress={() => {
                    setExporting(true);
                    setError(null);
                    void shareCsvReport(stockReportCsv(rows), 'stock-report')
                      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Export failed.'))
                      .finally(() => setExporting(false));
                  }}
                >
                  {exporting ? 'Exporting…' : 'Share filtered stock as CSV'}
                </ActionButton>
              )}
            >
              <FormField label="Find item, SKU, or unit" value={query} onChangeText={setQuery} />
              <ChoiceChips label="Show" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
            </ReportControls>
            <ReportSummary>
              <ReportFigure label="Matching items" value={String(rows.length)} />
            </ReportSummary>
          </>
        )}
        ListEmptyComponent={<ReportEmpty>{busy ? 'Loading…' : 'No inventory items match these filters.'}</ReportEmpty>}
        renderItem={({ item }) => {
          const low = item.active && item.currentStock <= item.lowStockThreshold;
          return (
            <ReportRow
              title={`${item.name}${item.active ? '' : ' · Inactive'}`}
              figure={`${item.currentStock} ${item.unitLabel}`}
              figureTone={low ? 'negative' : undefined}
              meta={[`${item.sku ?? 'No SKU'} · Threshold ${item.lowStockThreshold}`]}
              note={low ? { text: 'Low stock', tone: 'error' } : null}
              onPress={() => router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': item.id } })}
            />
          );
        }}
      />
    </ReportFrame>
  );
}
