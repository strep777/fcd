<script setup lang="ts">
defineProps<{name:string}>();
const paths:Record<string,string>={
 pan:'M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 8-7 8-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2',
 select:'M5 3v17l5-5 4 7 3-2-4-7h7Z',calibrate:'M4 19 19 4M3 15v6h6M15 3h6v6M8 11l5 5M11 8l5 5',
 pen:'m4 20 3-10L18 3l3 3-7 11-10 3Zm0 0 7-7M9 11l4 4M17 4l3 3',
 brushAdd:'M10 15 19 3l3 3-10 11M10 15c-6-2-3 5-8 6 6 2 10-1 10-4M3 4h6M6 1v6',
 eraser:'m3 14 9-11 9 8-8 10H9l-6-7ZM7 9l10 8M9 21h13',
 lasso:'M7 18C0 15 2 5 11 4s12 5 10 9-6 5-12 5c-4 0-5 5 0 4M8 17l3 3',color:'m15 3 6 6-9 9H6v-6l9-9ZM6 18l-3 3M12 6l6 6',
 add:'M12 4v16M4 12h16',close:'m4 12 5 5L20 6',delete:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
 undo:'M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12',redo:'m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12',clear:'m4 14 8-11 10 8-8 10H9l-5-7Zm5 7h13M8 9l10 8',
 zoomIn:'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM15 15l6 6M7 10h6M10 7v6',zoomOut:'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM15 15l6 6M7 10h6',
 fit:'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6M7 7h10v10H7Z',rotate:'M20 8a9 9 0 1 0 1 8M20 2v6h-6',
 wireframe:'m12 2 10 5v10l-10 5-10-5V7l10-5Zm0 0v20M2 7l20 10M22 7 2 17',solid:'m12 2 10 5v10l-10 5-10-5V7l10-5ZM2 7l10 5 10-5M12 12v10',
 cut:'M9 8 20 20M9 16 20 4M5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM5 13a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',measure:'m3 16 13-13 5 5L8 21l-5-5ZM8 11l3 3M11 8l3 3M14 5l3 3',
 save:'M4 3h13l4 4v14H3V3h1ZM7 3v6h10V3M7 21v-8h10v8',import:'M3 15v6h18v-6M12 3v12M7 10l5 5 5-5',export:'M3 15v6h18v-6M12 15V3M7 8l5-5 5 5',
 node:'M4 4h5v5H4ZM15 15h5v5h-5ZM9 7h7v8M7 9v8h8',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
 settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',front:'M5 3h14v18H5ZM5 7h14M9 7v14',back:'M5 3h14v18H5ZM5 17h14M15 3v14',left:'M3 12h18M10 5l-7 7 7 7',right:'M3 12h18M14 5l7 7-7 7',bottom:'M12 3v18M5 14l7 7 7-7',
 cancel:'M5 5l14 14M19 5 5 19',expand:'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',collapse:'M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6',
 circle:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',rectangle:'M3 5h18v14H3Z',print:'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6ZM17 11h1'
};
</script>
<template><svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="paths[name]??paths.settings"/></svg></template>
<style scoped>.tool-icon{display:block;width:21px;height:21px;flex:none;pointer-events:none}</style>
