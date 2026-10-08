import math,io,json,urllib.request,concurrent.futures as cf, numpy as np, threading
from PIL import Image
UA={"User-Agent":"Mozilla/5.0 calib"}
D=json.load(open("patches2.json"))
_tc={}; lock=threading.Lock()
def tile(z,x,y):
    k=(z,x,y)
    with lock:
        if k in _tc: return _tc[k]
    u=f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    im=None
    for _ in range(3):
        try: im=Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=25).read())).convert("RGB"); break
        except Exception: pass
    with lock: _tc[k]=im
    return im
def patch(lat,lon,z=18,half=24):
    n=2**z; X=(lon+180)/360*n*256; Y=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n*256
    x0,y0=int(round(X-half)),int(round(Y-half)); out=Image.new("RGB",(2*half,2*half))
    for tx in range(x0//256,(x0+2*half-1)//256+1):
        for ty in range(y0//256,(y0+2*half-1)//256+1):
            t=tile(z,tx,ty)
            if t is None: return None
            out.paste(t,(tx*256-x0,ty*256-y0))
    return np.asarray(out,np.uint8)
def work(i):
    d=D[i]; a=patch(d["lat"],d["lon"]); return i,a
with cf.ThreadPoolExecutor(16) as ex: res=list(ex.map(work,range(len(D))))
arr=np.zeros((len(D),48,48,3),np.uint8); ok=np.zeros(len(D),bool)
for i,a in res:
    if a is not None: arr[i]=a; ok[i]=True
np.savez_compressed("px48.npz",px=arr,ok=ok); print("saved",ok.sum(),"of",len(D))
