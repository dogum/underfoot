import json,numpy as np,warnings
from sklearn.linear_model import LogisticRegression
warnings.filterwarnings("ignore")
D=json.load(open("patches2.json")); Xr=np.load("Xr.npy"); y=np.load("y.npy"); grp=np.array(json.load(open("grp.json")))
# manual sites have their own dates in calib_raw.json
raw={r["label"]:r for r in json.load(open("calib_raw.json")) if "err" not in r}
def leafon(d):
    dt=d.get("date")
    if d["region"].startswith("site:"): dt=(raw.get(d["region"][5:],{}).get("meta") or {}).get("date")
    if not dt or not str(dt).isdigit(): return 0.5
    m=int(str(dt)[4:6]); lat=d["lat"]
    if abs(lat)<23: return 0.9
    if lat<0: m=(m+5)%12+1
    return {1:0,2:0,3:0.1,4:0.4,5:0.85,6:1,7:1,8:1,9:0.9,10:0.55,11:0.1,12:0}[m]
lo=np.array([leafon(d) for d in D])
G=Xr[:,4]; L=Xr[:,0]
Xs=np.column_stack([Xr,lo,lo*G,lo*L])
def softmax(a): a=a-a.max(1,keepdims=True); e=np.exp(a); return e/e.sum(1,keepdims=True)
def cv(X,C):
    P=np.zeros((len(y),9))
    for g in np.unique(grp):
        te=grp==g; tr=~te; mu=X[tr].mean(0); sd=X[tr].std(0)+1e-9
        m=LogisticRegression(C=C,max_iter=4000,class_weight="balanced").fit((X[tr]-mu)/sd,y[tr])
        p=np.full((te.sum(),9),1e-6); p[:,m.classes_]=m.predict_proba((X[te]-mu)/sd); P[te]=p/p.sum(1,keepdims=True)
    return P
def score(P):
    pred=P.argmax(1); return (pred==y).mean(), np.mean([(pred[y==k]==k).mean() for k in range(9)]), -np.mean(np.log(P[np.arange(len(y)),y]+1e-12))
print("leaf-on share in data:", np.round(np.mean(lo<0.3),2),"winter /", np.round(np.mean(lo>0.7),2),"summer")
P0=cv(Xr,0.03); P1=cv(Xs,0.03)
print("LR rich           acc=%.3f bal=%.3f ll=%.3f"%score(P0))
print("LR rich + season  acc=%.3f bal=%.3f ll=%.3f"%score(P1))
for T in [0.8,1.0,1.2,1.5]:
    LP=np.log(P1+1e-12)/T; print(f"   T={T}: ll={score(softmax(LP))[2]:.3f}")
np.save("lo.npy",lo)
