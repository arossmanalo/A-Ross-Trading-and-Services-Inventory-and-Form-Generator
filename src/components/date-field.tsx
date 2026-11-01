import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  formatDisplayDate,
  formatIsoDate,
  isDateAllowed,
  monthName,
  parseIsoDate,
  shiftMonth,
} from '@/domain/calendar';
import { getLocalBusinessDate } from '@/domain/business-date';
import { colors } from '@/theme/colors';

type DateFieldProps = {
  label: string;
  /** YYYY-MM-DD */
  value: string;
  onChange: (value: string) => void;
  /** Latest selectable date (inclusive). Defaults to today unless allowFuture is set. */
  maxDate?: string;
  minDate?: string;
  /** Report ranges may reach past today; business dates may not. */
  allowFuture?: boolean;
  disabled?: boolean;
  hint?: string;
};

/**
 * A date field that opens a small calendar instead of asking for typed text.
 * Value in and out is always a YYYY-MM-DD string.
 */
export function DateField({ label, value, onChange, maxDate, minDate, allowFuture = false, disabled = false, hint }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const today = getLocalBusinessDate();
  const selected = parseIsoDate(value);
  const [view, setView] = useState(() => ({ year: selected?.year ?? Number(today.slice(0, 4)), month: selected?.month ?? Number(today.slice(5, 7)) }));
  const grid = useMemo(() => buildMonthGrid(view.year, view.month), [view.month, view.year]);
  const bounds = { min: minDate, max: allowFuture ? maxDate : (maxDate ?? today) };

  const openCalendar = () => {
    const current = parseIsoDate(value) ?? parseIsoDate(today)!;
    setView({ year: current.year, month: current.month });
    setOpen(true);
  };
  const choose = (iso: string) => {
    setOpen(false);
    onChange(iso);
  };
  const move = (months: number) => setView((current) => shiftMonth(current.year, current.month, months));

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDisplayDate(value)}`}
        accessibilityHint="Opens a calendar"
        disabled={disabled}
        onPress={openCalendar}
        style={({ pressed }) => [styles.field, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
      >
        <Text style={styles.value}>{formatDisplayDate(value)}</Text>
        <Text style={styles.icon}>▦</Text>
      </Pressable>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close calendar" style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} accessibilityViewIsModal onPress={() => undefined}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <View style={styles.monthRow}>
              <NavButton label="‹‹" accessibility="Previous year" onPress={() => move(-12)} />
              <NavButton label="‹" accessibility="Previous month" onPress={() => move(-1)} />
              <Text style={styles.monthTitle}>{monthName(view.month)} {view.year}</Text>
              <NavButton label="›" accessibility="Next month" onPress={() => move(1)} />
              <NavButton label="››" accessibility="Next year" onPress={() => move(12)} />
            </View>
            <View style={styles.weekRow}>
              {WEEKDAY_LABELS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}
            </View>
            {grid.map((week, weekIndex) => (
              <View key={weekIndex} style={styles.weekRow}>
                {week.map((day, dayIndex) => {
                  if (day === null) return <View key={dayIndex} style={styles.cell} />;
                  const iso = formatIsoDate({ year: view.year, month: view.month, day });
                  const allowed = isDateAllowed(iso, bounds);
                  const isSelected = iso === value;
                  return (
                    <Pressable
                      key={dayIndex}
                      accessibilityRole="button"
                      accessibilityLabel={formatDisplayDate(iso)}
                      accessibilityState={{ selected: isSelected, disabled: !allowed }}
                      disabled={!allowed}
                      onPress={() => choose(iso)}
                      style={[styles.cell, styles.dayCell, iso === today ? styles.todayCell : null, isSelected ? styles.selectedCell : null]}
                    >
                      <Text style={[styles.dayText, !allowed ? styles.dayDisabled : null, isSelected ? styles.daySelected : null]}>{day}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <View style={styles.footer}>
              <Pressable accessibilityRole="button" disabled={!isDateAllowed(today, bounds)} onPress={() => choose(today)} style={styles.footerButton}>
                <Text style={isDateAllowed(today, bounds) ? styles.footerText : styles.footerTextDisabled}>Today</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.footerButton}>
                <Text style={styles.footerText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function NavButton({ label, accessibility, onPress }: { label: string; accessibility: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibility} onPress={onPress} style={({ pressed }) => [styles.nav, pressed ? styles.pressed : null]}>
      <Text style={styles.navText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: 7 },
  label: { color: colors.label, fontSize: 14, fontWeight: '700' },
  field: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: 'continuous',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  value: { flex: 1, color: colors.label, fontSize: 16 },
  icon: { color: colors.brandBlue, fontSize: 18 },
  hint: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { alignSelf: 'center', width: '100%', maxWidth: 380, gap: 4, padding: 14, borderCurve: 'continuous', borderRadius: 18, backgroundColor: colors.background },
  sheetTitle: { paddingHorizontal: 4, paddingBottom: 6, color: colors.secondaryLabel, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 },
  monthTitle: { flex: 1, textAlign: 'center', color: colors.label, fontSize: 16, fontWeight: '800' },
  nav: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  navText: { color: colors.brandBlue, fontSize: 20, fontWeight: '800' },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: 6, color: colors.secondaryLabel, fontSize: 11, fontWeight: '800' },
  cell: { flex: 1, height: 44 },
  dayCell: { alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  todayCell: { borderWidth: 1, borderColor: colors.brandBlue },
  selectedCell: { backgroundColor: colors.brandBlue },
  dayText: { color: colors.label, fontSize: 15 },
  dayDisabled: { color: colors.separator },
  daySelected: { color: '#ffffff', fontWeight: '800' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 8 },
  footerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  footerText: { color: colors.brandBlue, fontSize: 14, fontWeight: '800' },
  footerTextDisabled: { color: colors.separator, fontSize: 14, fontWeight: '800' },
});
