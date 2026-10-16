"""Convert the locked Fontsource WOFF to a local TrueType font (no outline changes)."""
import hashlib,io,json,tarfile
from pathlib import Path
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parents[1]
archive=root/'.tools/fontsource-noto-sans-sc-5.3.0.tgz'
with tarfile.open(archive) as source:
    raw=source.extractfile('package/files/noto-sans-sc-chinese-simplified-400-normal.woff').read()
    license_text=source.extractfile('package/LICENSE').read()
font=TTFont(io.BytesIO(raw));font.flavor=None
for code in 'FurryPattern中文纸样材料缝份':
    assert ord(code) in font.getBestCmap(), f'Missing required glyph {code}'
for record in font['name'].names:
    names={1:'FurryPattern Sans SC',2:'Regular',3:'FurryPattern Sans SC Regular 1.0',4:'FurryPattern Sans SC Regular',6:'FurryPatternSansSC-Regular',16:'FurryPattern Sans SC',17:'Regular'}
    if record.nameID in names:record.string=names[record.nameID].encode(record.getEncoding())
output=root/'assets/fonts';output.mkdir(parents=True,exist_ok=True)
path=output/'FurryPatternSansSC-Regular.ttf';font.save(path)
(output/'LICENSE').write_bytes(license_text)
(output/'source.json').write_text(json.dumps({'source':'https://www.npmjs.com/package/@fontsource/noto-sans-sc/v/5.3.0','package':'@fontsource/noto-sans-sc','version':'5.3.0','archiveSha512':hashlib.sha512(archive.read_bytes()).hexdigest(),'sourceFontSha256':hashlib.sha256(raw).hexdigest(),'outputSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'license':'OFL-1.1','modifications':'WOFF decompressed to TrueType; renamed FurryPattern Sans SC; outlines unchanged','fonttoolsVersion':'4.65.0','glyphCount':len(font.getBestCmap())},indent=2),encoding='utf-8')
print(path, len(font.getBestCmap()), 'codepoints')
