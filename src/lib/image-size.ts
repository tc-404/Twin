// ---------------------------------------------------------------------------
// 图片原始宽高探测
//
// 为什么需要：官方 MD 的图片语法是 `![alt#宽px #高px](url)`，**宽高必须显式给**。
// 写死 640x360 会把竖图拉成横屏；要「按比例缩小」就得先知道原图是横的还是竖的。
//
// 做法：只拉图片最前面的一段字节，从文件头里读宽高（PNG / JPEG / GIF / WebP），
// 不下载整张图。读不出来就用默认比例，不拖慢整条消息。
// ---------------------------------------------------------------------------

const READ_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 8000;

export interface Size {
    w: number;
    h: number;
}

const cache = new Map<string, Size | null>();

function be32(b: Uint8Array, o: number): number {
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function be16(b: Uint8Array, o: number): number {
    return ((b[o] << 8) | b[o + 1]) & 0xffff;
}
function le16(b: Uint8Array, o: number): number {
    return (b[o + 1] << 8) | b[o];
}

function parsePng(b: Uint8Array): Size | null {
    // 89 50 4E 47 0D 0A 1A 0A | IHDR 长度(4) "IHDR" 宽(4) 高(4)
    if (b.length < 24) return null;
    if (be32(b, 0) !== 0x89504e47 || be32(b, 12) !== 0x49484452) return null;
    const w = be32(b, 16);
    const h = be32(b, 20);
    return w > 0 && h > 0 ? { w, h } : null;
}

function parseGif(b: Uint8Array): Size | null {
    if (b.length < 10) return null;
    const sig = String.fromCharCode(b[0], b[1], b[2]);
    if (sig !== 'GIF') return null;
    const w = le16(b, 6);
    const h = le16(b, 8);
    return w > 0 && h > 0 ? { w, h } : null;
}

function parseJpeg(b: Uint8Array): Size | null {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let o = 2;
    while (o + 9 < b.length) {
        if (b[o] !== 0xff) {
            o++;
            continue;
        }
        const marker = b[o + 1];
        // SOF0 ~ SOF15，跳过 DHT(0xC4) / JPG(0xC8) / DAC(0xCC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            const h = be16(b, o + 5);
            const w = be16(b, o + 7);
            return w > 0 && h > 0 ? { w, h } : null;
        }
        // 其它 marker：跳到下一段（长度字段在高位在前）
        const len = be16(b, o + 2);
        if (len < 2) return null;
        o += 2 + len;
    }
    return null;
}

function parseWebp(b: Uint8Array): Size | null {
    if (b.length < 30) return null;
    if (be32(b, 0) !== 0x52494646 || be32(b, 8) !== 0x57454250) return null; // RIFF....WEBP
    const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);

    if (fmt === 'VP8 ') {
        // lossy：宽高各 14 bit，位于 chunk data 偏移 6 处
        const o = 26;
        if (b.length < o + 4) return null;
        const w = b[o] | ((b[o + 1] & 0x3f) << 8);
        const h = b[o + 2] | ((b[o + 3] & 0x3f) << 8);
        return w > 0 && h > 0 ? { w, h } : null;
    }
    if (fmt === 'VP8L') {
        // lossless：14 bit 宽-1、14 bit 高-1，从 21 字节处按位读
        const o = 21;
        if (b.length < o + 4) return null;
        const bits = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
        const w = (bits & 0x3fff) + 1;
        const h = ((bits >> 14) & 0x3fff) + 1;
        return w > 1 && h > 1 ? { w, h } : null;
    }
    if (fmt === 'VP8X') {
        // extended：24 bit canvas 宽-1 / 高-1，位于 chunk data 偏移 4 处
        const o = 24;
        if (b.length < o + 6) return null;
        const w = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + 1;
        const h = (b[o + 3] | (b[o + 4] << 8) | (b[o + 5] << 16)) + 1;
        return w > 1 && h > 1 ? { w, h } : null;
    }
    return null;
}

function sniff(buf: Uint8Array): Size | null {
    return parsePng(buf) ?? parseGif(buf) ?? parseJpeg(buf) ?? parseWebp(buf);
}

/** 探测一张图的原始尺寸；读不出来返回 null（调用方用默认比例兜底） */
export async function probeImageSize(url: string): Promise<Size | null> {
    const key = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(key)) return null;
    if (cache.has(key)) return cache.get(key) ?? null;

    let result: Size | null = null;
    try {
        const res = await fetch(key, {
            headers: { Range: `bytes=0-${READ_BYTES - 1}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (res.ok || res.status === 206) {
            const stream = res.body;
            if (stream) {
                const reader = stream.getReader();
                const chunks: Uint8Array[] = [];
                let total = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done || !value) break;
                    chunks.push(value);
                    total += value.length;
                    if (total >= READ_BYTES) break;
                }
                try {
                    await reader.cancel();
                } catch {
                    /* 取消失败无所谓，头已经读到了 */
                }
                const merged = new Uint8Array(total);
                let off = 0;
                for (const c of chunks) {
                    merged.set(c, off);
                    off += c.length;
                }
                result = sniff(merged);
            }
        }
    } catch {
        result = null;
    }

    cache.set(key, result);
    // 别让缓存无限涨
    if (cache.size > 500) {
        for (const k of cache.keys()) {
            cache.delete(k);
            if (cache.size <= 200) break;
        }
    }
    return result;
}

/** 最小显示尺寸：避免 1x1 的透明占位图（B站封面常见）被缩成一个看不见的点 */
const MIN_EDGE = 120;

/**
 * 等比缩放：长边不超过 max，短边按原比例跟着走。
 * 默认只缩不放（300x400 不会被拉成 640x853）；
 * 但小于 MIN_EDGE 的会按同比例放大到能看清——比例始终保持不变，
 * 不会出现「竖图变横图」。
 */
export function fitSize(size: Size | null, max = 640): Size {
    if (!size || size.w <= 0 || size.h <= 0) return { w: 640, h: 360 };
    const scale = Math.min(1, max / size.w, max / size.h);
    let w = Math.max(1, Math.round(size.w * scale));
    let h = Math.max(1, Math.round(size.h * scale));
    const minEdge = Math.min(w, h);
    if (minEdge < MIN_EDGE) {
        const up = MIN_EDGE / minEdge;
        w = Math.round(w * up);
        h = Math.round(h * up);
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
}
