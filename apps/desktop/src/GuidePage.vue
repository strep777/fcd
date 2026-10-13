<script setup lang="ts">
import {localize,locale} from './localization';
import {guideCopy} from './guide-copy';
const guideText=(index:number)=>guideCopy[locale.value][index];

import {parameterHelp,type HelpScope} from '../../../packages/ui/parameter-help';
defineProps<{language:'zh'|'en'}>();
const titles:Record<HelpScope,string>={reference:'花纹提取',model:'模型管理',mapping:'花纹映射',cutting:'裁切版型',pattern:'制版',materials:'材料',seams:'接缝',nesting:'排料'};
</script>
<template><article class="guide-page"><h1>{{language==='zh'?'使用指南':localize('User guide')}}</h1><p>{{language==='zh'?'从原图到裁片，按以下顺序操作。所有长度均以毫米保存。':localize('Follow the workflow from original artwork to cutting patterns. Lengths are stored in millimeters.')}}</p><ol><li>{{guideText(0)}}</li><li>{{guideText(1)}}</li><li>{{guideText(2)}}</li><li>{{guideText(3)}}</li><li>{{guideText(4)}}</li></ol><h2>{{guideText(5)}}</h2><p>{{guideText(6)}}</p><p>{{guideText(7)}}</p><h2>{{guideText(8)}}</h2><p>{{guideText(9)}}</p><p>{{guideText(10)}}</p><p>{{guideText(11)}}</p><h2>{{guideText(12)}}</h2><p>{{guideText(13)}}</p><p>{{guideText(14)}}</p><h2>{{guideText(15)}}</h2><p>{{guideText(16)}}</p><h2>{{guideText(17)}}</h2><p>{{guideText(18)}}</p><p>{{guideText(19)}}</p><p>{{guideText(20)}}</p><h2>{{guideText(21)}}</h2><p>{{guideText(22)}}</p><p>{{guideText(23)}}</p><h2>{{guideText(24)}}</h2><p>{{guideText(25)}}</p><section v-for="(topics,scope) in parameterHelp" :key="scope"><h2>{{language==='zh'?titles[scope]:localize(scope)}}</h2><dl><template v-for="topic in topics" :key="topic.name"><dt>{{language==='zh'?topic.name:localize(topic.enName)}}</dt><dd>{{language==='zh'?topic.explanation:localize(topic.en)}}</dd></template></dl></section></article></template>
<style scoped>.guide-page{overflow:auto;padding:28px 36px;max-width:1100px;width:100%;box-sizing:border-box;background:var(--surface);line-height:1.8}.guide-page h1{font-size:24px}.guide-page h2{font-size:17px;margin-top:28px;border-bottom:1px solid var(--border);padding-bottom:8px}.guide-page dt{font-weight:600;margin-top:16px}.guide-page dd{margin:4px 0;color:var(--text-muted)}.guide-page li{margin-block:8px}</style>

