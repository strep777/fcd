"""Independent XML/PDF/DXF checks for the 0.4 manufacturing fixture."""
import json,re,math,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]
record=json.loads((root/'test-results/manufacturing-e2e.json').read_text())
folder=Path(record['directory']); ns={'s':'http://www.w3.org/2000/svg'}
svg=ET.parse(folder/'manufacturing.svg').getroot();meta=json.loads(svg.find('s:metadata',ns).text)
assert meta['materials'][0]['name']=='离线内衬' and meta['materials'][0]['defaultAllowanceMm']==16
assert meta['pieces'][0]['edgeAllowances'][0]['samples']==[{'s':0,'widthMm':6},{'s':1,'widthMm':12}]
notch=svg.find("s:g[@id='Notch']/s:path",ns)
values=list(map(float,re.findall(r'-?\d+(?:\.\d+)?(?:e[+-]?\d+)?',notch.attrib['d'])))
assert len(values)==4 and math.isclose(math.hypot(values[2]-values[0],values[3]-values[1]),3,abs_tol=1e-7)
reader=PdfReader(folder/'manufacturing.pdf'); text='\n'.join(p.extract_text() for p in reader.pages)
assert '离线内衬' in text and 'Edge SA 1' in text
raw=(folder/'manufacturing.dxf').read_text();tokens=raw.splitlines();assert len(tokens)%2==0
pairs=list(zip(tokens[::2],tokens[1::2]));unit=next(i for i,p in enumerate(pairs) if p==('9','$INSUNITS'));assert pairs[unit+1]==('70','4')
entities=[];cur=[]
for k,v in pairs:
    if k=='0':
        if cur:entities.append(cur)
        cur=[(k,v)]
    else:cur.append((k,v))
entities.append(cur)
lines=[e for e in entities if e[0]==('0','LWPOLYLINE') and ('8','NOTCH') in e]
assert len(lines)==1;n=lines[0];assert ('90','2') in n and ('70','0') in n
xs=[float(v) for k,v in n if k=='10'];ys=[float(v) for k,v in n if k=='20'];assert len(xs)==len(ys)==2
d=math.hypot(xs[1]-xs[0],ys[1]-ys[0]);assert math.isclose(d,3,abs_tol=1e-7)
report={'status':'passed','oracle':'xml.etree.ElementTree, pypdf and independent DXF group parser','notchDepthMm':d,'materialsAndProfilesRetained':True,'pdfChineseAndVariableLabels':True,'dxfUnit':'mm','physicalTest':'not executed','artifacts':{name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in ['manufacturing.svg','manufacturing.pdf','manufacturing.dxf']}}
version=json.loads((root/'package.json').read_text())['version'];out=root/'test-results'/'evidence'/version
out.mkdir(parents=True,exist_ok=True);(out/'independent-manufacturing.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False,indent=2))
