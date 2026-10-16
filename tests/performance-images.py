from PIL import Image
from pathlib import Path
import random
p=Path('.local/performance-fixture');p.mkdir(parents=True,exist_ok=True)
r=random.Random(20261005)
for prefix,size,noise_width in [('reference',4096,1400),('texture',2048,1024)]:
    rows=[r.randbytes(noise_width*3)+bytes((size-noise_width)*3) for _ in range(size)]
    im=Image.frombytes('RGB',(size,size),b''.join(rows)).convert('RGBA')
    im.save(p/(prefix+'.png'))
    im.resize((512,512),Image.Resampling.LANCZOS).save(p/(prefix+'-proxy.png'))
    if prefix=='reference':im.resize((128,128),Image.Resampling.LANCZOS).save(p/(prefix+'-thumb.png'))
print('PNG fixtures ready')
