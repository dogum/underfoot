import json,math,numpy as np,warnings
from sklearn.linear_model import LogisticRegression
from sklearn.mixture import GaussianMixture
warnings.filterwarnings("ignore")
D=json.load(open("patches2.json")); Z=np.load("px48.npz"); PX=Z["px"]
CL=["forest","scrub","grass","crop","water","wetland","bare","paved","building"]
y=np.array([CL.index(d["cls"]) for d in D])
R=[d["region"] for d in D]; grp=np.array([r if not r.startswith("site:") else "site:"+r.split()[-1] for r in R])
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
def feat_core(i):
    s=stats(PX[i][12:36,12:36]); return [s[k] for k in ("L","S","G","B","R","T","E","D")]
def feat_rich(i):
    c=stats(PX[i][12:36,12:36]); x=stats(PX[i])
    return [c[k] for k in ("L","L10","L90","S","G","G10","G90","B","R","T","E","D")]+[x["L"],x["G"],x["T"],x["E"],x["B"],c["G"]-x["G"],c["L"]-x["L"],c["T"]-x["T"]]
Xc=np.array([feat_core(i) for i in range(len(D))]); Xr=np.array([feat_rich(i) for i in range(len(D))])
def softmax(a): a=a-a.max(1,keepdims=True); e=np.exp(a); return e/e.sum(1,keepdims=True)
def score(P): 
    pred=P.argmax(1); return (pred==y).mean(), np.mean([(pred[y==k]==k).mean() for k in range(9)]), -np.mean(np.log(P[np.arange(len(y)),y]+1e-12))
def cv_lr(X,C,poly=False):
    P=np.zeros((len(y),9))
    for g in np.unique(grp):
        te=grp==g; tr=~te
        mu=X[tr].mean(0); sd=X[tr].std(0)+1e-9; Ztr=(X[tr]-mu)/sd; Zte=(X[te]-mu)/sd
        if poly:
            from sklearn.preprocessing import PolynomialFeatures
            pf=PolynomialFeatures(2,include_bias=False).fit(Ztr); Ztr=pf.transform(Ztr); Zte=pf.transform(Zte)
        m=LogisticRegression(C=C,max_iter=3000,class_weight="balanced").fit(Ztr,y[tr])
        p=np.full((te.sum(),9),1e-6); p[:,m.classes_]=m.predict_proba(Zte); P[te]=p/p.sum(1,keepdims=True)
    return P
def cv_gmm(X,nc):
    LL=np.zeros((len(y),9))
    for g in np.unique(grp):
        te=grp==g; tr=~te
        for k in range(9):
            Xk=X[tr][y[tr]==k]
            m=GaussianMixture(min(nc,max(1,len(Xk)//12)),covariance_type="diag",reg_covar=1e-3,random_state=0,n_init=2).fit(Xk)
            LL[te,k]=np.maximum(m.score_samples(X[te]),-60)
    return LL
print("model                                   acc   bal   logloss")
for nm,P in [("GMM2 core feats, T=4",softmax(cv_gmm(Xc,2)/4)),("GMM2 rich feats, T=4",softmax(cv_gmm(Xr,2)/4))]:
    a,b,l=score(P); print(f"{nm:38s} {a:.3f} {b:.3f} {l:.3f}")
for C in [0.03,0.1,0.3,1.0]:
    a,b,l=score(cv_lr(Xc,C)); print(f"{'LR core C='+str(C):38s} {a:.3f} {b:.3f} {l:.3f}")
    a,b,l=score(cv_lr(Xr,C)); print(f"{'LR rich C='+str(C):38s} {a:.3f} {b:.3f} {l:.3f}")
for C in [0.01,0.03,0.1]:
    a,b,l=score(cv_lr(Xr,C,poly=True)); print(f"{'LR rich+poly2 C='+str(C):38s} {a:.3f} {b:.3f} {l:.3f}")
np.save("Xr.npy",Xr); np.save("y.npy",y); json.dump(list(grp),open("grp.json","w"))
