<script setup lang="ts">
import {localize} from './localization';

import {parameterHelp,type HelpScope} from '../../../packages/ui/parameter-help';
defineProps<{scope:HelpScope;language:'zh'|'en'}>();
</script>
<template><details class="parameter-help"><summary>{{language==='zh'?'参数是什么意思？':localize('What do these parameters mean?')}}</summary><dl><template v-for="topic in parameterHelp[scope]" :key="topic.name"><dt>{{language==='zh'?topic.name:localize(topic.enName)}}</dt><dd>{{language==='zh'?topic.explanation:localize(topic.en)}}</dd></template></dl></details></template>
<style scoped>.parameter-help{padding:12px;margin-block:10px;border:1px solid var(--border);border-radius:5px;background:var(--accent-soft);font-size:12px}.parameter-help summary{cursor:pointer;color:var(--accent)}.parameter-help dt{font-weight:600;margin-top:14px}.parameter-help dd{margin:5px 0 0;color:var(--text-muted);line-height:1.75}</style>
