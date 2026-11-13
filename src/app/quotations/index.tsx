import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { DateRangeFields } from '@/components/date-range-fields';
import { Dropdown } from '@/components/dropdown';
import { ListEmpty, ListPaneHeader, listRowStyles } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip, documentStateTone, sentenceCase } from '@/components/status-chip';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatDisplayDate } from '@/domain/calendar';
import { formatCentavos } from '@/domain/money';
import { isQuotationExpired } from '@/domain/quotation';
import { QuotationDetailView } from '@/features/quotations/quotation-detail-view';
import {
  DEFAULT_QUOTATION_CRITERIA,
  PERIOD_OPTIONS,
  QUOTATION_CONVERSION_OPTIONS,
  QUOTATION_SORT_OPTIONS,
  QUOTATION_STATE_OPTIONS,
  filterQuotations,
  hasActiveQuotationFilters,
  sumQuotationTotals,
  type QuotationCriteria,
} from '@/features/quotations/quotation-filter';
import { listQuotations } from '@/features/quotations/quotation-repository';
import type { QuotationListItem } from '@/features/quotations/quotation-types';
import { colors } from '@/theme/colors';
import { text } from '@/theme/typography';

type QuotationRowProps = {
  quotation: QuotationListItem;
  showTotal: boolean;
  today: string;
  selected: boolean;
  onOpen: (quotationId: string) => void;
};

const QuotationRow = memo(function QuotationRow({ quotation, showTotal, today, selected, onOpen }: QuotationRowProps) {
  const expired = quotation.documentState === 'finalized' && !quotation.convertedKind && isQuotationExpired(quotation.validUntil, today);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(quotation.id)}
      style={({ pressed }) => [listRowStyles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={listRowStyles.titleLine}>
        <Text style={listRowStyles.number}>{quotation.qtNumber ?? 'Draft'}</Text>
        {expired ? <StatusChip label="Expired" tone="neutral" /> : null}
        <StatusChip label={sentenceCase(quotation.documentState)} tone={documentStateTone(quotation.documentState)} />
      </View>
      <Text numberOfLines={1} style={text.bodyStrong}>{quotation.customerName}</Text>
      <View style={listRowStyles.metaLine}>
        <Text numberOfLines={1} style={[text.meta, { flex: 1 }]}>
          {formatDisplayDate(quotation.businessDate)} · valid until {formatDisplayDate(quotation.validUntil)}
        </Text>
        <Text style={text.amount}>{showTotal ? formatCentavos(quotation.totalCentavos) : '₱ ••••••'}</Text>
      </View>
      {quotation.documentState === 'finalized' ? <Text style={text.meta}>PDF {quotation.pdfState.replaceAll('_', ' ')}</Text> : null}
      {quotation.convertedKind ? (
        <Text style={listRowStyles.linkChipText}>Converted · {quotation.convertedKind === 'repair' ? 'Repair (CSR)' : 'Delivery'}</Text>
      ) : null}
    </Pressable>
  );
});

export default function QuotationsScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [rows, setRows] = useState<QuotationListItem[]>([]);
  const [criteria, setCriteria] = useState<QuotationCriteria>(DEFAULT_QUOTATION_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listQuotations(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load quotations.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const today = getLocalBusinessDate();
  const visible = useMemo(() => filterQuotations(rows, criteria, today), [criteria, rows, today]);
  const filtered = hasActiveQuotationFilters(criteria);
  const totals = useMemo(() => sumQuotationTotals(visible), [visible]);
  const activeFilterCount = [criteria.state !== DEFAULT_QUOTATION_CRITERIA.state, criteria.conversion !== DEFAULT_QUOTATION_CRITERIA.conversion, criteria.period !== DEFAULT_QUOTATION_CRITERIA.period].filter(Boolean).length;
  const update = <K extends keyof QuotationCriteria>(key: K, value: QuotationCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));
  const changePeriod = (period: QuotationCriteria['period']) => setCriteria((current) => ({
    ...current,
    period,
    // Start a custom range on today so both calendars show a real date.
    from: period === 'custom' && !current.from ? today : current.from,
    to: period === 'custom' && !current.to ? today : current.to,
  }));

  const openQuotation = useCallback((quotationId: string) => {
    if (split) setSelectedId(quotationId);
    else router.push({ pathname: '/quotations/[quotation-id]', params: { 'quotation-id': quotationId } });
  }, [split]);

  const list = (
    <FlatList
      keyboardShouldPersistTaps="handled"
      data={visible}
      extraData={`${showTotals}:${selectedId}:${split}`}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <QuotationRow quotation={item} showTotal={showTotals} today={today} selected={split && item.id === selectedId} onOpen={openQuotation} />
      )}
      refreshing={loading && rows.length > 0}
      onRefresh={load}
      ListHeaderComponent={(
        <ListPaneHeader
          newLabel="New quotation draft"
          onNew={() => router.push('/quotations/new')}
          query={criteria.query}
          onQueryChange={(value) => update('query', value)}
          searchPlaceholder="QT number, customer, item or service, amount"
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          activeFilterCount={activeFilterCount}
          filters={(
            <>
              <Dropdown label="Status" value={criteria.state} options={QUOTATION_STATE_OPTIONS} onChange={(value) => update('state', value)} />
              <Dropdown label="Conversion" value={criteria.conversion} options={QUOTATION_CONVERSION_OPTIONS} onChange={(value) => update('conversion', value)} />
              <Dropdown label="Date" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
              <Dropdown label="Sort by" value={criteria.sort} options={QUOTATION_SORT_OPTIONS} onChange={(value) => update('sort', value)} />
              {criteria.period === 'custom' ? (
                <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} />
              ) : null}
            </>
          )}
          countLine={`${visible.length} of ${rows.length} quotation${rows.length === 1 ? '' : 's'}`}
          showTotals={showTotals}
          onToggleTotals={() => setShowTotals((current) => !current)}
          onClearFilters={filtered ? () => setCriteria((current) => ({ ...DEFAULT_QUOTATION_CRITERIA, sort: current.sort })) : undefined}
          sales={filtered ? { totalCentavos: totals.totalCentavos, count: totals.count, noun: 'quotation' } : undefined}
          error={error}
        />
      )}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} /> : rows.length && filtered ? (
        <ListEmpty title="No matching quotations" body="Try a different search or clear the filters." />
      ) : (
        <ListEmpty title="No quotations yet" body="A quotation lists the items and services you offer and a valid-until date. Create a draft for a registered customer." />
      )}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      detail={selectedId ? (
        <QuotationDetailView
          key={selectedId}
          embedded
          quotationId={selectedId}
          onDeleted={() => {
            setSelectedId(null);
            void load();
          }}
          onChanged={() => void load()}
        />
      ) : null}
      emptyTitle="Select a quotation"
      emptyBody="Its lines, totals and actions open here. A finalized quotation can become a repair (CSR) or a delivery."
    />
  );
}
