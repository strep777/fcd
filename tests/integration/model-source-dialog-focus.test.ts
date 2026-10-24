import {afterEach,expect,it,vi} from 'vitest';
import {createRenderer,defineComponent,h,markRaw,nextTick,reactive,ssrContextKey} from 'vue';
import ModelSourceDialog from '../../apps/desktop/src/ModelSourceDialog.vue';

// Run the actual SFC setup and exposed methods with a tiny focus-capable DOM.
// Native browser Tab behavior is deliberately absent: every observed move must
// come from the component's keyboard handling, including an active body.
class Control {
 disabled=false;hidden=false;tabIndex=0;isConnected=true;
 focus(){(document as any).activeElement=this;}
 matches(selector:string){return selector===':disabled'&&this.disabled;}
 getClientRects(){return this.hidden?[]:[{}];}
}
class Dialog extends Control {
 open=false;controls:Control[]=[];
 constructor(){super();this.tabIndex=-1;}
 showModal(){this.open=true;(document as any).body.focus();}
 close(){this.open=false;(document as any).body.focus();}
 querySelectorAll(){return this.controls;}
}
class Key extends Event {constructor(readonly key:string,readonly shiftKey=false){super('keydown',{cancelable:true});}}
// Node EventTarget does not normalize boolean capture on removeEventListener;
// the browser DOM does. Keep the fixture's listener removal browser-correct.
class DocumentEvents extends EventTarget {override removeEventListener(type:string,listener:EventListenerOrEventListenerObject|null,options?:boolean|EventListenerOptions){super.removeEventListener(type,listener,typeof options==='boolean'?{capture:options}:options);}}
const mountedApps:{unmount:()=>void}[]=[];
afterEach(()=>{for(const app of mountedApps.splice(0))app.unmount();vi.unstubAllGlobals();});
function setup(){
 const events=new DocumentEvents(),body=markRaw(new Control()),trigger=markRaw(new Control()),dialog=markRaw(new Dialog()),controls=Array.from({length:5},()=>markRaw(new Control()));dialog.controls=controls;
 vi.stubGlobal('HTMLElement',Control);vi.stubGlobal('document',Object.assign(events,{body,activeElement:trigger}));
 const props=reactive({language:'zh' as const,busy:false,scale:1,notice:''});let vm:any;
 const renderer=createRenderer<any,any>({createComment:()=>({}),createElement:()=>({}),createText:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){},insert(){},remove(){}});
 // The generated SFC constructor type cannot describe replacing only render;
 // its real setup, props and exposed methods are retained in this fixture.
 const Component={...ModelSourceDialog,render:()=>null} as unknown as typeof ModelSourceDialog,app=renderer.createApp(defineComponent({setup(){return ()=>h(Component,{...props,ref:value=>{vm=value;}});}}));app.provide(ssrContextKey,{modules:new Set()});app.mount({});mountedApps.push(app);
 vm.$.refs.dialog=dialog;
 const key=(name:string,shift=false)=>{const event=new Key(name,shift);events.dispatchEvent(event);return event;};
 return {app,vm,props,body,trigger,dialog,controls,key,active:()=>document.activeElement};
}
async function flush(){await nextTick();await nextTick();}

it('focuses an enabled control on open and keeps repeated Tab and Shift+Tab inside the modal',()=>{
 const ui=setup();ui.vm.open();expect(ui.dialog.open).toBe(true);expect(ui.active()).toBe(ui.controls[0]);
 for(let i=0;i<13;i++){expect(ui.key('Tab').defaultPrevented).toBe(true);expect(ui.active()).toBe(ui.controls[(i+1)%5]);}
 ui.controls[0].focus();expect(ui.key('Tab',true).defaultPrevented).toBe(true);expect(ui.active()).toBe(ui.controls.at(-1));ui.key('Tab',true);expect(ui.active()).toBe(ui.controls[3]);
});
it('recaptures Tab from body or no active element and skips disabled, hidden and negative-tabindex controls',()=>{
 const ui=setup();ui.controls[1].disabled=true;ui.controls[2].hidden=true;ui.controls[3].tabIndex=-1;ui.vm.open();
 ui.key('Tab');expect(ui.active()).toBe(ui.controls[4]);ui.key('Tab');expect(ui.active()).toBe(ui.controls[0]);
 ui.body.focus();ui.key('Tab');expect(ui.active()).toBe(ui.controls[0]);(document as any).activeElement=null;ui.key('Tab',true);expect(ui.active()).toBe(ui.controls[4]);
});
it('keeps busy Escape inside the dialog and restores internal focus when a cancelled picker enables controls',async()=>{
 const ui=setup();ui.vm.open();ui.props.busy=true;ui.controls.forEach(control=>{control.disabled=true;});await flush();ui.body.focus();ui.key('Tab');expect(ui.active()).toBe(ui.dialog);
 expect(ui.key('Escape').defaultPrevented).toBe(true);expect(ui.dialog.open).toBe(true);
 ui.props.busy=false;ui.controls.forEach(control=>{control.disabled=false;});await flush();expect(ui.active()).toBe(ui.controls[0]);
 ui.key('Escape');expect(ui.dialog.open).toBe(false);expect(ui.active()).toBe(ui.trigger);
});
it('preserves a valid internal selection after busy work and ignores open while busy',async()=>{
 const ui=setup();ui.props.busy=true;await flush();ui.vm.open();expect(ui.dialog.open).toBe(false);expect(ui.active()).toBe(ui.trigger);
 ui.props.busy=false;await flush();ui.vm.open();ui.controls[3].focus();ui.props.busy=true;await flush();ui.props.busy=false;await flush();expect(ui.active()).toBe(ui.controls[3]);
});
it('restores focus to the trigger on close and removes global keyboard handling on close or unmount',()=>{
 const ui=setup();ui.vm.open();ui.vm.close();expect(ui.active()).toBe(ui.trigger);expect(ui.key('Tab').defaultPrevented).toBe(false);
 ui.vm.open();ui.app.unmount();expect(ui.key('Tab').defaultPrevented).toBe(false);
});
