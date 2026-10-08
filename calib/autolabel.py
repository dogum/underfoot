import json,subprocess,random,math
def ov(q):
    for m in ["https://overpass.kumi.systems/api/interpreter","https://overpass.private.coffee/api/interpreter"]:
        for _ in range(2):
            try:
                r=subprocess.run(["curl","-s","-m","70","-X","POST",m,"--data-urlencode","data@-"],input=q,capture_output=True,text=True,timeout=90)
                d=json.loads(r.stdout)
                if "elements" in d and not d.get("remark"): return d
            except Exception: pass
    return {"elements":[]}
def cen(g): return (sum(p["lat"] for p in g)/len(g), sum(p["lon"] for p in g)/len(g))
def area(g):
    la0=g[0]["lat"]; kx=111320*math.cos(math.radians(la0))
    pts=[(p["lon"]*kx,p["lat"]*111320) for p in g]
    return abs(sum(pts[i][0]*pts[i-1][1]-pts[i-1][0]*pts[i][1] for i in range(len(pts)))/2)
out=[]; rnd=random.Random(7)
JOBS=[
 ("paved","motorway",'way["highway"="motorway"]({b});out geom 6;',["39.15,-76.75,39.30,-76.55","39.65,-105.05,39.80,-104.85","33.90,-118.30,34.05,-118.15","29.70,-95.50,29.85,-95.30"]),
 ("paved","parking",'way["amenity"="parking"]["parking"!="multi-storey"]({b});out geom 8;',["39.30,-76.75,39.45,-76.55","39.65,-105.05,39.80,-104.85","33.80,-118.10,33.95,-117.90"]),
 ("grass","fairway",'way["golf"="fairway"]({b});out geom 6;',["39.15,-76.95,39.40,-76.60","39.60,-105.10,39.80,-104.90","33.60,-117.95,33.80,-117.70"]),
 ("grass","pitch",'way["leisure"="pitch"]["surface"="grass"]({b});out geom 6;',["39.15,-76.95,39.40,-76.60","40.60,-74.10,40.80,-73.85"]),
 ("crop","farmland",'way["landuse"="farmland"]({b});out geom 6;',["41.80,-93.80,42.10,-93.30","40.30,-89.00,40.60,-88.60","38.30,-98.70,38.60,-98.30"]),
]
for cls,tag,tmpl,boxes in JOBS:
    for b in boxes:
        d=ov("[out:json][timeout:60];"+tmpl.format(b=b))
        els=[e for e in d["elements"] if e.get("geometry") and len(e["geometry"])>=3]
        rnd.shuffle(els); n=0
        for e in els:
            g=e["geometry"]
            if cls=="paved" and tag=="motorway":
                p=g[len(g)//2]; out.append({"cls":cls,"src":tag,"lat":p["lat"],"lon":p["lon"]}); n+=1
            else:
                a=area(g)
                if a<(3000 if tag!="farmland" else 80000): continue
                la,lo=cen(g); out.append({"cls":cls,"src":tag,"lat":la,"lon":lo,"area":round(a)}); n+=1
            if n>=4: break
        print(cls,tag,b,"->",n,flush=True)
# buildings from FEMA USA Structures (authoritative footprints)
for b,lab in [("-76.80,39.20,-76.70,39.30","MD"),("-105.00,39.70,-104.90,39.78","CO"),("-95.45,29.72,-95.35,29.80","TX"),("-118.25,34.00,-118.15,34.08","CA")]:
    for big in (True,False):
        w="SQFEET>30000" if big else "SQFEET>1500 AND SQFEET<4000"
        u=("https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query"
           f"?where={w.replace(' ','%20').replace('>','%3E').replace('<','%3C')}&geometry={b}&geometryType=esriGeometryEnvelope&inSR=4326"
           "&spatialRel=esriSpatialRelIntersects&outFields=SQFEET,OCC_CLS&returnGeometry=true&outSR=4326&resultRecordCount=40&f=json")
        r=subprocess.run(["curl","-s","-m","40",u],capture_output=True,text=True)
        try: fs=json.loads(r.stdout).get("features",[])
        except Exception: fs=[]
        rnd.shuffle(fs)
        for f in fs[:3]:
            ring=f["geometry"]["rings"][0]; lo=sum(p[0] for p in ring)/len(ring); la=sum(p[1] for p in ring)/len(ring)
            out.append({"cls":"building","src":("big" if big else "house")+"-"+lab,"lat":la,"lon":lo,"sqft":f["attributes"]["SQFEET"]})
        print("building",lab,"big" if big else "house","->",min(3,len(fs)),flush=True)
# leaf-off woods near Greg's point (brown in his screenshot) — verified visually below
for la,lo in [(39.2385,-76.7335),(39.2372,-76.7310),(39.2395,-76.7290),(39.2360,-76.7350),(39.2425,-76.7360),(39.2440,-76.7270)]:
    out.append({"cls":"forest","src":"leafoff-candidate","lat":la,"lon":lo})
json.dump(out,open("auto_sites.json","w"),indent=1); print("total",len(out))
