import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, radius } from '@/theme/typography';

export type MenuAction = {
  label: string;
  note?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/** A "More" button that lists a document's less frequent actions. */
export function ActionMenu({ actions, label = 'More' }: { actions: ReadonlyArray<MenuAction | null | false>; label?: string }) {
  const [open, setOpen] = useState(false);
  const shown = actions.filter((action): action is MenuAction => Boolean(action));
  if (!shown.length) return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} actions`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed ? styles.pressed : null]}
      >
        <Text style={styles.triggerText}>{label} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close menu" style={styles.backdrop} onPress={() => setOpen(false)}>
          <View accessibilityViewIsModal style={styles.menu}>
            {shown.map((action, index) => (
              <Pressable
                key={action.label}
                accessibilityRole="menuitem"
                accessibilityState={{ disabled: Boolean(action.disabled) }}
                disabled={action.disabled}
                onPress={() => {
                  setOpen(false);
                  action.onPress();
                }}
                style={({ pressed }) => [
                  styles.item,
                  index > 0 ? styles.itemDivider : null,
                  pressed ? styles.itemPressed : null,
                  action.disabled ? styles.disabled : null,
                ]}
              >
                <Text style={[styles.itemLabel, action.destructive ? styles.destructive : null]}>{action.label}</Text>
                {action.note ? <Text style={styles.itemNote}>{action.note}</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  triggerText: { color: colors.label, fontSize: fontSize.body, fontWeight: '600' },
  pressed: { opacity: 0.75 },
  backdrop: { flex: 1, alignItems: 'flex-end', paddingTop: 72, paddingRight: 24, backgroundColor: 'rgba(11, 30, 64, 0.18)' },
  menu: {
    width: 300,
    maxWidth: '90%',
    paddingVertical: 4,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    boxShadow: '0 12px 32px rgba(11, 30, 64, 0.18)',
  },
  item: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  itemDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  itemPressed: { backgroundColor: colors.subtleSurface },
  itemLabel: { color: colors.label, fontSize: fontSize.body, fontWeight: '500' },
  itemNote: { color: colors.secondaryLabel, fontSize: fontSize.meta },
  destructive: { color: colors.error, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
