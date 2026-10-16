import {inject,type InjectionKey} from 'vue';
import type {usePatternEditor} from './usePatternEditor';
export type PatternEditor=ReturnType<typeof usePatternEditor>;
export const patternEditorKey:InjectionKey<PatternEditor>=Symbol('pattern-editor');
export function usePatternContext(){const editor=inject(patternEditorKey);if(!editor)throw Error('Pattern editor context missing');return editor;}
