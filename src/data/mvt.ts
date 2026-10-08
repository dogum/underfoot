// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Mapbox Vector Tile decoding.
 */
import { merc } from '../core/geo';
import { OFM_LAYERS } from './openfreemap';

/* ---- Mapbox Vector Tile decoder: a minimal protobuf reader, no library ---- */
export function decodeMVT(buf, z, tx, ty) {
  const b = new Uint8Array(buf),
    dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const varint = () => {
    let v = 0,
      m = 1,
      c;
    do {
      c = b[p++];
      v += (c & 0x7f) * m;
      m *= 128;
    } while (c & 0x80);
    return v;
  };
  const zz = n => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);
  const skip = w => {
    if (w === 0) varint();
    else if (w === 1) p += 8;
    else if (w === 2) {
      const l = varint();
      p += l;
    } else if (w === 5) p += 4;
  };
  const str = e => new TextDecoder().decode(b.subarray(p, e));
  const n2 = Math.pow(2, z),
    feats = [];
  const tileEnd = b.length;
  while (p < tileEnd) {
    const key = varint(),
      f = key >> 3,
      w = key & 7;
    if (f !== 3 || w !== 2) {
      skip(w);
      continue;
    }
    const len = varint(),
      end = p + len;
    let name = '',
      ext = 4096;
    const keys = [],
      vals = [],
      rawF = [];
    while (p < end) {
      const k2 = varint(),
        f2 = k2 >> 3,
        w2 = k2 & 7;
      if (f2 === 1 && w2 === 2) {
        const l = varint();
        name = str(p + l);
        p += l;
      } else if (f2 === 2 && w2 === 2) {
        const l = varint();
        rawF.push([p, p + l]);
        p += l;
      } else if (f2 === 3 && w2 === 2) {
        const l = varint();
        keys.push(str(p + l));
        p += l;
      } else if (f2 === 4 && w2 === 2) {
        const l = varint(),
          ve = p + l;
        let v = null;
        while (p < ve) {
          const k3 = varint(),
            f3 = k3 >> 3,
            w3 = k3 & 7;
          if (f3 === 1) {
            const l3 = varint();
            v = str(p + l3);
            p += l3;
          } else if (f3 === 2) {
            v = dv.getFloat32(p, true);
            p += 4;
          } else if (f3 === 3) {
            v = dv.getFloat64(p, true);
            p += 8;
          } else if (f3 === 4 || f3 === 5) {
            v = varint();
          } else if (f3 === 6) {
            v = zz(varint());
          } else if (f3 === 7) {
            v = !!varint();
          } else skip(w3);
        }
        vals.push(v);
      } else if (f2 === 5 && w2 === 0) {
        ext = varint();
      } else skip(w2);
    }
    p = end;
    if (!OFM_LAYERS.has(name)) continue;
    for (const [fs, fe] of rawF) {
      let type = 0,
        tags = null,
        geom = null;
      const save = p;
      p = fs;
      while (p < fe) {
        const k = varint(),
          ff = k >> 3,
          ww = k & 7;
        if (ff === 2 && ww === 2) {
          const l = varint(),
            e = p + l;
          tags = [];
          while (p < e) tags.push(varint());
        } else if (ff === 3 && ww === 0) {
          type = varint();
        } else if (ff === 4 && ww === 2) {
          const l = varint(),
            e = p + l;
          geom = [];
          while (p < e) geom.push(varint());
        } else skip(ww);
      }
      p = save;
      if (!geom || type < 1) continue;
      const props = {};
      if (tags) for (let i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      // geometry commands -> rings of flat [lon,lat,...]
      const rings = [];
      let ring = null,
        x = 0,
        y = 0,
        i = 0;
      const toLL = (px, py) => [((tx + px / ext) / n2) * 360 - 180, merc.lat(ty + py / ext, z)];
      while (i < geom.length) {
        const c = geom[i++],
          id = c & 7,
          cnt = c >> 3;
        if (id === 1 || id === 2) {
          for (let k = 0; k < cnt; k++) {
            x += zz(geom[i++]);
            y += zz(geom[i++]);
            const [lo, la] = toLL(x, y);
            if (id === 1) {
              if (ring) rings.push(ring);
              ring = [lo, la];
            } else ring.push(lo, la);
          }
        } else if (id === 7) {
          if (ring) ring.push(ring[0], ring[1]);
        } else break;
      }
      if (ring) rings.push(ring);
      const rr = rings.map(r => Float64Array.from(r));
      let w_ = 180,
        s_ = 90,
        e_ = -180,
        n_ = -90;
      for (const r of rr)
        for (let k = 0; k < r.length; k += 2) {
          if (r[k] < w_) w_ = r[k];
          if (r[k] > e_) e_ = r[k];
          if (r[k + 1] < s_) s_ = r[k + 1];
          if (r[k + 1] > n_) n_ = r[k + 1];
        }
      feats.push({ L: name, t: type, p: props, r: rr, bb: [w_, s_, e_, n_] });
    }
  }
  return { x: tx, y: ty, feats };
}
