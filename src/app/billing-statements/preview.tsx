import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { getBillingStatementPreview } from '@/features/billing-statements/billing-statement-pdf';
import { colors } from '@/theme/colors';

export default function BillingStatementPreviewScreen() {
  const { statementId } = useLocalSearchParams<{ statementId: string }>();
  const db = useSQLiteContext();
  const [preview, setPreview] = useState<{ bsNumber: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!statementId) return;
    void getBillingStatementPreview(db, statementId)
      .then(setPreview)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load the billing statement preview.'));
  }, [db, statementId]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: preview?.bsNumber ? `${preview.bsNumber} Preview` : 'Billing Statement Preview' }} />
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
