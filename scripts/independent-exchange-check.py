"""Independently read GLB headers/accessors and native-import manufacturing archive."""
import json,struct,math,zipfile,hashlib,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[1];version=json.loads((root/'package.json').read_text())['version'];record=json.loads((root/'test-results/completion-e2e.json').read_text());folder=Path(record['directory']);out=root/'test-results'/'evidence'/version

def glb(path):
    data=path.read_bytes();magic,version,total=struct.unpack_from('<III',data);assert magic==0x46546c67 and version==2 and total==len(data)
    chunks={};cursor=12
    while cursor<len(data):
        size,kind=struct.unpack_from('<II',data,cursor);cursor+=8;assert size%4==0;chunks[kind]=data[cursor:cursor+size];cursor+=size
    assert cursor==len(data);j=json.loads(chunks[0x4e4f534a]);binary=chunks[0x004e4942]
    def accessor(index):
        a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];offset=v.get('byteOffset',0)+a.get('byteOffset',0);fmt={5126:'f',5123:'H',5125:'I'}[a['componentType']];n={'VEC3':3,'SCALAR':1}[a['type']];stride=v.get('byteStride',struct.calcsize(fmt)*n)
        return [struct.unpack_from('<'+fmt*n,binary,offset+i*stride) for i in range(a['count'])]
    p=j['meshes'][0]['primitives'][0];points=accessor(p['attributes']['POSITION']);triangles=accessor(p['indices']);assert len(points)==4 and len(triangles)==6;assert all(0<=i[0]<4 for i in triangles)
    return j,points
j,points=glb(folder/'exported.glb');mm=[[v*1000 for v in p] for p in points];assert math.isclose(max(p[0] for p in mm),100,abs_tol=.0001);assert math.isclose(max(p[1] for p in mm),200,abs_tol=.0001);assert j['nodes'][0]['extras']['unit']=='metres'
with zipfile.ZipFile(folder/'completion.fpcad') as z:
    m=json.loads(z.read('manifest.json'))
    for f in m['files']:assert hashlib.sha256(z.read(f['path'])).hexdigest()==f['sha256']
    pieces=json.loads(z.read('patterns.json'))['pieces'];svg=[p for p in pieces if p['name'].startswith('SVG')];assert len(svg)==2 and len(svg[0]['holes'])==1
    def area(r):return abs(sum(p['xMm']*r[(i+1)%len(r)]['yMm']-r[(i+1)%len(r)]['xMm']*p['yMm'] for i,p in enumerate(r)))/2
    assert area(svg[0]['nodes'])-area(svg[0]['holes'][0])==1600 and area(svg[1]['nodes'])==100
    body=json.loads(z.read('body.json'))['surface'];snapshot=body['customTemplate'];assert abs(list(snapshot['weights'].values())[0]-.1)<1e-12
out.mkdir(parents=True,exist_ok=True);(out/'independent-exchange-check.json').write_text(json.dumps({'passed':True,'source':str(folder),'glbBoundsMm':[100,200],'svgAreaMm2':[1600,100],'glbUnit':'metres','manifestHashes':True},ensure_ascii=False,indent=2));print('Independent GLB/SVG/archive checks passed')
