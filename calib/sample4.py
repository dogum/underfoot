"""v4 samples: where the v3 classifier was weakest.

    python3 sample4.py      # writes labels4.json

1. Flat roofs: large footprints from FEMA USA Structures in twelve US metros
   v3 never saw (the time machine read a factory's white roof as bare).
2. Construction ground and quarries, from OpenStreetMap (landuse=construction,
   landuse=quarry), labelled bare.
3. Eighteen regions outside the US, sampled from OpenStreetMap's land cover in
   OpenFreeMap tiles the way sample2.py sampled the US. None is within 3 km of
   the 36 places abroad that score the app (tests/fixtures/spots/abroad.json).
Each point carries a region, so fit4.py can hold whole regions out.
"""
import json, math, random, subprocess, collections, concurrent.futures as cf
import numpy as np
from osmtiles import tile_feats, cat_of, m_per_deg, MARGIN
from shapely.geometry import Point
from shapely.ops import unary_union

SPOTS = json.load(open('../tests/fixtures/spots/abroad.json'))['spots']


def near_spot(lat, lon, km=3):
    for s in SPOTS:
        dy = (lat - s['lat']) * 111.32
        dx = (lon - s['lon']) * 111.32 * math.cos(math.radians(lat))
        if math.hypot(dx, dy) < km:
            return True
    return False


def curl(url, data=None, timeout=60):
    cmd = ['curl', '-s', '-m', str(timeout), '-A', 'underfoot-calib/4 (github.com/dogum/underfoot)']
    if data is not None:
        cmd += ['-X', 'POST', '--data-urlencode', 'data@-']
    r = subprocess.run(cmd + [url], input=data, capture_output=True, text=True, timeout=timeout + 20)
    return r.stdout


# 1 · flat roofs ------------------------------------------------------------------
METROS = [
    ('Austin TX', 30.27, -97.74), ('Dallas TX', 32.85, -96.85), ('Las Vegas NV', 36.12, -115.17),
    ('Chicago IL', 41.85, -87.70), ('Charlotte NC', 35.22, -80.84), ('Columbus OH', 39.96, -82.99),
    ('Kansas City MO', 39.10, -94.58), ('Reno NV', 39.53, -119.81), ('Fresno CA', 36.75, -119.77),
    ('Memphis TN', 35.10, -89.97), ('Indianapolis IN', 39.77, -86.16), ('Albuquerque NM', 35.10, -106.62),
]
FEMA = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query'


def roofs(metro):
    name, lat, lon = metro
    rnd = random.Random(name)
    d = 0.12
    out = []
    for where, n in (('SQFEET>60000', 6), ('SQFEET>8000 AND SQFEET<30000', 4)):
        u = (f'{FEMA}?where={where.replace(" ", "%20").replace(">", "%3E").replace("<", "%3C")}'
             f'&geometry={lon - d},{lat - d},{lon + d},{lat + d}&geometryType=esriGeometryEnvelope&inSR=4326'
             '&spatialRel=esriSpatialRelIntersects&outFields=SQFEET,OCC_CLS&returnGeometry=true&outSR=4326&resultRecordCount=200&f=json')
        try:
            fs = json.loads(curl(u)).get('features', [])
        except Exception:
            fs = []
        rnd.shuffle(fs)
        for f in fs[:n]:
            ring = f['geometry']['rings'][0]
            # a point well inside the footprint, not its centroid (which can fall outside an L)
            from shapely.geometry import Polygon
            P = Polygon(ring).representative_point()
            out.append({'cls': 'building', 'lat': P.y, 'lon': P.x, 'region': 'roofs:' + name,
                        'src': 'fema', 'sqft': f['attributes'].get('SQFEET'), 'occ': f['attributes'].get('OCC_CLS')})
    return out


# 2 · construction ground and quarries -------------------------------------------
OVERPASS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
            'https://overpass-api.de/api/interpreter']
DIG = [  # bounding boxes south,west,north,east
    ('dig:Austin TX', '30.05,-97.95,30.55,-97.45'), ('dig:Phoenix AZ', '33.25,-112.35,33.75,-111.75'),
    ('dig:Dallas TX', '32.60,-97.10,33.10,-96.60'), ('dig:Orlando FL', '28.30,-81.55,28.70,-81.15'),
    ('dig:Berlin DE', '52.35,13.20,52.65,13.65'), ('dig:Madrid ES', '40.30,-3.85,40.55,-3.55'),
    ('dig:Melbourne AU', '-37.95,144.75,-37.65,145.15'), ('dig:Sao Paulo BR', '-23.75,-46.85,-23.45,-46.45'),
]


