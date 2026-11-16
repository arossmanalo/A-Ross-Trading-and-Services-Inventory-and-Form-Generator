import { useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, text } from '@/theme/typography';

type SheetFrameProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/** Starts the panel well past the right edge until its width is known. */
const OFFSCREEN = 4000;
const SLIDE_MS = 220;

function panelWidthFor(available: number): number {
  // The space beside the side menu: narrow spaces get a full-width panel.
  return available < 760 ? available : Math.min(600, Math.max(520, Math.round(available * 0.5)));
}

/**
 * Frames a form screen as a panel on the right with the screen it came from
 * still visible, dimmed, beside it. The panel slides in from the right edge;
 * tapping the dimmed area closes the form.
 */
export function SheetFrame({ title, onClose, children }: SheetFrameProps) {
  const [available, setAvailable] = useState(0);
  const offset = useRef(new Animated.Value(OFFSCREEN)).current;
  const entered = useRef(false);

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setAvailable(width);
    if (entered.current) return;
    entered.current = true;
    offset.setValue(panelWidthFor(width));
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (reduceMotion) {
        offset.setValue(0);
        return;
      }
      Animated.timing(offset, {
        toValue: 0,
        duration: SLIDE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, () => offset.setValue(0));
  };

  return (
    <View style={styles.root} onLayout={handleLayout}>
      <Pressable accessibilityLabel={`Close ${title}`} onPress={onClose} style={styles.scrim} />
      <Animated.View
        accessibilityViewIsModal
        style={[styles.panel, { width: available ? panelWidthFor(available) : '100%', transform: [{ translateX: offset }] }]}
      >
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  panel: {
    height: '100%',
    backgroundColor: colors.surface,
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
