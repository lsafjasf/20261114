/* 最小 PNG 编码/解码（RGBA, 8-bit, filter 0），零依赖 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TinyPNG = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, body, zlib) {
    const len = body.length;
    const out = new Uint8Array(12 + len);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, len);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + len, crc32(out.subarray(4, 8 + len)));
    return { bytes: out, zlib };
  }

  function u8(arr) {
    return arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  }

  /* 编码：deflate 可以是同步函数（Node zlib.deflateSync）或返回 Promise 的异步函数（浏览器） */
  async function encode(image, deflate) {
    const { width, height, data } = image;
    const stride = width * 4;
    const raw = new Uint8Array(height * (stride + 1));
    for (let y = 0; y < height; y++) {
      const rowStart = y * (stride + 1);
      raw[rowStart] = 0; // filter type 0
      raw.set(u8(data.subarray(y * stride, (y + 1) * stride)), rowStart + 1);
    }

    const idatBody = u8(await deflate(raw));
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const parts = [
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr).bytes,
      chunk('IDAT', u8(idatBody)).bytes,
      chunk('IEND', new Uint8Array(0)).bytes
    ];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const png = new Uint8Array(total);
    let off = 0;
    for (const part of parts) { png.set(part, off); off += part.length; }
    return png;
  }

  /*
   * 解码：仅支持本编码器产出的 RGBA 8-bit / filter 0 PNG。
   * 返回 { width, height, data }，用于导出后回读校验。
   */
  function decode(bytes, inflateSync) {
    const u = u8(bytes);
    let pos = 8;
    let width = 0, height = 0, idat = [];
    while (pos < u.length) {
      const len = new DataView(u.buffer, u.byteOffset + pos, 4).getUint32(0);
      const type = String.fromCharCode(u[pos + 4], u[pos + 5], u[pos + 6], u[pos + 7]);
      const body = u.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') {
        const dv = new DataView(body.buffer, body.byteOffset, 13);
        width = dv.getUint32(0);
        height = dv.getUint32(4);
      } else if (type === 'IDAT') {
        idat.push(body.slice());
      } else if (type === 'IEND') {
        break;
      }
      pos += 12 + len;
    }
    const merged = new Uint8Array(idat.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const part of idat) { merged.set(part, off); off += part.length; }
    const raw = inflateSync(merged);
    const stride = width * 4;
    const data = new Uint8Array(height * stride);
    for (let y = 0; y < height; y++) {
      const src = y * (stride + 1);
      if (raw[src] !== 0) throw new Error('仅支持 filter 0 的校验解码');
      data.set(raw.subarray(src + 1, src + 1 + stride), y * stride);
    }
    return { width, height, data };
  }

  return { encode, decode, crc32 };
});
