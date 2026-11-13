import { StyleSheet, Text, View } from 'react-native';

import { formatCentavos } from '@/domain/money';
import { colors } from '@/theme/colors';
import { fontSize, text } from '@/theme/typography';

type SalesTotalCardProps = {
  totalCentavos: number;
  count: number;
  /** Noun for the counted documents, for example "service report". */
  noun: string;
  /** Plural when it is not the noun plus "s", for example "deliveries". */
  nounPlural?: string;
  hidden?: boolean;
};

/** Total of the documents currently shown, for a search or a set of filters. */
export function SalesTotalCard({ totalCentavos, count, noun, nounPlural = `${noun}s`, hidden = false }: SalesTotalCardProps) {
  return (
    <View style={styles.card}>
      <Text selectable style={text.meta}>
        Total of sales · {count} {count === 1 ? noun : nounPlural} counted, voided left out
      </Text>
      <Text selectable style={styles.amount}>{hidden ? '₱ ••••••' : formatCentavos(totalCentavos)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 1 },
  amount: { color: colors.label, fontSize: fontSize.subhead, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
