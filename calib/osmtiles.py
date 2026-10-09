"""OpenStreetMap land cover from OpenFreeMap vector tiles, for sampling labelled
points (the helpers sample2.py uses, without its sampling run)."""
import math, json, urllib.request
import mapbox_vector_tile as mvt
from shapely.geometry import shape
from shapely.ops import transform
UA={"User-Agent":"Mozilla/5.0 calib"}
TJ=json.loads(urllib.request.urlopen(urllib.request.Request("https://tiles.openfreemap.org/planet",headers=UA),timeout=30).read())
TURL=TJ["tiles"][0]
REGIONS_V3=[("Patapsco MD",39.2409,-76.7317),("Baltimore MD",39.2900,-76.6100),("Columbia MD",39.2000,-76.8600),
 ("Shenandoah VA",38.5300,-78.4300),("Denver CO",39.7000,-104.9500),("Boulder CO",40.0000,-105.2800),
 ("Ames IA",42.0300,-93.6200),("Manhattan KS",39.1900,-96.5800),("Phoenix AZ",33.4500,-112.0700),
 ("Tucson AZ",32.2500,-110.8500),("LA hills CA",34.1000,-118.4000),("Sacramento CA",38.6000,-121.7000),
 ("Seattle WA",47.6100,-122.3300),("Miami FL",25.7700,-80.2000),("Baton Rouge LA",30.4500,-91.1500),
 ("Minneapolis MN",44.9500,-93.2900),("Tahoe CA",39.1000,-120.0300),("Houston TX",29.7600,-95.3700),
 ("Atlanta GA",33.8500,-84.3500),("Maine woods",45.0000,-69.5000),("Everglades FL",25.6000,-80.6000),
 ("Salt Lake UT",40.7600,-111.8900),("Asheville NC",35.6000,-82.5500),("Lubbock TX",33.5800,-101.8500)]
Z=14
def txy(lat,lon,z):
    n=2**z; return (lon+180)/360*n,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
def tile_feats(lat,lon):
    fx,fy=txy(lat,lon,Z); x,y=int(fx),int(fy)
    raw=urllib.request.urlopen(urllib.request.Request(TURL.format(z=Z,x=x,y=y),headers=UA),timeout=30).read()
    d=mvt.decode(raw,default_options={"y_coord_down":True})
    n=2**Z
    def tolonlat(px,py,ext):
        lon=(x+px/ext)/n*360-180; lat=math.degrees(math.atan(math.sinh(math.pi*(1-2*(y+py/ext)/n)))); return lon,lat
    out={}
    for name,L in d.items():
        ext=L.get("extent",4096); fs=[]
        for f in L["features"]:
            try:
                g=transform(lambda a,b,z=None: tolonlat(a,b,ext), shape(f["geometry"]))
                fs.append((g,f["properties"]))
            except Exception: pass
        out[name]=fs
    return out,(x,y)
def m_per_deg(lat): return 111320, 111320*math.cos(math.radians(lat))
def cat_of(layer,p):
    c=p.get("class"); s=p.get("subclass")
    if layer=="building": return "building"
    if layer=="water" and c in ("lake","ocean","river","pond","dock") and not p.get("intermittent"): return "water"
    if layer=="landcover":
        if c=="wood": return "forest"
        if c=="grass": return "scrub" if s in ("scrub","heath") else "grass"
        if c=="farmland": return "crop"
        if c=="wetland": return "wetland"
        if c in ("sand","rock"): return "bare"
    return None
MARGIN={"building":1.8,"forest":15,"grass":8,"scrub":10,"crop":18,"water":25,"wetland":15,"bare":10}
