import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { getServiceReportPreview } from '@/features/service-reports/service-report-pdf';
import { colors } from '@/theme/colors';

export default function ServiceReportPreviewScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const db = useSQLiteContext();
  const [preview, setPreview] = useState<{ csrNumber: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;
    void getServiceReportPreview(db, reportId)
      .then(setPreview)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load the CSR preview.'));
  }, [db, reportId]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: preview?.csrNumber ? `${preview.csrNumber} Preview` : 'CSR PDF Preview' }} />
      {preview ? (
        <WebView
          originWhitelist={['*']}
          javaScriptEnabled={false}
          showsVerticalScrollIndicator
          source={{ html: preview.html }}
          startInLoadingState
          renderLoading={() => <ActivityIndicator color={colors.brandBlue} size="large" style={styles.loading} />}
          style={styles.webview}
        />
      ) : (
        <View style={styles.centered}>
          {error ? <Text selectable style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.brandBlue} size="large" />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  webview: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  loading: { flex: 1 },
  error: { color: colors.error, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
