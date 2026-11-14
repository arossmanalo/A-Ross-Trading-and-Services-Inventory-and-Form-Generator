import { StyleSheet, Switch, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

type ToggleRowProps = {
  title: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

/** A labelled on/off row, such as "Returned to stock" or "Charge to customer". */
export function ToggleRow({ title, detail, value, onValueChange }: ToggleRowProps) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleCopy}>
        <Text selectable style={text.bodyStrong}>{title}</Text>
        {detail ? <Text selectable style={text.meta}>{detail}</Text> : null}
      </View>
      <Switch accessibilityLabel={title} onValueChange={onValueChange} value={value} />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  toggleCopy: { flex: 1, gap: 2 },
});
