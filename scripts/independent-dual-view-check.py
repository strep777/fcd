"""Independent user-image archive, mm area and front/back projection checks."""
import hashlib,json,math,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[1]
report=json.loads((root/'test-results/real-dual-view/report.json').read_text(encoding='utf-8'))
assert report['passed']
saved=next(c['details'] for c in report['checks'] if c['name'].startswith('save/restart'))
with zipfile.ZipFile(saved['file']) as z:
    manifest=json.loads(z.read('manifest.json'))
    for entry in manifest['files']:
        data=z.read(entry['path']);assert len(data)==entry['size'];assert hashlib.sha256(data).hexdigest()==entry['sha256']
    patterns=json.loads(z.read('patterns.json'));markings=json.loads(z.read('markings.json'));body=json.loads(z.read('body.json'))
    sources=[p for p in z.namelist() if '-source.jpg' in p]
    assert len(sources)==2
    for p in sources: assert hashlib.sha256(z.read(p)).hexdigest()==report['image']['sha256']
pieces={p['id']:p for p in patterns['pieces']}
def area(r):return sum(a['xMm']*b['yMm']-b['xMm']*a['yMm'] for a,b in zip(r,r[1:]+r[:1]))/2
metrics=[]
for source in markings['maskSources']:
    c=source['calibration'];mask=source['mask'];factor=c['distanceMm']/math.hypot(c['b']['x']-c['a']['x'],c['b']['y']-c['a']['y']);expected=mask['pixels'].count('1')*source['originalWidth']/mask['width']*source['originalHeight']/mask['height']*factor**2
    found=[p for p in pieces.values() if p.get('sourceMaskId')==source['id']];actual=sum(abs(area(p['nodes']))-sum(abs(area(h)) for h in p.get('holes',[])) for p in found)
    loss=source.get('contourRepair',{}).get('areaLossMm2',0);assert abs(actual-(expected-loss))<1e-5
    metrics.append({'maskPixels':mask['pixels'].count('1'),'areaMm2':actual,'disclosedLossMm2':loss})
def near(x,y,a,b):
    dx=b['xMm']-a['xMm'];dy=b['yMm']-a['yMm'];k=max(0,min(1,((x-a['xMm'])*dx+(y-a['yMm'])*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-a['xMm']-k*dx,y-a['yMm']-k*dy)<.03
def contains(x,y,p):
    inside=False
    for ring in [p['nodes']]+p.get('holes',[]):
        for a,b in zip(ring,ring[1:]+ring[:1]):
            if near(x,y,a,b):return True
            if (a['yMm']>y)!=(b['yMm']>y) and x<(b['xMm']-a['xMm'])*(y-a['yMm'])/(b['yMm']-a['yMm'])+a['xMm']:inside=not inside
    return inside
vertices={v['id']:v for v in body['surface']['vertices']};faces={f['id']:f for f in body['surface']['faces']};checked=0
assert {m['view'] for m in markings['markings']}=={'front','back'}
for m in markings['markings']:
    source=pieces[m['sourcePieceId']]
    for fragment in m['fragments']:
        triangle=[vertices[id] for id in faces[fragment['faceId']]['vertices']]
        for ring in fragment['rings']:
            for weights in ring:
                assert abs(sum(weights)-1)<1e-6 and all(0<=w<=1 for w in weights)
                x=sum(w*v['xMm'] for w,v in zip(weights,triangle));y=sum(w*v['yMm'] for w,v in zip(weights,triangle))
                assert contains(x*(1 if m['view']=='front' else -1)-m['offsetXmm'],y-m['offsetYmm'],source)
                checked+=1
    assert all(path['pieceId'] in pieces for path in m['paths'])
exported=next(c['details'] for c in report['checks'] if c['name'].startswith('SVG and DXF'))
svg=ET.parse(next(e['file'] for e in exported if e['format']=='svg')).getroot();assert svg.attrib['width'].endswith('mm') and svg.attrib['height'].endswith('mm')
assert svg.find("{http://www.w3.org/2000/svg}g[@id='Marking']") is not None
out={'passed':True,'build':report['build'],'oracle':'Python zipfile, SHA256, XML, independent shoelace area and barycentric world reconstruction','originalImageHash':report['image']['sha256'],'maskAreas':metrics,'projectedVerticesChecked':checked,'imageMatchQuality':'not scored; templates and drawing poses differ','physicalManufacturing':'not executed'}
(root/'test-results/real-dual-view/independent.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(out,ensure_ascii=False,indent=2))
