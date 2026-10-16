import type {Directive} from 'vue';
export const decimalDisplay=(value:number)=>Number.isFinite(value)?value.toFixed(2):'';
export function limitDecimalInput(value:string){
 const number=Number(value);if(value===''||!Number.isFinite(number))return value;
 return /[eE]/.test(value)||(value.split('.')[1]?.length??0)>2?decimalDisplay(number):value;
}
const format=(element:HTMLInputElement)=>{if(element.value!==''&&Number.isFinite(element.valueAsNumber))element.value=decimalDisplay(element.valueAsNumber);};
const input=(event:Event)=>{const element=event.target as HTMLInputElement;element.value=limitDecimalInput(element.value);};
/** Format only the DOM. Existing precise values stay in the model until the user edits them. */
export const vDecimal:Directive<HTMLInputElement>={mounted(element){queueMicrotask(()=>format(element));element.addEventListener('input',input,true);element.addEventListener('blur',()=>format(element));},updated(element){queueMicrotask(()=>{if(element.ownerDocument.activeElement!==element)format(element);});},beforeUnmount(element){element.removeEventListener('input',input,true);}};
