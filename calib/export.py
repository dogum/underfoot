import json,numpy as np,warnings
from sklearn.linear_model import LogisticRegression
warnings.filterwarnings("ignore")
Xr=np.load("Xr.npy"); y=np.load("y.npy"); grp=np.array(json.load(open("grp.json")))
CL=["forest","scrub","grass","crop","water","wetland","bare","paved","building"]
mu=Xr.mean(0); sd=Xr.std(0)+1e-9
m=LogisticRegression(C=0.03,max_iter=5000,class_weight="balanced").fit((Xr-mu)/sd,y)
model={"classes":CL,"mu":[round(float(v),5) for v in mu],"sd":[round(float(v),5) for v in sd],
       "W":[[round(float(v),4) for v in row] for row in m.coef_],"b":[round(float(v),4) for v in m.intercept_],
       "features":["core L med","core L p10","core L p90","core sat med","core exg med","core exg p10","core exg p90",
                   "core blue med","core red med","core log(tex+.004)","core log(edge+.003)","core dark frac",
                   "ctx L med","ctx exg med","ctx log tex","ctx log edge","ctx blue med","core-ctx exg","core-ctx L","core-ctx log tex"],
       "n_train":int(len(y)),"cv":{"acc":0.461,"balanced":0.490,"logloss":1.541},"v2_cv":{"acc":0.348,"balanced":0.336,"logloss":2.900}}
json.dump(model,open("img_model.json","w"))
# per-class recall for v2 vs v3 (CV) for the changelog figure
from fit2 import cv_lr  # noqa
