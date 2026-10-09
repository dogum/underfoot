"""The 23 imagery features of a 48 px patch at zoom 18 (a 24 px core and its
context), exactly as src/engine/imagery-model.ts computes them in the browser.
The first 20 are v3's (fit2.py's feat_rich, without its fitting run); v4 adds
the three shape features."""
import math
import numpy as np

def med(v): v=np.sort(v.ravel()); return v[v.size//2]
def pct(v,q): v=np.sort(v.ravel()); return v[min(v.size-1,int(q*v.size))]
def stats(a):
    a=a.astype(np.float64)/255.; r,g,b=a[...,0],a[...,1],a[...,2]
    lum=.2126*r+.7152*g+.0722*b; tot=np.maximum(r+g+b,1e-4)
    mx,mn=a.max(-1),a.min(-1); sat=np.where(mx>1e-4,(mx-mn)/np.maximum(mx,1e-4),0)
    exg=(2*g-r-b)/tot; blu=(b-(r+g)/2)/tot; red=(r-(g+b)/2)/tot
    gx=np.abs(np.diff(lum,axis=1)).sum(); gy=np.abs(np.diff(lum,axis=0)).sum()
    n=lum.shape[0]*(lum.shape[1]-1)+lum.shape[1]*(lum.shape[0]-1)
    return dict(L=med(lum),L10=pct(lum,.1),L90=pct(lum,.9),S=med(sat),G=med(exg),G10=pct(exg,.1),G90=pct(exg,.9),
                B=med(blu),R=med(red),T=math.log(lum.std()+.004),E=math.log(gx/n*0+ (gx+gy)/n +.003),D=float((lum<.1).mean()))
def feat_rich(px):
    """px: a 48 x 48 x 3 uint8 patch centred on the point"""
    c=stats(px[12:36,12:36]); x=stats(px)
    return [c[k] for k in ("L","L10","L90","S","G","G10","G90","B","R","T","E","D")]+[x["L"],x["G"],x["T"],x["E"],x["B"],c["G"]-x["G"],c["L"]-x["L"],c["T"]-x["T"]]


def shape_feats(px):
    """three shape features, for flat roofs that v3 read as bare ground:

    rect    square-edgedness: the share of the 48 px patch's edge energy (central
            differences stronger than 0.02) along its two strongest perpendicular
            directions, in 18 bins of 10°
    flat    the share of the 24 px core within 0.04 of the core's median brightness
    sparse  edge concentration: the share of the patch's edge energy in its
            strongest 10% of pixels (a roof's seams and units, against soil's
            even texture)
    """
    a = px.astype(np.float64) / 255.
    lum = .2126 * a[..., 0] + .7152 * a[..., 1] + .0722 * a[..., 2]
    gx = lum[1:-1, 2:] - lum[1:-1, :-2]
    gy = lum[2:, 1:-1] - lum[:-2, 1:-1]
    m = np.hypot(gx, gy)
    th = np.mod(np.arctan2(gy, gx), np.pi)
    keep = m > 0.02
    h = np.zeros(18)
    np.add.at(h, (th[keep] / np.pi * 18).astype(int) % 18, m[keep])
    tot = h.sum()
    rect = max(h[b] + h[(b + 9) % 18] for b in range(18)) / tot if tot > 0 else 2 / 18
    core = lum[12:36, 12:36]
    flat = float((np.abs(core - med(core)) < 0.04).mean())
    ms = np.sort(m.ravel())[::-1]
    sparse = ms[:ms.size // 10].sum() / ms.sum() if ms.sum() > 0 else 0.1
    return [float(rect), flat, float(sparse)]


def features(px):
    """the 23 the model reads"""
    return [float(v) for v in feat_rich(px)] + shape_feats(px)
