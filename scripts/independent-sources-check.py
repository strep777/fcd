"""Read saved mask and fitted template archives independently of app code."""
import json,hashlib,math,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1];version=json.loads((root/'package.json').read_text())['version'];out=root/'test-results'/'evidence'/version;out.mkdir(parents=True,exist_ok=True)
def archive(suite):
    record=json.loads((root/'test-results'/f'{suite}-e2e.json').read_text());p=Path(record['directory'])/f'{suite}.fpcad'
    with zipfile.ZipFile(p) as z:
        manifest=json.loads(z.read('manifest.json'))
        for entry in manifest['files']:
            data=z.read(entry['path']);assert len(data)==entry['size'];assert hashlib.sha256(data).hexdigest()==entry['sha256']
        return {name:json.loads(z.read(name+'.json')) for name in ['patterns','markings','body']}
def area(r):return sum(a['xMm']*b['yMm']-a['yMm']*b['xMm'] for a,b in zip(r,r[1:]+r[:1]))/2
m=archive('mask');sources=m['markings']['maskSources'];assert len(sources)==2 and len(m['patterns']['pieces'])==4
mask_metrics=[]
for source in sources:
    mask=source['mask'];assert len(mask['pixels'])==mask['width']*mask['height'];count=mask['pixels'].count('1');c=source['calibration'];scale=c['distanceMm']/math.hypot(c['b']['x']-c['a']['x'],c['b']['y']-c['a']['y']);expected=count*scale**2*source['originalWidth']/mask['width']*source['originalHeight']/mask['height'];pieces=[p for p in m['patterns']['pieces'] if p['sourceMaskId']==source['id']];actual=sum(abs(area(p['nodes']))-sum(abs(area(h)) for h in p.get('holes',[])) for p in pieces);assert math.isclose(actual,expected,abs_tol=1e-6);mask_metrics.append({'pixels':count,'pieces':len(pieces),'areaMm2':actual})
t=archive('template')['body']['surface'];snap=t['customTemplate'];definition=snap['definition'];weights=snap['weights'];assert definition['unit']=='mm' and definition['license']
canonical=json.dumps(definition,ensure_ascii=False,separators=(',',':'));assert hashlib.sha256(canonical.encode()).hexdigest()==snap['sourceHash']
vertices={v['id']:dict(v) for v in definition['vertices']}
for morph in definition['morphs']:
    weight=weights[morph['name']];assert morph['minWeight']<=weight<=morph['maxWeight']
    for d in morph['deltas']:
        for axis in ['xMm','yMm','zMm']:vertices[d['id']][axis]+=d[axis]*weight
for v in t['vertices']:
    for axis in ['xMm','yMm','zMm']:assert math.isclose(v[axis],vertices[v['id']][axis],abs_tol=1e-8)
reports=[]
for measurement in definition['measurements']:
    p=[vertices[id] for id in measurement['vertexIds']]
    if measurement['kind']=='height':actual=max(v['yMm'] for v in p)-min(v['yMm'] for v in p)
    else:actual=sum(math.sqrt(sum((a[axis]-b[axis])**2 for axis in ['xMm','yMm','zMm'])) for a,b in zip(p,p[1:]+p[:1]))
    target=snap['targets'][measurement['name']];assert abs(actual-target)<=measurement['toleranceMm'];reports.append({'name':measurement['name'],'targetMm':target,'actualMm':actual,'residualMm':actual-target})
result={'status':'passed','oracle':'Python zipfile, independent pixel-to-mm area and Morph reconstruction','maskSources':mask_metrics,'templateMeasurements':reports,'frozenSourceHash':True,'physicalTrials':'not executed'};(out/'independent-sources.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=False,indent=2))
