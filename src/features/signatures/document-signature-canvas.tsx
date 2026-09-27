import { useEffect, useRef, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ActionButton } from '@/components/action-button';

export function DocumentSignatureCanvas({
  html,
  signerName,
  disabled,
  onCapture,
  onInteractionStart,
  onInteractionEnd,
}: {
  html: string;
  signerName: string;
  disabled: boolean;
  onCapture: (data: string) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}) {
  const { height } = useWindowDimensions();
  const webview = useRef<WebView>(null);
  const webviewLoaded = useRef(false);
  const signerNameRef = useRef(signerName);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewHeight = Math.min(760, Math.max(480, Math.round(height * 0.68)));

  useEffect(() => {
    signerNameRef.current = signerName;
    if (webviewLoaded.current) {
      webview.current?.injectJavaScript(`window.updateSignerName(${JSON.stringify(signerName)});true;`);
    }
  }, [signerName]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type: string; hasInk?: boolean; data?: string; message?: string };
      if (message.type === 'changed') setHasInk(message.hasInk === true);
      if (message.type === 'signature' && typeof message.data === 'string' && !disabled) onCapture(message.data);
      if (message.type === 'error') setError(message.message ?? 'Could not capture the signature.');
    } catch {
      setError('Could not read the signature. Redraw it and try again.');
    }
  };

  return <View style={{ gap: 12 }}>
    <Text selectable>Draw directly in the signature box on the document. Scroll the document to reach it; use Redraw signature to clear your mark.</Text>
    <View
      onTouchStart={onInteractionStart}
      onTouchEnd={onInteractionEnd}
      onTouchCancel={onInteractionEnd}
      style={{ height: previewHeight, overflow: 'hidden', borderWidth: 1, borderColor: '#64748b', backgroundColor: '#fff' }}
    >
      <WebView
        ref={webview}
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        scrollEnabled
        nestedScrollEnabled
        setBuiltInZoomControls
        setDisplayZoomControls={false}
        onError={() => setError('The document preview could not load. Reopen this screen to retry.')}
        onLoadStart={() => { webviewLoaded.current = false; }}
        onLoadEnd={() => {
          webviewLoaded.current = true;
          webview.current?.injectJavaScript(`window.updateSignerName(${JSON.stringify(signerNameRef.current)});true;`);
        }}
        onMessage={handleMessage}
        style={{ flex: 1, backgroundColor: '#fff' }}
      />
    </View>
    <ActionButton variant="secondary" disabled={disabled} onPress={() => {
      setHasInk(false);
      setError(null);
      webview.current?.injectJavaScript('window.clearSignature();true;');
    }}>Redraw signature</ActionButton>
    <ActionButton disabled={disabled || !hasInk} onPress={() => webview.current?.injectJavaScript('window.exportSignature();true;')}>
      {disabled ? 'Saving…' : 'Save signature draft'}
    </ActionButton>
    {error ? <Text selectable style={{ color: '#b91c1c' }}>{error}</Text> : null}
  </View>;
}
