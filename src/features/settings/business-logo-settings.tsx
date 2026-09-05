import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { getBusinessLogo, saveBusinessLogo } from '@/features/settings/settings-repository';

export function BusinessLogoSettings() {
  const db=useSQLiteContext();
  const [logo,setLogo]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{void getBusinessLogo(db).then(setLogo).catch((e:unknown)=>setError(e instanceof Error?e.message:'Could not load logo.'));},[db]);
  const change = async (remove:boolean) => {
    setBusy(true);setError(null);
    try {
      let value:string|null=null;
      if (!remove) {
        const result=await DocumentPicker.getDocumentAsync({type:['image/png','image/jpeg'],copyToCacheDirectory:true,multiple:false});
        if (result.canceled) return;
        const info=await FileSystem.getInfoAsync(result.assets[0].uri);
        if (!info.exists || info.isDirectory || info.size<=0 || info.size>2*1024*1024) throw new Error('Select a PNG or JPEG no larger than 2 MB.');
        const bytes=await FileSystem.readAsStringAsync(result.assets[0].uri,{encoding:FileSystem.EncodingType.Base64});
        const type=bytes.startsWith('iVBORw0KGgo')?'png':bytes.startsWith('/9j/')?'jpeg':null;
        if (!type) throw new Error('This file is not a PNG or JPEG image.');
        value='data:image/'+type+';base64,'+bytes;
      }
      await saveBusinessLogo(db,value);setLogo(value);
    } catch(e) {setError(e instanceof Error?e.message:'Could not update logo.');} finally {setBusy(false);}
  };
  return <View style={{gap:12}}>
    <Text selectable style={{fontWeight:'700'}}>Business logo</Text>
    {logo?<Image source={{uri:logo}} contentFit="contain" style={{height:100,backgroundColor:'#fff'}}/>:<Text>No logo selected. Documents use the AR text placeholder.</Text>}
    <ActionButton variant="secondary" disabled={busy} onPress={()=>void change(false)}>Choose PNG / JPEG logo</ActionButton>
    {logo?<ActionButton variant="secondary" disabled={busy} onPress={()=>void change(true)}>Clear logo for future documents</ActionButton>:null}
    <Text>Logo images are stored offline and frozen into each new document. Older documents do not change.</Text>
    {error?<Text selectable style={{color:'#b91c1c'}}>{error}</Text>:null}
  </View>;
}
