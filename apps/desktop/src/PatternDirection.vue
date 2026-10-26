<template>
 <g v-if="layout.fontSizeMm>0" class="piece-annotations" pointer-events="none">
  <text v-for="(line,index) in layout.caption" :key="index" class="piece-caption" :x="line.xMm" :y="-line.yMm" text-anchor="middle" :font-size="line.fontSizeMm" :textLength="line.widthMm" lengthAdjust="spacingAndGlyphs" fill="var(--ink)" paint-order="stroke" stroke="var(--studio-white)" :stroke-width="line.fontSizeMm*.15" stroke-linejoin="round">{{line.text}}</text>
  <g class="piece-direction" aria-label="Piece fur and fabric direction">
  <g v-for="arrow in layout.arrows" :key="arrow.kind" :class="'piece-direction-'+arrow.kind" :data-angle-rad="arrow.angle">
   <title>{{directionLabel(arrow.text)}} {{Number((arrow.angle*180/Math.PI).toFixed(1))}}°</title>
   <polyline :points="arrow.points.map(point=>`${point.xMm},${-point.yMm}`).join(' ')" fill="none" :stroke="arrow.kind==='grain'?'var(--studio-orange)':'var(--ink)'" :stroke-width="layout.fontSizeMm*.1" :stroke-dasharray="arrow.kind==='grain'?`${layout.fontSizeMm*.3} ${layout.fontSizeMm*.2}`:undefined" stroke-linecap="round" stroke-linejoin="round"/>
   <text :x="arrow.label.xMm" :y="-arrow.label.yMm" text-anchor="middle" :font-size="arrow.label.fontSizeMm" :textLength="arrow.label.widthMm" lengthAdjust="spacingAndGlyphs" :fill="arrow.kind==='grain'?'var(--studio-orange)':'var(--ink)'" paint-order="stroke" stroke="var(--studio-white)" :stroke-width="arrow.label.fontSizeMm*.15" stroke-linejoin="round">{{directionLabel(arrow.label.text)}}</text>
  </g>
  </g>
 </g>
</template>
<script setup lang="ts">
import type {patternAnnotationLayout} from '../../../packages/pattern/annotation-layout';
const props=defineProps<{layout:ReturnType<typeof patternAnnotationLayout>;language:'zh'|'en'}>();
const englishLabels:Record<string,string>={'毛向':'Fur','布向':'Grain','毛向 / 布向':'Fur / grain'};
function directionLabel(text:string){return props.language==='zh'?text:englishLabels[text]??text;}
</script>
