"""Read outputs with XML and pypdf, independently of the TS/Rust exporters."""
import hashlib,json,math,os,re,subprocess,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
evidence=root/'test-results'/'evidence'/version
evidence.mkdir(exist_ok=True,parents=True)
record=json.loads((root/'test-results/e2e.json').read_text(encoding='utf-8'))
folder=Path(record['directory'])
svg=folder/'output.svg'
tree=ET.parse(svg);node=tree.getroot();ns={'s':'http://www.w3.org/2000/svg'}
width=float(node.attrib['width'].removesuffix('mm'));height=float(node.attrib['height'].removesuffix('mm'))
view=[float(v) for v in node.attrib['viewBox'].split()]
assert view==[0,0,width,height]
cuts=tree.findall("s:g[@id='Cut']/s:path",ns)
measures=[]
for cut in cuts:
    values=[float(v) for v in re.findall(r'-?\d+(?:\.\d+)?(?:e[+-]?\d+)?',cut.attrib['d'])]
    xs,ys=values[0::2],values[1::2]
    w,h=max(xs)-min(xs),max(ys)-min(ys)
    assert abs(w-120)<1e-9 and abs(h-220)<1e-9
    measures.append({'widthMm':w,'heightMm':h})
assert len(cuts)==2
pdf=folder/'output.pdf';reader=PdfReader(pdf)
calibrations=[]
for page in reader.pages:
    assert math.isclose(float(page.mediabox.width)*25.4/72,210,abs_tol=1e-8)
    assert math.isclose(float(page.mediabox.height)*25.4/72,297,abs_tol=1e-8)
    content=ContentStream(page.get_contents(),reader);last=None;found=False
    for operands,op in content.operations:
        if op==b'm':last=[float(v) for v in operands]
        if op==b'l' and last:
            end=[float(v) for v in operands]
            if math.isclose(last[1]*25.4/72,292,abs_tol=1e-6) and math.isclose(end[1],last[1],abs_tol=1e-6):
                length=abs(end[0]-last[0])*25.4/72
                if math.isclose(length,100,abs_tol=1e-6):calibrations.append(length);found=True
            last=end
    assert found,'Calibration line absent'
text='\n'.join(page.extract_text() for page in reader.pages)
assert '材料' in text and '缝份' in text and '纸样' in text, 'Chinese manufacturing labels missing'
fonts=[font.get_object() for page in reader.pages for font in page['/Resources']['/Font'].get_object().values()]
assert any('/ToUnicode' in font for font in fonts), 'Embedded Unicode mapping missing'
png=folder/'output.png'
with Image.open(png) as preview:
    preview.load()
    assert preview.format=='PNG'
    dpi=preview.info.get('dpi');assert dpi and abs(dpi[0]-144)<0.1
    assert abs(preview.width/dpi[0]*25.4-width)<0.3
    assert abs(preview.height/dpi[1]*25.4-height)<0.3
    assert 'Preview only' in preview.info.get('Description','')
    png_metrics={'pixels':list(preview.size),'dpi':list(dpi),'previewOnly':True}
report={'status':'passed','oracle':'Python xml.etree.ElementTree + pypdf ContentStream','png':png_metrics,'pdfChineseLabels':True,'svgCutBounds':measures,'pdfPages':len(reader.pages),'pdfCalibrationMm':calibrations,'maxScaleRelativeError':max(abs(v/100-1) for v in calibrations),'physicalPrintTest':'not executed','artifacts':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (svg,pdf,png)}}
(evidence/'independent-export.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
