import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, spacing, text } from '@/theme/typography';

type OptionRowProps = {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  /** `checkbox` for rows where several can be picked, `radio` for one of many. */
  kind?: 'checkbox' | 'radio';
  disabled?: boolean;
};

/** A full-width selectable row with a check box or radio mark on the left. */
export function OptionRow({ label, detail, selected, onPress, kind = 'radio', disabled = false }: OptionRowProps) {
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityState={{ checked: selected, selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : null,
        pressed && !selected ? styles.rowPressed : null,
        disabled ? styles.rowDisabled : null,
      ]}
    >
      <View
        style={[
          kind === 'checkbox' ? styles.box : styles.radio,
          selected ? styles.markSelected : null,
        ]}
      >
        {selected ? (
          kind === 'checkbox' ? <Text style={styles.tick}>✓</Text> : <View style={styles.dot} />
        ) : null}
      </View>
      <View style={styles.copy}>
        <Text style={text.bodyStrong}>{label}</Text>
        {detail ? <Text style={text.meta}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.accentTint },
  rowPressed: { backgroundColor: colors.neutralTint },
  rowDisabled: { opacity: 0.5 },
  copy: { flex: 1, gap: 2 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  tick: { color: colors.onPrimary, fontSize: 13, lineHeight: 16, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onPrimary },
});
