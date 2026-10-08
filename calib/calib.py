import math,io,json,urllib.request,random,sys,concurrent.futures as cf, numpy as np
from PIL import Image
from sites import SITES
UA={"User-Agent":"Mozilla/5.0 calib"}
Z=18
def tilexy(lat,lon,z):
    n=2**z; return (lon+180.)/360.*n,(1.-math.asinh(math.tan(math.radians(lat)))/math.pi)/2.*n
_tc={}
def fetch(z,x,y):
    k=(z,x,y)
    if k in _tc: return _tc[k]
    u=f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    for _ in range(3):
        try:
            im=Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=25).read())).convert("RGB")
            _tc[k]=im; return im
        except Exception: pass
    _tc[k]=None; return None
def mosaic(lat,lon,z,r=1):
    fx,fy=tilexy(lat,lon,z); xt,yt=int(fx),int(fy)
    big=Image.new("RGB",((2*r+1)*256,(2*r+1)*256)); ok=0
    for dx in range(-r,r+1):
        for dy in range(-r,r+1):
            t=fetch(z,xt+dx,yt+dy)
            if t is not None: big.paste(t,((dx+r)*256,(dy+r)*256)); ok+=1
    return big,(fx-xt+r)*256,(fy-yt+r)*256,ok
def feats(a):
    a=np.asarray(a,np.float32)/255.
    r,g,b=a[...,0],a[...,1],a[...,2]
    lum=.2126*r+.7152*g+.0722*b; tot=np.maximum(r+g+b,1e-4)
    mx,mn=a.max(-1),a.min(-1); sat=np.where(mx>1e-4,(mx-mn)/np.maximum(mx,1e-4),0)
    gx=np.abs(np.diff(lum,axis=1)).sum(); gy=np.abs(np.diff(lum,axis=0)).sum()
    n=lum.shape[0]*(lum.shape[1]-1)+lum.shape[1]*(lum.shape[0]-1)
    return dict(bright=float(np.median(lum)),sat=float(np.median(sat)),
      exg=float(np.median((2*g-r-b)/tot)),blue=float(np.median((b-(r+g)/2)/tot)),
      red=float(np.median((r-(g+b)/2)/tot)),tex=float(lum.std()),edge=float((gx+gy)/n),
      dark=float((lum<.10).mean()))
def ident(lat,lon):
    u=("https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/identify?"
       f"geometry={lon},{lat}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1"
       f"&mapExtent={lon-.01},{lat-.01},{lon+.01},{lat+.01}&imageDisplay=400,400,96&returnGeometry=false&f=json")
    try:
        d=json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=25).read())
        best=None
        for r in d.get("results",[]):
            a=r.get("attributes",{}); mx=int(a.get("MaxMapLevel","0") or 0); mn=int(a.get("MinMapLevel","0") or 0)
            if mn<=Z<=mx and a.get("DATE (YYYYMMDD)") not in (None,"","Null"):
                best=a; break
        if not best and d.get("results"): best=d["results"][0].get("attributes",{})
        return {"date":(best or {}).get("DATE (YYYYMMDD)"),"res":(best or {}).get("RESOLUTION (M)"),
                "acc":(best or {}).get("ACCURACY (M)"),"src":(best or {}).get("SOURCE_INFO")}
    except Exception as e: return {"err":str(e)}
def site(s):
    cls,label,lat,lon=s
    big,cx,cy,ok=mosaic(lat,lon,Z,1)
    if ok<6: return {"cls":cls,"label":label,"err":"tiles"}
    meta=ident(lat,lon)
    rnd=random.Random(hash(label)&0xffff); out=[]
    for k in range(6):
        ox,oy=(0,0) if k==0 else (rnd.uniform(-110,110),rnd.uniform(-110,110))
        x,y=int(cx+ox),int(cy+oy)
        p=big.crop((x-12,y-12,x+12,y+12))
        f=feats(p); flat=f["tex"]<.006 and f["edge"]<.004 and f["bright"]>.68 and f["sat"]<.06
        out.append({"f":f,"flat":flat,"px":(x,y)})
    big.save(f"m_{label.replace(' ','_')}.jpg",quality=80)
    return {"cls":cls,"label":label,"lat":lat,"lon":lon,"meta":meta,"patches":out,"cx":cx,"cy":cy}
with cf.ThreadPoolExecutor(8) as ex: res=list(ex.map(site,SITES))
json.dump(res,open("calib_raw.json","w"),indent=1)
for r in res:
    if "err" in r: print(f"{r['cls']:8s} {r['label']:20s} ERR {r['err']}"); continue
    m=r["meta"]; fs=[p["f"] for p in r["patches"] if not p["flat"]]
    e=np.mean([f["exg"] for f in fs]) if fs else float('nan'); b=np.mean([f["bright"] for f in fs]) if fs else float('nan')
    print(f"{r['cls']:8s} {r['label']:20s} date={m.get('date')} res={m.get('res')} acc={m.get('acc')}  n={len(fs)} bright={b:.3f} exg={e:+.3f}")
