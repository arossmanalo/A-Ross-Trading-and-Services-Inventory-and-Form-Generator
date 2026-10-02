// These tests exercise bridge/control wiring, not Android's native responder.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>}));
const signing = vi.hoisted(() => ({params: {ownerType:'service_report',ownerId:'owner',role:'customer'},save:vi.fn(),back:vi.fn()}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {...actual,
    useState: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [hooks.slots[index], (value:T) => {hooks.slots[index] = value;}];
    },
    useRef: <T,>(initial:T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = {current:initial};
      return hooks.slots[index];
    },
    useMemo: (factory:()=>unknown,deps:unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as {deps:unknown[];value:unknown} | undefined;
      if (!previous || deps.some((value,i)=>value !== previous.deps[i])) hooks.slots[index] = {deps,value:factory()};
      return (hooks.slots[index] as {value:unknown}).value;
    },
    useEffect: (effect:()=>unknown,deps:unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as unknown[] | undefined;
      if (!previous || deps.some((value,i)=>value !== previous[i])) hooks.effects.push(effect);
      hooks.slots[index] = deps;
    },
  };
});
vi.mock('react-native',()=>({Text:'Text',View:'View',KeyboardAvoidingView:'KeyboardAvoidingView',Platform:{OS:'android'}}));
vi.mock('react-native-webview',()=>({WebView:'WebView'}));
vi.mock('expo-router',()=>({router:{back:signing.back},useLocalSearchParams:()=>signing.params}));
vi.mock('expo-sqlite',()=>({useSQLiteContext:()=> 'db'}));
vi.mock('expo-crypto',()=>({randomUUID:()=> 'request'}));
vi.mock('@/components/action-button',()=>({ActionButton:'ActionButton'}));
vi.mock('@/components/form-field',()=>({FormField:'FormField'}));
vi.mock('@/features/signatures/capture-repository',()=>({saveSignatureCapture:signing.save}));
vi.mock('@/features/signatures/signature-repository',()=>({getSignableDocument:async()=>({documentState:'finalized',documentNumber:'DOC-1',customerName:'Customer',fingerprint:'abc'})}));
vi.mock('@/features/signatures/signature-draft-repository',()=>({
  getSignatureCanvasDocument:async()=>({html:'<html>Frozen document</html>'}),
  listSignatureDrafts:async()=>[],saveSignatureDraft:signing.save,
}));

import CaptureScreen from '@/app/signatures/capture';
import { DocumentSignatureCanvas } from '@/features/signatures/document-signature-canvas';
import { SIGNATURE_PAD_HTML, SignaturePad } from '@/features/signatures/signature-pad';

type Props = {
  children?:ReactNode;source?:unknown;nestedScrollEnabled?:boolean;
  ref?:{current:unknown};onLoadEnd?:()=>void;onPress?:()=>void;
  onMessage?:(event:{nativeEvent:{data:string}})=>void;
  onCapture?:(data:string)=>void;disabled?:boolean;
};
function elements(node:ReactNode):ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node,...elements(node.props.children)];
}
function render<T>(component:()=>T):T {hooks.cursor=0;return component();}

describe('signature controls after drawing',()=>{
  beforeEach(()=>{hooks.slots=[];hooks.effects=[];hooks.cursor=0;vi.clearAllMocks();signing.save.mockResolvedValue(undefined);});

  it.each(['document','default'] as const)('%s keeps its WebView source stable and redraw/save controls callable after strokes',kind=>{
    const capture=vi.fn();const inject=vi.fn();
    const component=()=>kind === 'document'
      ? DocumentSignatureCanvas({html:'<html>Frozen document</html>',signerName:'Customer',disabled:false,onCapture:capture})
      : SignaturePad({disabled:false,onCapture:capture});
    const first=elements(render(component));
    const webview=first.find(node=>node.type === 'WebView')!;
    webview.props.ref!.current={injectJavaScript:inject};
    webview.props.onLoadEnd?.();
    for (let stroke=0;stroke<3;stroke++) {
      webview.props.onMessage?.({nativeEvent:{data:JSON.stringify({type:'changed',hasInk:true})}});
      const tree=elements(render(component));
      const current=tree.find(node=>node.type === 'WebView')!;
      expect(current.props.source).toBe(webview.props.source);
      expect(current.props.nestedScrollEnabled).toBe(false);
      for (const node of tree) {
        expect(node.props).not.toHaveProperty('onTouchStart');
        expect(node.props).not.toHaveProperty('onTouchEnd');
      }
      const save=tree.find(node=>node.props.children === (kind === 'document' ? 'Save signature draft' : 'Save this signature'))!;
      expect(save.props.disabled).toBe(false);
      save.props.onPress?.();
      expect(inject).toHaveBeenLastCalledWith('window.exportSignature();true;');
      current.props.onMessage?.({nativeEvent:{data:JSON.stringify({type:'signature',data:'png'})}});
      expect(capture).toHaveBeenCalledTimes(stroke+1);
      tree.find(node=>node.props.children === 'Redraw signature')?.props.onPress?.();
      expect(inject).toHaveBeenLastCalledWith('window.clearSignature();true;');
      current.props.onMessage?.({nativeEvent:{data:JSON.stringify({type:'changed',hasInk:false})}});
      expect(elements(render(component)).find(node=>node.props.children === save.props.children)?.props.disabled).toBe(true);
    }
  });

  it.each([
    ['service_report','customer'],['service_report','preparer'],
    ['billing_statement','customer'],['billing_statement','preparer'],
  ])('keeps %s/%s signing out of a parent ScrollView and still saves/navigates',async(ownerType,role)=>{
    signing.params={ownerType,ownerId:'owner',role};
    render(CaptureScreen);
    for(const effect of hooks.effects.splice(0)) effect();
    await vi.waitFor(()=>expect(elements(render(CaptureScreen)).some(node=>node.type === DocumentSignatureCanvas)).toBe(true));
    const tree=elements(render(CaptureScreen));
    expect(tree[0].type).toBe('KeyboardAvoidingView');
    expect(tree.some(node=>node.type === 'ScrollView')).toBe(false);
    const canvas=tree.find(node=>node.type === DocumentSignatureCanvas)!;
    expect(canvas.props).not.toHaveProperty('onInteractionStart');
    canvas.props.onCapture?.('png');
    await vi.waitFor(()=>expect(signing.back).toHaveBeenCalledTimes(1));
    expect(signing.save).toHaveBeenCalledWith('db',expect.objectContaining({ownerType,role,pngDataUrl:'png'}));
  });
});

