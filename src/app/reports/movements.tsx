import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import {
  ReportControls,
  ReportEmpty,
  ReportField,
  ReportFieldRow,
  ReportFigure,
  ReportRow,
  ReportScope,
  ReportSummary,
  reportListStyles,
} from '@/components/report-layout';
import { getLocalBusinessDate } from '@/domain/business-date';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import {
  filterMovementReport,
  getInventoryMovementReport,
  movementReportCsv,
  movementTypeLabel,
  type InventoryMovementReportRow,
  type MovementTypeFilter,
} from '@/features/reports/inventory-report';
import { shareCsvReport } from '@/features/reports/report-export';
import { ReportFrame } from '@/components/report-frame';
import { spacing } from '@/theme/typography';

const MOVEMENT_FILTERS: MovementTypeFilter[] = ['all', 'restock', 'sale', 'nonbillable_usage', 'consumption', 'reversal'];

export default function MovementReportScreen() {
  const db = useSQLiteContext();
  const today = getLocalBusinessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [itemId, setItemId] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [movementType, setMovementType] = useState<MovementTypeFilter>('all');
  const [rows, setRows] = useState<InventoryMovementReportRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = items.find(item => item.id === itemId);
  const visibleRows = useMemo(() => filterMovementReport(rows, query), [rows, query]);
  const netQuantity = visibleRows.reduce((sum, row) => sum + row.quantityDelta, 0);
  const outgoingQuantity = visibleRows.reduce((sum, row) => sum + (row.quantityDelta < 0 ? Math.abs(row.quantityDelta) : 0), 0);
  const incomingQuantity = visibleRows.reduce((sum, row) => sum + (row.quantityDelta > 0 ? row.quantityDelta : 0), 0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    void listInventoryItems(db)
      .then(nextItems => {
        if (active) setItems(nextItems);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load inventory items.');
      });
    return () => {
      active = false;
    };
  }, [db]));

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await getInventoryMovementReport(db, { from, to, itemId, movementType }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load movement report.');
    } finally {
      setBusy(false);
    }
  }, [db, from, itemId, movementType, to]);

  const matchingItems = itemQuery.trim()
    ? items.filter(item => [item.name, item.sku ?? '', item.unitLabel].some(value => value.toLowerCase().includes(itemQuery.trim().toLowerCase()))).slice(0, 12)
    : [];

  return (
    <ReportFrame>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={reportListStyles.content}
        data={visibleRows}
        keyExtractor={row => row.id}
        refreshing={busy}
        onRefresh={() => void generate()}
        ListHeaderComponent={(
          <>
            <ReportControls
              intro="Movement reports use the actual recorded movement timestamp and include restocks, sales, non-billable use, manual consumption, and reversals."
              error={error}
              actions={(
                <>
                  <ActionButton disabled={busy} onPress={() => void generate()}>{busy ? 'Working…' : 'Generate movement report'}</ActionButton>
                  <ActionButton
                    variant="secondary"
                    disabled={busy || exporting || visibleRows.length === 0}
                    onPress={() => {
                      setExporting(true);
                      setError(null);
                      void shareCsvReport(movementReportCsv(visibleRows), 'inventory-movements')
                        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Export failed.'))
                        .finally(() => setExporting(false));
                    }}
                  >
                    {exporting ? 'Exporting…' : 'Share filtered movements as CSV'}
                  </ActionButton>
                </>
              )}
            >
              <ReportFieldRow>
                <ReportField><DateField label="From" value={from} onChange={setFrom} disabled={busy} allowFuture /></ReportField>
                <ReportField><DateField label="To" value={to} onChange={setTo} disabled={busy} allowFuture /></ReportField>
              </ReportFieldRow>
              <ReportScope
                label="Find item for report scope"
                allLabel="All items"
                query={itemQuery}
                onQueryChange={setItemQuery}
                selectedTitle={selectedItem?.name ?? null}
                onClear={() => setItemId('')}
                matches={matchingItems.map(item => ({
                  id: item.id,
                  title: item.name,
                  detail: `${item.sku ?? 'No SKU'} · ${item.unitLabel}`,
                }))}
                onPick={(id) => {
                  setItemId(id);
                  setItemQuery('');
                }}
                disabled={busy}
              />
              <ChoiceChips
                label="Movement type"
                options={MOVEMENT_FILTERS.map(value => ({ value, label: value === 'all' ? 'All' : movementTypeLabel(value) }))}
                value={movementType}
                onChange={setMovementType}
                disabled={busy}
              />
            </ReportControls>
            <ReportSummary>
              <ReportFigure label="Rows" value={String(visibleRows.length)} />
              <ReportFigure label="Incoming" value={String(incomingQuantity)} />
              <ReportFigure label="Outgoing" value={String(outgoingQuantity)} />
              <ReportFigure label="Net" value={String(netQuantity)} />
            </ReportSummary>
            <View style={styles.search}>
              <FormField label="Search loaded rows" value={query} onChangeText={setQuery} editable={!busy} />
            </View>
          </>
        )}
        ListEmptyComponent={<ReportEmpty>{busy ? 'Loading…' : 'No movements match these filters.'}</ReportEmpty>}
        renderItem={({ item }) => (
          <ReportRow
            title={item.itemName}
            figure={`${item.quantityDelta > 0 ? '+' : ''}${item.quantityDelta} ${item.unitLabel}`}
            figureTone={item.quantityDelta < 0 ? 'negative' : 'positive'}
            meta={[
              `${movementTypeLabel(item.movementType)} · ${item.description}`,
              `${item.createdAt}${item.serviceReportNumber ? ` · ${item.serviceReportNumber}` : ''}${item.billingStatementNumber ? ` · ${item.billingStatementNumber}` : ''}`,
            ]}
            onPress={() => router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': item.itemId } })}
          />
        )}
      />
    </ReportFrame>
  );
}

const styles = StyleSheet.create({
  search: { padding: spacing.xl, paddingBottom: spacing.md },
});