def dig(job):
    name, bb = job
    rnd = random.Random(name)
    q = f'[out:json][timeout:60];(way["landuse"="construction"]({bb});way["landuse"="quarry"]({bb}););out geom 400;'
    els = []
    for m in OVERPASS:
        try:
            d = json.loads(curl(m, q, 80))
            els = d.get('elements', [])
            if els:
                break
        except Exception:
            pass
    from shapely.geometry import Polygon
    out = []
    rnd.shuffle(els)
    for e in els:
        g = e.get('geometry') or []
        if len(g) < 4:
            continue
        try:
            P = Polygon([(p['lon'], p['lat']) for p in g])
        except Exception:
            continue
        my, mx = m_per_deg(g[0]['lat'])
        if not P.is_valid or P.area * my * mx < 6000:
            continue
        pt = P.representative_point()
        if near_spot(pt.y, pt.x):
            continue
        out.append({'cls': 'bare', 'lat': pt.y, 'lon': pt.x, 'region': name, 'src': e['tags'].get('landuse')})
        if len(out) >= 10:
            break
    return out


# 3 · regions abroad --------------------------------------------------------------
ABROAD = [
    ('Kent UK', 51.25, 0.85), ('Loire FR', 47.40, 0.70), ('Bavaria DE', 48.30, 11.60), ('Utrecht NL', 52.05, 5.20),
    ('Andalusia ES', 37.40, -5.90), ('Tuscany IT', 43.40, 11.30), ('Mazovia PL', 52.10, 20.90),
    ('Nairobi KE', -1.20, 36.90), ('Gauteng ZA', -26.00, 28.10), ('Parana BR', -25.40, -49.30),
    ('Buenos Aires AR', -34.70, -58.70), ('Santiago CL', -33.50, -70.70), ('Punjab IN', 30.80, 75.80),
    ('Kanto JP', 36.10, 140.10), ('Victoria AU', -37.70, 145.40), ('Canterbury NZ', -43.55, 172.40),
    ('Ontario CA', 43.55, -80.25), ('Jalisco MX', 20.65, -103.30),
]


def abroad(reg):
    name, lat, lon = reg
    rnd = random.Random(name)
    try:
        F, _ = tile_feats(lat, lon)
    except Exception:
        return []
    my, mx = m_per_deg(lat)
    lines = [g for g, p in F.get('transportation', []) if p.get('brunnel') != 'tunnel']
    blds = [g for g, p in F.get('building', [])]
    try:
        avoid = unary_union([ln.buffer(6 / mx) for ln in lines] + [b.buffer(4 / mx) for b in blds])
    except Exception:
        avoid = None
    bycat = {}
    for layer in ('building', 'water', 'landcover'):
        for g, p in F.get(layer, []):
            c = cat_of(layer, p)
            if c:
                bycat.setdefault(c, []).append(g)
    pts = []
    for c, gs in bycat.items():
        polys = []
        for g in gs:
            polys += list(g.geoms) if g.geom_type == 'MultiPolygon' else [g]
        polys = [q for q in polys if q.is_valid and q.area > 0]
        if not polys:
            continue
        ws = np.array([q.area for q in polys])
        ws = ws / ws.sum()
        got = tries = 0
        while got < 8 and tries < 400:
            tries += 1
            q = polys[rnd.choices(range(len(polys)), weights=ws)[0]]
            x0, y0, x1, y1 = q.bounds
            P = Point(rnd.uniform(x0, x1), rnd.uniform(y0, y1))
            if not q.contains(P) or q.exterior.distance(P) * mx < MARGIN[c]:
                continue
            if c != 'building' and avoid is not None and avoid.contains(P):
                continue
            if near_spot(P.y, P.x):
                continue
            pts.append({'cls': c, 'lat': P.y, 'lon': P.x, 'region': 'abroad:' + name, 'src': 'osm'})
            got += 1
    return pts


if __name__ == '__main__':
    with cf.ThreadPoolExecutor(6) as ex:
        allp = sum(ex.map(roofs, METROS), []) + sum(ex.map(abroad, ABROAD), [])
    for job in DIG:  # Overpass: one at a time
        got = dig(job)
        print(job[0], len(got), flush=True)
        allp += got
    json.dump(allp, open('labels4.json', 'w'), indent=0)
    print('points:', len(allp))
    print(collections.Counter(p['cls'] for p in allp))
    print(collections.Counter(p['region'].split(':')[0] for p in allp))
