import {it,expect} from 'vitest';
import {decimalDisplay,limitDecimalInput} from '../../apps/desktop/src/modules/decimal-input';
import {modelSourceLabel,measurementLabel,modelPartLabel} from '../../apps/desktop/src/modules/model-labels';
it('shows two decimals without rounding the source measurement and limits entered precision',()=>{
 const internal=1100.123456789;expect(decimalDisplay(internal)).toBe('1100.12');expect(internal).toBe(1100.123456789);
 expect(limitDecimalInput('1200.239')).toBe('1200.24');expect(limitDecimalInput('1200.2')).toBe('1200.2');expect(limitDecimalInput('')).toBe('');
});
it('Chinese model information names sources, anatomical girths and parts without internal identifiers',()=>{
 expect(modelSourceLabel('species-template-1',true)).toBe('内置物种模型');expect(measurementLabel('chestGirth',true)).toBe('胸围');expect(measurementLabel('thighGirth-left',true)).toBe('左大腿围');expect(modelPartLabel('foot-right',true)).toBe('右足');expect(modelSourceLabel('obj',false)).toBe('OBJ model');
});
