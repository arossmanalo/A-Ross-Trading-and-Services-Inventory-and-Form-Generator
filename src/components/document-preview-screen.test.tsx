// Event-wiring tests; native touch behavior still requires tablet acceptance.
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>}));
const signing = vi.hoisted(() => ({finalize: vi.fn(), render: vi.fn(), draft: vi.fn(), capture: vi.fn()}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [harness.slots[index], (value: T) => {harness.slots[index] = value;}];
    },
    useRef: <T,>(initial: T) => {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = {current:initial};
      return harness.slots[index];
    },
    useMemo: (factory: () => unknown) => factory(),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      const index = harness.cursor++;
      const previous = harness.slots[index] as unknown[] | undefined;
      if (!previous || deps.some((value, i) => value !== previous[i])) harness.effects.push(effect);
      harness.slots[index] = deps;
    },
  };
});
vi.mock('react-native', () => ({ActivityIndicator:'ActivityIndicator',Button:'Button',Modal:'Modal',ScrollView:'ScrollView',Text:'Text',View:'View',Pressable:'Pressable',StyleSheet:{create:(styles:unknown)=>styles},useWindowDimensions:()=>({width:800,height:1000})}));
vi.mock('expo-router', () => ({Stack:{Screen:'Screen'}}));
vi.mock('expo-sqlite', () => ({useSQLiteContext:()=> 'database'}));
vi.mock('expo-media-library/legacy', () => ({requestPermissionsAsync:vi.fn(),saveToLibraryAsync:vi.fn()}));
vi.mock('expo-print', () => ({printToFileAsync:vi.fn(),printAsync:vi.fn()}));
vi.mock('expo-sharing', () => ({isAvailableAsync:vi.fn(),shareAsync:vi.fn()}));
vi.mock('react-native-view-shot', () => ({captureRef:vi.fn(),releaseCapture:vi.fn()}));
vi.mock('react-native-webview', () => ({WebView:'WebView'}));
vi.mock('@/theme/colors', () => ({colors:{brandBlue:'#0755ad',background:'#fff',secondaryLabel:'#555',label:'#111',separator:'#ddd',surface:'#eee',error:'#b91c1c',success:'#15803d'}}));
vi.mock('@/features/billing-statements/billing-statement-pdf', () => ({getBillingStatementPreview:vi.fn()}));
vi.mock('@/features/service-reports/service-report-pdf', () => ({getServiceReportPreview:vi.fn()}));
vi.mock('@/features/signatures/capture-repository', () => ({getSignatureCapturePreview:signing.capture}));
vi.mock('@/features/signatures/capture-pdf', () => ({renderSignaturePdf:signing.render}));
vi.mock('@/features/signatures/signature-draft-repository', () => ({finalizeSignatureDrafts:signing.finalize,getSignatureDraftPreview:signing.draft}));
import { DocumentPreviewScreen } from '@/components/document-preview-screen';
import { ActionButton } from '@/components/action-button';

type Props = {children?:ReactNode;title?:string;onPress?:()=>void;visible?:boolean;disabled?:boolean};
function allElements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(allElements);
  if (!isValidElement<Props>(node)) return [];
  return [node,...allElements(node.props.children)];
}

