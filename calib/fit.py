import json,math,numpy as np,collections,warnings
from sklearn.mixture import GaussianMixture
warnings.filterwarnings("ignore")
D=json.load(open("patches2.json"))
CL=["forest","scrub","grass","crop","water","wetland","bare","paved","building"]
FE=["bright","sat","exg","blue","red","tex","edge","dark"]
def vec(f): 
    return np.array([f["bright"],f["sat"],f["exg"],f["blue"],f["red"],math.log(f["tex"]+.004),math.log(f["edge"]+.003),f["dark"]])
X=np.array([vec(d["f"]) for d in D]); y=np.array([CL.index(d["cls"]) for d in D]); R=np.array([d["region"].replace("site:","s:") for d in D])
# region groups: manual sites grouped by class-label to avoid leaking a site into its own test
grp=np.array([r if not r.startswith("s:") else "s:"+r.split()[-1] for r in R])
V2={"forest":{"bright":[.27,.11],"exg":[.30,.13],"blue":[-.13,.10],"tex":[.062,.030],"edge":[.032,.020]},
 "scrub":{"bright":[.29,.13],"exg":[.16,.11],"blue":[-.09,.10],"tex":[.070,.038],"edge":[.036,.024]},
 "grass":{"bright":[.30,.13],"exg":[.34,.18],"blue":[-.19,.13],"tex":[.018,.018],"edge":[.010,.014]},
 "crop":{"bright":[.42,.17],"exg":[.12,.13],"blue":[-.09,.10],"tex":[.055,.035],"edge":[.038,.026]},
 "water":{"bright":[.11,.09],"exg":[.10,.20],"blue":[.10,.14],"tex":[.012,.016],"edge":[.008,.013]},
 "wetland":{"bright":[.28,.12],"exg":[.11,.11],"blue":[-.10,.11],"tex":[.022,.022],"edge":[.014,.018]},
 "bare":{"bright":[.53,.16],"exg":[.05,.09],"blue":[-.09,.10],"tex":[.070,.045],"edge":[.045,.034]},
 "paved":{"bright":[.52,.19],"exg":[.04,.09],"blue":[-.03,.08],"tex":[.110,.070],"edge":[.045,.036]},
 "building":{"bright":[.42,.26],"exg":[.06,.16],"blue":[-.02,.11],"tex":[.090,.065],"edge":[.030,.030]}}
def v2ll(f):
    return np.array([max(-14,sum(-0.5*((f[k]-m)/s)**2 for k,(m,s) in V2[c].items())) for c in CL])
def softmax(a): a=a-a.max(1,keepdims=True); e=np.exp(a); return e/e.sum(1,keepdims=True)
def report(name,LL):
    P=softmax(LL); pred=P.argmax(1)
    acc=(pred==y).mean()
    bal=np.mean([(pred[y==k]==k).mean() for k in range(len(CL))])
    ll=-np.mean(np.log(P[np.arange(len(y)),y]+1e-12))
    print(f"{name:34s} acc={acc:.3f}  balanced={bal:.3f}  logloss={ll:.3f}")
    return P
LLv2=np.array([v2ll(d["f"]) for d in D])
report("v2 hand-tuned signatures",LLv2)
# LORO-CV fitted models
def cv(fitfn,name):
    LL=np.zeros((len(y),len(CL)))
    for g in np.unique(grp):
        te=grp==g; tr=~te
        models=fitfn(X[tr],y[tr])
        LL[te]=np.column_stack([m(X[te]) for m in models])
    return LL
def fit_gauss(Xt,yt,ncomp=1):
    out=[]
    for k in range(len(CL)):
        Xk=Xt[yt==k]
        g=GaussianMixture(n_components=min(ncomp,max(1,len(Xk)//12)),covariance_type="diag",reg_covar=1e-3,random_state=0,n_init=2).fit(Xk)
        out.append(lambda Z,g=g: np.maximum(g.score_samples(Z),-40))
    return out
LL1=cv(lambda a,b: fit_gauss(a,b,1),"g1"); P1=report("fitted, 1 Gaussian / class (LORO)",LL1)
LL2=cv(lambda a,b: fit_gauss(a,b,2),"g2"); P2=report("fitted, 2-comp GMM / class (LORO)",LL2)
LL3=cv(lambda a,b: fit_gauss(a,b,3),"g3"); P3=report("fitted, 3-comp GMM / class (LORO)",LL3)
# temperature calibration of the best, on CV outputs
best=LL2
for T in [1,1.5,2,2.5,3,4,5]:
    P=softmax(best/T); print(f"   T={T}: logloss={-np.mean(np.log(P[np.arange(len(y)),y]+1e-12)):.3f}")
print("\nconfusion (rows=truth, cols=pred), 2-comp GMM LORO:")
pred=P2.argmax(1); M=np.zeros((9,9),int)
for t,p in zip(y,pred): M[t,p]+=1
print("          "+" ".join(f"{c[:5]:>6s}" for c in CL))
for k,c in enumerate(CL): print(f"{c:9s} "+" ".join(f"{v:6d}" for v in M[k]), f"  recall={M[k,k]/M[k].sum():.2f}")
print("\nv2 confusion:"); pred=softmax(LLv2).argmax(1); M=np.zeros((9,9),int)
for t,p in zip(y,pred): M[t,p]+=1
for k,c in enumerate(CL): print(f"{c:9s} "+" ".join(f"{v:6d}" for v in M[k]), f"  recall={M[k,k]/M[k].sum():.2f}")
