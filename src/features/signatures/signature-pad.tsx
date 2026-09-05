import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ActionButton } from '@/components/action-button';

// All code and pixels are local. Coordinates are normalized to preserve strokes
// when the device rotates; exporting uses a fixed print-resolution canvas.
export const SIGNATURE_PAD_HTML = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:white}canvas{width:100%;height:100%;touch-action:none}</style></head><body><canvas id="pad" aria-label="Draw signature"></canvas><script>
var canvas=document.getElementById('pad'),ctx=canvas.getContext('2d'),strokes=[],active=null;
function send(v){window.ReactNativeWebView.postMessage(JSON.stringify(v));}
function paint(target,w,h){target.fillStyle='white';target.fillRect(0,0,w,h);target.strokeStyle='#111827';target.fillStyle='#111827';target.lineWidth=6;target.lineCap='round';target.lineJoin='round';strokes.forEach(function(s){target.beginPath();s.forEach(function(p,i){if(i===0)target.moveTo(p.x*w,p.y*h);else target.lineTo(p.x*w,p.y*h);});target.stroke();if(s.length===1){target.beginPath();target.arc(s[0].x*w,s[0].y*h,3,0,Math.PI*2);target.fill();}});}
function redraw(){canvas.width=900;canvas.height=450;paint(ctx,900,450);}
function point(e){var r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
canvas.addEventListener('pointerdown',function(e){if(active)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);active={id:e.pointerId,points:[point(e)]};strokes.push(active.points);redraw();send({type:'changed',hasInk:true});});
canvas.addEventListener('pointermove',function(e){if(!active||e.pointerId!==active.id)return;e.preventDefault();active.points.push(point(e));redraw();});
function end(e){if(active&&active.id===e.pointerId)active=null;}
canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
window.clearSignature=function(){strokes=[];active=null;redraw();send({type:'changed',hasInk:false});};
window.exportSignature=function(){if(!strokes.length){send({type:'error',message:'Draw a signature first.'});return;}send({type:'signature',data:canvas.toDataURL('image/png')});};redraw();
</script></body></html>`;

export function SignaturePad({ disabled, onCapture }: { disabled: boolean; onCapture: (data: string) => void }) {
  const webview = useRef<WebView>(null);
  const [hasInk, setHasInk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <View style={{gap:12}}>
    <Text>Draw inside the white box. Saving records this signature permanently.</Text>
    <View pointerEvents={disabled ? 'none' : 'auto'} style={{aspectRatio:2,borderWidth:1,borderColor:'#64748b',backgroundColor:'#fff'}}>
      <WebView ref={webview} source={{html:SIGNATURE_PAD_HTML}} originWhitelist={['*']}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        javaScriptEnabled domStorageEnabled={false} allowFileAccess={false}
        allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never" setSupportMultipleWindows={false} scrollEnabled={false}
        onError={() => setError('Signature pad could not load. Reopen this screen to retry.')}
        onMessage={event => {
          try {
            const message = JSON.parse(event.nativeEvent.data) as {type:string;hasInk?:boolean;data?:string;message?:string};
            if (message.type === 'changed') setHasInk(message.hasInk === true);
            if (message.type === 'signature' && typeof message.data === 'string' && !disabled) onCapture(message.data);
            if (message.type === 'error') setError(message.message ?? 'Could not capture signature.');
          } catch { setError('Could not read signature. Clear it and try again.'); }
        }} />
    </View>
    <ActionButton variant="secondary" disabled={disabled} onPress={() => {setError(null);webview.current?.injectJavaScript('window.clearSignature();true;');}}>Clear drawing</ActionButton>
    <ActionButton disabled={disabled || !hasInk} onPress={() => webview.current?.injectJavaScript('window.exportSignature();true;')}>{disabled ? 'Saving…' : 'Save this signature'}</ActionButton>
    {error ? <Text selectable style={{color:'#b91c1c'}}>{error}</Text> : null}
  </View>;
}
