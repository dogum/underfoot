"""v4 patches: today's imagery at every labelled point (v3's and v4's), and the
same spot in three older releases of Esri's archive (Wayback, 2014, 2017 and
2019). An older picture is kept only where it still matches today's, shifted
by up to 8 px, so the label from today's map still applies; a picture identical
to today's adds nothing and is dropped too.

    python3 patches4.py      # writes X4.npy, y4.npy, grp4.json, meta4.json

Each row keeps the 23 features (features.py). The patches themselves go to
px4.npz for trying features offline; they're Esri imagery, so that file stays
out of git (.gitignore).
"""
import io, json, math, urllib.request, collections, concurrent.futures as cf
import numpy as np
from PIL import Image
from features import features

UA = {'User-Agent': 'underfoot-calib/4 (github.com/dogum/underfoot)'}
CL = ['forest', 'scrub', 'grass', 'crop', 'water', 'wetland', 'bare', 'paved', 'building']
CURRENT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
WAYBACK = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{r}/{z}/{y}/{x}'
RELEASES = {'2014': '10', '2017': '14342', '2019': '645'}  # World Imagery (Wayback 2014-02-20, 2017-05-31, 2019-06-26)
KEEP_FROM, SAME_ABOVE = 0.6, 0.995


def tile(url):
    for _ in range(3):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25).read()
            return Image.open(io.BytesIO(raw)).convert('RGB')
        except Exception:
            pass
    return None


def patch(lat, lon, rel=None, z=18, half=24):
    n = 2 ** z
    X = (lon + 180) / 360 * n * 256
    Y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256
    x0, y0 = int(round(X - half)), int(round(Y - half))
    out = Image.new('RGB', (2 * half, 2 * half))
    for tx in range(x0 // 256, (x0 + 2 * half - 1) // 256 + 1):
        for ty in range(y0 // 256, (y0 + 2 * half - 1) // 256 + 1):
            u = CURRENT.format(z=z, x=tx, y=ty) if rel is None else WAYBACK.format(r=rel, z=z, x=tx, y=ty)
            t = tile(u)
            if t is None:
                return None
            out.paste(t, (tx * 256 - x0, ty * 256 - y0))
    a = np.asarray(out, np.uint8)
    g = a.mean(axis=2)
    if abs(g.mean() - 204) < 6 and g.std() < 8:  # "Map data not yet available"
        return None
    return a


def ncc(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def match(now, old, s=8):
    """how well an older patch matches today's, allowing a small misregistration"""
    gn, go = now.mean(axis=2), old.mean(axis=2)
    c = gn[s:48 - s, s:48 - s]
    best = max(ncc(c, go[s + dy:48 - s + dy, s + dx:48 - s + dx]) for dy in range(-s, s + 1, 2) for dx in range(-s, s + 1, 2))
    return best, ncc(gn, go)


def work(item):
    i, p = item
    now = patch(p['lat'], p['lon'])
    if now is None:
        return []
    rows = [{'i': i, 'src': 'now', 'f': features(now), 'ncc': 1.0, 'px': now}]
    for year, rel in RELEASES.items():
        old = patch(p['lat'], p['lon'], rel)
        if old is None:
            continue
        best, same = match(now, old)
        if best >= KEEP_FROM and same < SAME_ABOVE:
            rows.append({'i': i, 'src': year, 'f': features(old), 'ncc': round(best, 3), 'px': old})
    return rows


if __name__ == '__main__':
    old = json.load(open('patches2.json'))
    grp = json.load(open('grp.json'))
    for p, g in zip(old, grp):
        p['region'] = g
        p['set'] = 'v3'
    new = json.load(open('labels4.json'))
    for p in new:
        p['set'] = 'v4'
    pts = old + new
    with cf.ThreadPoolExecutor(12) as ex:
        res = list(ex.map(work, enumerate(pts)))
    X, y, G, meta, PX = [], [], [], [], []
    for rows in res:
        for r in rows:
            PX.append(r['px'])
            p = pts[r['i']]
            X.append(r['f'])
            y.append(CL.index(p['cls']))
            G.append(p['region'])
            meta.append({'i': r['i'], 'set': p['set'], 'src': r['src'], 'ncc': r['ncc'], 'cls': p['cls'],
                         'region': p['region'], 'lat': round(p['lat'], 6), 'lon': round(p['lon'], 6)})
    np.save('X4.npy', np.array(X))
    np.savez_compressed('px4.npz', px=np.array(PX, np.uint8))
    np.save('y4.npy', np.array(y))
    json.dump(G, open('grp4.json', 'w'))
    json.dump(meta, open('meta4.json', 'w'))
    print('rows:', len(X), 'from', len(pts), 'points')
    print(collections.Counter((m['set'], m['src']) for m in meta))
    # the v3 points' features today, against v3's saved ones (the imagery may have changed since)
    Xr = np.load('Xr.npy')
    now3 = {m['i']: x for m, x in zip(meta, X) if m['set'] == 'v3' and m['src'] == 'now'}
    d = np.array([np.abs(np.array(now3[i][:20]) - Xr[i]).max() for i in now3])
    print(f'v3 points re-read today: {len(d)}; features unchanged (|Δ| < 1e-6) at {(d < 1e-6).sum()}')
