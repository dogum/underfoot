import math,io,json,urllib.request,concurrent.futures as cf, numpy as np, threading
from PIL import Image
UA={"User-Agent":"Mozilla/5.0 calib"}
pts=json.load(open("labels2.json"))
# fold in the curated manual sites (drop the ones the contact sheet showed were mislabelled)
BAD={"Olympic WA","Natl Mall DC","Flint Hills KS","Central Valley CA","Sonoran AZ","Iowa"}
raw=json.load(open("calib_raw.json"))
import random; rnd=random.Random(3)
for r in raw:
    if "err" in r or r["label"] in BAD: continue
    for k in range(6):
        ox,oy=(0,0) if k==0 else (rnd.uniform(-90,90),rnd.uniform(-90,90))
        mpp=156543.03392*math.cos(math.radians(r["lat"]))/2**18
        pts.append({"cls":r["cls"],"lat":r["lat"]-oy*mpp/111320,"lon":r["lon"]+ox*mpp/(111320*math.cos(math.radians(r["lat"]))),"region":"site:"+r["label"]})
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
def txy(lat,lon,z):
    n=2**z; return (lon+180)/360*n,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
def patch(lat,lon,z=18,half=12):
    fx,fy=txy(lat,lon,z); X,Y=fx*256,fy*256
    x0,y0=int(round(X-half)),int(round(Y-half)); out=Image.new("RGB",(2*half,2*half))
    for tx in range(x0//256,(x0+2*half-1)//256+1):
        for ty in range(y0//256,(y0+2*half-1)//256+1):
            t=tile(z,tx,ty)
            if t is None: return None
            out.paste(t,(tx*256-x0,ty*256-y0))
    return out
def feats(im):
    a=np.asarray(im,np.float64)/255.; r,g,b=a[...,0],a[...,1],a[...,2]
    lum=.2126*r+.7152*g+.0722*b; tot=np.maximum(r+g+b,1e-4)
    mx,mn=a.max(-1),a.min(-1); sat=np.where(mx>1e-4,(mx-mn)/np.maximum(mx,1e-4),0)
    gx=np.abs(np.diff(lum,axis=1)).sum(); gy=np.abs(np.diff(lum,axis=0)).sum()
    n=lum.shape[0]*(lum.shape[1]-1)+lum.shape[1]*(lum.shape[0]-1)
    med=lambda v: float(np.sort(v.ravel())[v.size//2])        # same "median" as the JS
    return dict(bright=med(lum),sat=med(sat),exg=med((2*g-r-b)/tot),blue=med((b-(r+g)/2)/tot),
                red=med((r-(g+b)/2)/tot),tex=float(lum.std()),edge=float((gx+gy)/n),dark=float((lum<.10).mean()))
def work(p):
    im=patch(p["lat"],p["lon"])
    if im is None: return None
    f=feats(im)
    if f["tex"]<.006 and f["edge"]<.004 and f["bright"]>.68 and f["sat"]<.06: return None
    p=dict(p); p["f"]=f; return p
with cf.ThreadPoolExecutor(16) as ex: res=[r for r in ex.map(work,pts) if r]
# acquisition date per region (one identify per region centre)
def ident(lat,lon):
    u=("https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify?"
       f"geometry={lon},{lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1"
       f"&mapExtent={lon-.01},{lat-.01},{lon+.01},{lat+.01}&imageDisplay=400,400,96&returnGeometry=false&f=json")
    try:
        d=json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=25).read())
        for r in d.get("results",[]):
            a=r.get("attributes",{}); 
            try: lo,hi=int(a.get("MinMapLevel") or 0),int(a.get("MaxMapLevel") or 0)
            except: lo,hi=0,0
            if lo<=18<=hi and (a.get("DATE (YYYYMMDD)") or "").isdigit(): return a.get("DATE (YYYYMMDD)")
    except Exception: pass
    return None
regs={}
for r in res: regs.setdefault(r["region"],(r["lat"],r["lon"]))
with cf.ThreadPoolExecutor(8) as ex: dates=dict(zip(regs, ex.map(lambda k: ident(*regs[k]), regs)))
for r in res: r["date"]=dates.get(r["region"])
json.dump(res,open("patches2.json","w"))
import collections
print("patches:",len(res)); print(collections.Counter(r["cls"] for r in res))
print({k:v for k,v in dates.items() if not k.startswith("site:")})
