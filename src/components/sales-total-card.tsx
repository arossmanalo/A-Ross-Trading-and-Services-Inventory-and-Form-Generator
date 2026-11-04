import { StyleSheet, Text, View } from 'react-native';

import { formatCentavos } from '@/domain/money';
import { colors } from '@/theme/colors';

type SalesTotalCardProps = {
  totalCentavos: number;
  count: number;
  /** Noun for the counted documents, for example "service report". */
  noun: string;
  hidden?: boolean;
};

/** Total of the documents currently shown, for a search or a set of filters. */
export function SalesTotalCard({ totalCentavos, count, noun, hidden = false }: SalesTotalCardProps) {
  return (
    <View style={styles.card}>
      <Text selectable style={styles.label}>TOTAL OF SALES</Text>
      <Text selectable style={styles.amount}>{hidden ? '₱ ••••••' : formatCentavos(totalCentavos)}</Text>
      <Text selectable style={styles.caption}>
        {count} {noun}{count === 1 ? '' : 's'} counted · voided documents are left out
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 3, padding: 14, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#eaf2ff', borderWidth: 1, borderColor: colors.brandBlue },
  label: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  amount: { color: colors.brandNavy, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  caption: { color: colors.secondaryLabel, fontSize: 12 },
});