describe('signature preview confirmation wiring', () => {
  beforeEach(() => {
    harness.slots=[];harness.effects=[];harness.cursor=0;
    vi.clearAllMocks();
    signing.draft.mockResolvedValue({number:'DOC-1',html:'<html><head></head><body>Draft signature</body></html>'});
    signing.capture.mockResolvedValue({number:'DOC-1',html:'<html><head></head><body>Finalized signature</body></html>'});
    signing.finalize.mockResolvedValue('capture-1');
    signing.render.mockImplementation(() => new Promise(() => {}));
  });

  it.each(['csr','billing_statement'] as const)('the %s button opens confirmation and commits without waiting for the printer',async kind => {
    const render = () => {harness.cursor=0;return DocumentPreviewScreen({documentId:'owner-1',kind,signatureDraft:true});};
    render();
    for (const effect of harness.effects.splice(0)) effect();
    await vi.waitFor(() => expect(allElements(render()).some(node => node.props.title === 'Finalize signature')).toBe(true));
    let tree = render();
    const button = allElements(tree).find(node => node.props.title === 'Finalize signature');
    expect(button?.props.disabled).toBe(false);
    button?.props.onPress?.();
    tree = render();
    expect(allElements(tree).find(node => node.type === 'Modal')?.props.visible).toBe(true);
    const confirm = allElements(tree).find(node => node.props.title === 'Confirm finalization');
    confirm?.props.onPress?.();
    confirm?.props.onPress?.(); // Same-frame duplicate must not create another request.
    await vi.waitFor(() => expect(signing.render).toHaveBeenCalled());
    expect(signing.finalize).toHaveBeenCalledTimes(1);
    expect(signing.finalize).toHaveBeenCalledWith('database',kind === 'csr' ? 'service_report' : 'billing_statement','owner-1');
    tree = render();
    expect(allElements(tree).find(node => node.type === 'Modal')?.props.visible).toBe(false);
    expect(allElements(tree).some(node => node.props.title === 'Finalize signature')).toBe(false);
    expect(allElements(tree).some(node => node.props.children === 'Save / share PDF')).toBe(true);
  });

  it('shows persistence errors and allows retry rather than silently losing the signature',async()=>{
    signing.finalize.mockRejectedValueOnce(new Error('Database unavailable'));
    const render = () => {harness.cursor=0;return DocumentPreviewScreen({documentId:'owner-1',kind:'csr',signatureDraft:true});};
    render();for(const effect of harness.effects.splice(0)) effect();
    await vi.waitFor(() => expect(allElements(render()).some(node => node.props.title === 'Finalize signature')).toBe(true));
    allElements(render()).find(node => node.props.title === 'Finalize signature')?.props.onPress?.();
    allElements(render()).find(node => node.props.title === 'Confirm finalization')?.props.onPress?.();
    await vi.waitFor(() => expect(allElements(render()).some(node => node.props.children === 'Database unavailable')).toBe(true));
    expect(allElements(render()).find(node => node.props.title === 'Finalize signature')?.props.disabled).toBe(false);
    expect(signing.render).not.toHaveBeenCalled();
  });

  it('button text cannot claim touches through text selection',()=>{
    const element = ActionButton({children:'Finalize',onPress:vi.fn()});
    const text = allElements(element).find(node => node.type === 'Text');
    expect(text?.props).not.toHaveProperty('selectable',true);
    expect(text?.props).toHaveProperty('pointerEvents','none');
  });

  it('keeps the signature finalized when derived PDF generation fails',async()=>{
    signing.render.mockRejectedValueOnce(new Error('Storage full'));
    const render = () => {harness.cursor=0;return DocumentPreviewScreen({documentId:'owner-1',kind:'billing_statement',signatureDraft:true});};
    render();for(const effect of harness.effects.splice(0)) effect();
    await vi.waitFor(() => expect(allElements(render()).some(node => node.props.title === 'Finalize signature')).toBe(true));
    allElements(render()).find(node => node.props.title === 'Finalize signature')?.props.onPress?.();
    allElements(render()).find(node => node.props.title === 'Confirm finalization')?.props.onPress?.();
    await vi.waitFor(() => expect(allElements(render()).some(node => typeof node.props.children === 'string' && node.props.children.includes('Storage full'))).toBe(true));
    expect(allElements(render()).some(node => node.props.children === 'Save / share PDF')).toBe(true);
    expect(allElements(render()).some(node => node.props.title === 'Finalize signature')).toBe(false);
    expect(signing.finalize).toHaveBeenCalledTimes(1);
  });
});
