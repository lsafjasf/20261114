#!/usr/bin/env python3
"""独立 PNG 校验：签名、CRC、zlib 解压、2x2 重铺一致性（不依赖项目 JS 代码）。"""
import glob
import struct
import zlib


def decode_png(path):
    blob = open(path, "rb").read()
    assert blob[:8] == b"\x89PNG\r\n\x1a\n", "PNG 签名错误"
    pos = 8
    idat = b""
    width = height = 0
    while pos < len(blob):
        length = struct.unpack(">I", blob[pos:pos + 4])[0]
        kind = blob[pos + 4:pos + 8]
        body = blob[pos + 8:pos + 8 + length]
        stored_crc = struct.unpack(">I", blob[pos + 8 + length:pos + 12 + length])[0]
        assert stored_crc == zlib.crc32(kind + body) & 0xFFFFFFFF, f"{kind} CRC 错误"
        if kind == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", body[:10])
            assert bit_depth == 8 and color_type == 6
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * 4
    assert len(raw) == height * (stride + 1)
    rows = [raw[y * (stride + 1) + 1:y * (stride + 1) + 1 + stride] for y in range(height)]
    return width, height, b"".join(rows)


def main():
    for name in ("plain", "twill", "satin"):
        w, h, pixels = decode_png(f"exports/weave-{name}.png")
        w2, h2, grid = decode_png(f"exports/weave-{name}-2x2.png")
        assert (w2, h2) == (2 * w, 2 * h)
        rows = [pixels[y * w * 4:(y + 1) * w * 4] for y in range(h)]
        assert b"".join(r + r for r in rows) * 2 == grid, f"{name} 重铺结果不一致"
        print(f"{name}: {w}x{h} 单元有效，2x2 重铺逐字节一致")
    print("独立 PNG 校验全部通过")


if __name__ == "__main__":
    main()
