"""v4: refit the imagery classifier on v3's patches plus v4's (flat roofs,
construction ground checked by eye, eighteen regions abroad, and older captures
that still match today's picture), with three shape features added to v3's 20
(features.py), and compare it with v3 on the same held-out data.

    python3 fit4.py          # prints the comparison
    python3 fit4.py --export # also writes ../model/img_model.json and the class
                             # medians the engine tests use as typical patches

Every score is held out by region: a patch is scored by a model that never saw
its region (leave one region out). v3 is scored as shipped on the v4 regions,
which it never saw (img_model_v3.json is a copy); on its own regions it's
scored by its own leave-one-region-out refit, as v3's README reports it.
"""
import json, sys, warnings
import numpy as np
from sklearn.linear_model import LogisticRegression

warnings.filterwarnings('ignore')
CL = ['forest', 'scrub', 'grass', 'crop', 'water', 'wetland', 'bare', 'paved', 'building']
X = np.load('X4.npy')
y = np.load('y4.npy')
G = np.array(json.load(open('grp4.json')))
M = json.load(open('meta4.json'))
labels = json.load(open('labels4.json'))
dig_keep = set(json.load(open('dig_checked.json'))['keep'])

# construction points not checked bare today are dropped, with their older captures
ok = np.array([not (m['set'] == 'v4' and m['region'].startswith('dig:') and m['i'] - 1038 not in dig_keep) for m in M])
X, y, G, M = X[ok], y[ok], G[ok], [m for m, k in zip(M, ok) if k]
SRC = np.array([m['src'] for m in M])
SET = np.array([m['set'] for m in M])
KIND = np.array(['v3' if s == 'v3' else g.split(':')[0] for s, g in zip(SET, G)])  # v3 · roofs · dig · abroad
# v3's own sites were grouped by their last word (state), as fit2.py did
G = np.array([g if not g.startswith('site:') else 'site:' + g.split()[-1] for g in G])


def softmax(a):
    a = a - a.max(1, keepdims=True)
    e = np.exp(a)
    return e / e.sum(1, keepdims=True)


def lr(Xtr, ytr, C):
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
    m = LogisticRegression(C=C, max_iter=5000, class_weight='balanced').fit((Xtr - mu) / sd, ytr)
    return m, mu, sd


def proba(model, Xte):
    m, mu, sd = model
    p = np.full((len(Xte), 9), 1e-6)
    p[:, m.classes_] = m.predict_proba((Xte - mu) / sd)
    return p / p.sum(1, keepdims=True)


def loro(mask_train, C, cols=slice(None)):
    """leave one region out over the rows in mask_train; returns probabilities for those rows"""
    P = np.zeros((len(y), 9))
    Xc = X[:, cols]
    for g in np.unique(G[mask_train]):
        te = mask_train & (G == g)
        tr = mask_train & (G != g)
        P[te] = proba(lr(Xc[tr], y[tr], C), Xc[te])
    return P


def v3_shipped():
    j = json.load(open('img_model_v3.json'))
    assert j['classes'] == CL
    z = (X[:, :20] - np.array(j['mu'])) / np.array(j['sd'])
    return softmax(z @ np.array(j['W']).T + np.array(j['b']))


def score(P, mask):
    yy, pp = y[mask], P[mask]
    pred = pp.argmax(1)
    present = [k for k in range(9) if (yy == k).any()]
    bal = np.mean([(pred[yy == k] == k).mean() for k in present])
    ll = -np.mean(np.log(pp[np.arange(len(yy)), yy] + 1e-12))
    return bal, ll, mask.sum()


def recall(P, mask, k):
    m = mask & (y == k)
    return (P[m].argmax(1) == k).mean(), m.sum()


