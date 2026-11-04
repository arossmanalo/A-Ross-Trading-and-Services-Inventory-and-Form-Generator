import { StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';

type DateRangeFieldsProps = {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
};

/** The two calendars of a custom date range, side by side. */
export function DateRangeFields({ from, to, onChange }: DateRangeFieldsProps) {
  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <DateField label="From" value={from} maxDate={to || undefined} onChange={(value) => onChange({ from: value, to })} />
      </View>
      <View style={styles.cell}>
        <DateField label="To" value={to} minDate={from || undefined} onChange={(value) => onChange({ from, to: value })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexGrow: 1, flexBasis: 200 },
});
