import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { clearSavedPreparerSignature, getSavedPreparerSignature, type SignatureCapture } from '@/features/signatures/capture-repository';

export function SavedSignatureSettings() {
  const db = useSQLiteContext();
  const [saved,setSaved] = useState<SignatureCapture | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    void getSavedPreparerSignature(db).then(setSaved).catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not load signature.'));
  },[db]));
  return <View style={{gap:12}}>
    <Text selectable style={{fontWeight:'700'}}>Saved preparer signature</Text>
    <Text selectable>Used automatically on future CSRs, statements, and payment acknowledgments. Replacing or clearing the default does not change history.</Text>
    {saved ? <><Image source={{uri:saved.png_data_url}} contentFit="contain" style={{height:90,backgroundColor:'#fff'}}/><Text selectable>{saved.signer_name}</Text></> : <Text>No default signature saved.</Text>}
    <ActionButton variant="secondary" disabled={busy} onPress={() => router.push({pathname:'/signatures/capture',params:{ownerType:'settings',ownerId:'business',role:'preparer'}})}>{saved ? 'Replace default signature' : 'Draw preparer signature'}</ActionButton>
    {saved ? <ActionButton variant="secondary" disabled={busy} onPress={() => {
      setBusy(true);setError(null);
      void clearSavedPreparerSignature(db).then(() => setSaved(null)).catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not clear default.')).finally(() => setBusy(false));
    }}>Stop using this default</ActionButton> : null}
    {error ? <Text selectable style={{color:'#b91c1c'}}>{error}</Text> : null}
  </View>;
}