if __name__ == '__main__':
    v3rows = SET == 'v3'
    now = SRC == 'now'
    old = ~now
    # v3, as its README scores it: its own data, its own recipe, leave one region out
    P3cv = loro(v3rows & now, 0.03, slice(0, 20))
    P3 = v3_shipped()
    print(f'rows {len(y)}: v3 now {int((v3rows & now).sum())}, v4 now {int((~v3rows & now).sum())}, older captures {int(old.sum())}')
    print(f'v3 recipe on v3 data, held out by region: balanced {score(P3cv, v3rows & now)[0]:.3f}, log-loss {score(P3cv, v3rows & now)[1]:.3f}')
    rows = []
    for C in (0.01, 0.03, 0.1, 0.3):
        P = loro(np.ones(len(y), bool), C)
        rows.append((C, P))
        b_all, l_all, _ = score(P, now)
        print(f'v4 C={C}: today\'s pictures balanced {b_all:.3f}, log-loss {l_all:.3f}')
    C, P = min(rows, key=lambda r: score(r[1], now)[1])
    print(f'\nchosen C={C} (lowest held-out log-loss)\n')
    print(f'{"held out":34s} {"v3":>17s} {"v4":>17s}')
    for name, mask, Pv3 in [
        ("v3's regions, today", v3rows & now, P3cv),
        ('regions abroad, today', (KIND == 'abroad') & now, P3),
        ('flat roofs (12 metros), today', (KIND == 'roofs') & now, P3),
        ('construction ground, today', (KIND == 'dig') & now, P3),
        ('older captures, all regions', old, P3),
    ]:
        b3, l3, n = score(Pv3, mask)
        b4, l4, _ = score(P, mask)
        print(f'{name:34s} bal {b3:.3f} ll {l3:.2f}   bal {b4:.3f} ll {l4:.2f}   n={n}')
    for name, mask, k in [('roofs read building', (KIND == 'roofs') & now, CL.index('building')),
                          ('construction read bare', (KIND == 'dig') & now, CL.index('bare')),
                          ('buildings abroad read building', (KIND == 'abroad') & now, CL.index('building')),
                          ('crops abroad read crop', (KIND == 'abroad') & now, CL.index('crop')),
                          ('bare ground abroad read bare', (KIND == 'abroad') & now, CL.index('bare'))]:
        r3, n = recall(P3, mask, k)
        r4, _ = recall(P, mask, k)
        print(f'{name:34s} {r3:6.0%} → {r4:.0%}   (n={n})')
    if '--export' in sys.argv:
        m, mu, sd = lr(X, y, C)
        assert list(m.classes_) == list(range(9))
        b4, l4, _ = score(P, now)
        acc = float((P[now].argmax(1) == y[now]).mean())
        v3j = json.load(open('img_model_v3.json'))
        model = {
            'classes': CL,
            'mu': [round(float(v), 5) for v in mu],
            'sd': [round(float(v), 5) for v in sd],
            'W': [[round(float(v), 4) for v in row] for row in m.coef_],
            'b': [round(float(v), 4) for v in m.intercept_],
            'n': int(len(y)),
            'features': v3j['features'] + ['rect: edge energy along two perpendicular directions',
                                           'flat: core share near its median L', 'sparse: edge energy in the strongest 10%'],
            'cv': {'method': "leave-one-region-out, today's pictures", 'acc': round(acc, 3),
                   'balanced': round(float(b4), 3), 'logloss': round(float(l4), 3)},
            'version': 4,
            'v3_cv': v3j['cv'],
            'note': f'Multinomial logistic regression (C={C}, balanced) on 24 px core + 48 px context patches of Esri '
                    'World Imagery at z18, today and in three older Wayback releases. Refit with calib/fit4.py.',
        }
        json.dump(model, open('../model/img_model.json', 'w'))
        # typical patches for tests/unit: each class's median features over v3's points today
        med = {c: [float(v) for v in np.median(X[v3rows & now & (y == k)], 0)] for k, c in enumerate(CL)}
        json.dump(med, open('../tests/unit/fixtures/class_median_feats.json', 'w'))
        print(f'wrote ../model/img_model.json ({X.shape[1]} features, {len(y)} rows) and the class medians')
