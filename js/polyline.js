// Compact route storage: the encoded polyline format (5 decimal places, about
// 1m), which keeps a long route to a few tens of KB. Points are [lon, lat].

export function encodeLine(pts) {
  let out = "", pLat = 0, pLon = 0;
  const put = (delta) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of pts) {
    const la = Math.round(lat * 1e5), lo = Math.round(lon * 1e5);
    put(la - pLat);
    put(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}

export function decodeLine(line) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  const take = () => {
    let shift = 0, v = 0, b;
    do {
      b = line.charCodeAt(i++) - 63;
      v |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return v & 1 ? ~(v >> 1) : v >> 1;
  };
  while (i < line.length) {
    lat += take();
    lon += take();
    pts.push([lon / 1e5, lat / 1e5]);
  }
  return pts;
}

// A short id for a line, so saving the same route twice gives one favourite.
export function lineId(line) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
