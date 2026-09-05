import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  background: Platform.select({
    ios: Color.ios.systemGroupedBackground,
    android: Color.android.dynamic.surface,
    default: '#f4f7fb',
  })!,
  surface: Platform.select({
    ios: Color.ios.secondarySystemGroupedBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: '#ffffff',
  })!,
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: '#111827',
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: '#5f6877',
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: '#d9dee7',
  })!,
  primary: Platform.select({
    ios: Color.ios.systemBlue,
    android: Color.android.dynamic.primary,
    default: '#0757b8',
  })!,
  onPrimary: Platform.select({
    ios: Color.ios.white,
    android: Color.android.dynamic.onPrimary,
    default: '#ffffff',
  })!,
  error: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.dynamic.error,
    default: '#ba1a1a',
  })!,
  success: '#137333',
  warning: '#9a5b00',
  brandNavy: '#0b377f',
  brandBlue: '#0757b8',
  brandRed: '#ee1c25',
};