type Pointer = {pointerId:number;clientX:number;clientY:number;preventDefault:()=>void};
function canvasRuntime(html:string) {
  const canvasListeners=new Map<string,(event:Pointer)=>void>();
  const windowListeners=new Map<string,(event:Pointer)=>void>();
  const documentListeners=new Map<string,()=>void>();
  const messages:Array<{type:string;hasInk?:boolean;data?:string}>=[];
  const captured=new Set<number>();
  const canvas={
    parentElement:{classList:{add:vi.fn(),remove:vi.fn()}},
    getContext:()=>({fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),arc:vi.fn(),fill:vi.fn()}),
    getBoundingClientRect:()=>({left:0,top:0,width:600,height:240}),
    addEventListener:(name:string,callback:(event:Pointer)=>void)=>canvasListeners.set(name,callback),
    setPointerCapture:(id:number)=>captured.add(id),
    hasPointerCapture:(id:number)=>captured.has(id),
    releasePointerCapture:(id:number)=>captured.delete(id),
    toDataURL:()=> 'data:image/png;base64,test',
  };
  const document={hidden:false,getElementById:()=>canvas,querySelector:()=>null,addEventListener:(name:string,callback:()=>void)=>documentListeners.set(name,callback)};
  const window={ReactNativeWebView:{postMessage:(message:string)=>messages.push(JSON.parse(message))},addEventListener:(name:string,callback:(event:Pointer)=>void)=>windowListeners.set(name,callback)} as unknown as {
    clearSignature:()=>void;exportSignature:()=>void;cancelSignatureInteraction:()=>void;
  };
  const script=html.match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script,{window,document});
  const pointer={pointerId:1,clientX:20,clientY:20,preventDefault:vi.fn()};
  return {canvasListeners,windowListeners,documentListeners,messages,captured,window,document,pointer};
}

describe('signature pointer lifecycle',()=>{
  const repository=readFileSync(new URL('./signature-draft-repository.ts',import.meta.url),'utf8');
  const script=repository.match(/const script = `([\s\S]*?)`;/)![1];
  it.each(['default','customer','preparer'])('%s releases capture on end/cancel/interruption and can immediately draw again',kind=>{
    const html=kind === 'default' ? SIGNATURE_PAD_HTML : script.replaceAll('${role}',kind);
    for (const finish of ['pointerup','pointercancel','lostpointercapture','outside-up','blur','pagehide','hidden','clear','export','cancel']) {
      const runtime=canvasRuntime(html);
      runtime.canvasListeners.get('pointerdown')!(runtime.pointer);
      expect(runtime.captured.has(1)).toBe(true);
      if (finish === 'outside-up') runtime.windowListeners.get('pointerup')!(runtime.pointer);
      else if (finish === 'blur' || finish === 'pagehide') runtime.windowListeners.get(finish)!(runtime.pointer);
      else if (finish === 'hidden') {runtime.document.hidden=true;runtime.documentListeners.get('visibilitychange')!();}
      else if (finish === 'clear') runtime.window.clearSignature();
      else if (finish === 'export') runtime.window.exportSignature();
      else if (finish === 'cancel') runtime.window.cancelSignatureInteraction();
      else runtime.canvasListeners.get(finish)!(runtime.pointer);
      expect(runtime.captured.size,finish).toBe(0);
      const count=runtime.messages.filter(message=>message.type === 'changed' && message.hasInk).length;
      runtime.canvasListeners.get('pointerdown')!({...runtime.pointer,pointerId:2});
      expect(runtime.messages.filter(message=>message.type === 'changed' && message.hasInk)).toHaveLength(count+1);
      runtime.canvasListeners.get('pointerup')!({...runtime.pointer,pointerId:2});
      runtime.window.exportSignature();
      expect(runtime.messages.at(-1)).toMatchObject({type:'signature'});
    }
  });
});
