import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, text } from '@/theme/typography';

type SheetFrameProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Frames a form screen as a panel on the right with the screen it came from
 * still visible, dimmed, beside it. Tapping the dimmed area closes the form.
 */
export function SheetFrame({ title, onClose, children }: SheetFrameProps) {
  const [available, setAvailable] = useState(0);
  // The space beside the side menu: narrow spaces get a full-width panel.
  const panelWidth = available < 760 ? '100%' : Math.min(600, Math.max(520, Math.round(available * 0.5)));

  return (
    <View style={styles.root} onLayout={(event) => setAvailable(event.nativeEvent.layout.width)}>
      <Pressable accessibilityLabel={`Close ${title}`} onPress={onClose} style={styles.scrim} />
      <View accessibilityViewIsModal style={[styles.panel, { width: panelWidth }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" numberOfLines={2} style={[text.section, styles.title]}>{title}</Text>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed ? styles.closePressed : null]}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.body}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  panel: {
    height: '100%',
    backgroundColor: colors.background,
    boxShadow: '-12px 0 32px rgba(11, 30, 64, 0.22)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  title: { flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  closePressed: { backgroundColor: colors.neutralTint },
  closeText: { color: colors.label, fontSize: fontSize.subhead },
  body: { flex: 1 },
});
