// ---------------------------------------------------------------------------
// 解析调度：识别平台 → 调本地解析器 → 归一化
//
// 归一化结构与 `kakake/src/tools/media/parse-media.ts` 一致，
// 只是把平台砍到抖音 / 快手 / B站 / 小红书 四个（去掉 TikTok / YouTube / X / Telegram）。
// ---------------------------------------------------------------------------

import { callLocalVideoApi, type LocalApiName } from './api/loader.js';

export type Platform = 'blbl' | 'dy' | 'xhs' | 'ks';
export type MediaType = 'video' | 'image' | 'live' | 'unknown';

export interface MediaMusic {
    name: string;
    artist: string;
    url: string;
}

export interface MediaStats {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    favorites?: number;
    coins?: number;
    danmaku?: number;
}

export interface ParseResult {
    ok: boolean;
    platform: Platform | null;
    type: MediaType;
    title: string;
    author?: string;
    duration?: number | null;
    publishTime?: string;
    sizeText?: string;
    description: string;
    tags: string[];
    stats: MediaStats;
    cover: string;
    videoUrl: string | null;
    images: string[];
    liveItems: { image: string; video: string }[];
    music?: MediaMusic;
    message?: string;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
    blbl: '哔哩哔哩',
    dy: '抖音',
    xhs: '小红书',
    ks: '快手',
};

function emptyResult(partial: Partial<ParseResult> & { ok: boolean }): ParseResult {
    return {
        platform: null,
        type: 'unknown',
        title: '',
        description: '',
        tags: [],
        stats: {},
        cover: '',
        videoUrl: null,
        images: [],
        liveItems: [],
        ...partial,
    };
}

/**
 * 小红书域名全集（多个下载器 / 解析服务交叉核对）：
 *   主站   xiaohongshu.com     国际站 rednote.com
 *   短链   xhslink.com / xhslink.cn / xhsurl.com / xhsurl.cn / xhs.com
 *   CDN    xhscdn.com
 */
const XHS_DOMAINS = [
    'xiaohongshu.com',
    'rednote.com',
    'xhslink.com',
    'xhslink.cn',
    'xhsurl.com',
    'xhsurl.cn',
    'xhs.com',
    'xhscdn.com',
];

/**
 * 文本里出现的 host 列表。
 * 两种形态都要收：带协议的完整 URL，以及分享文案被客户端剥掉 https:// 后的裸域名。
 */
function hostsOf(text: string): string[] {
    const s = String(text || '');
    const out: string[] = [];
    for (const m of s.matchAll(/https?:\/\/([^\s/]+)/gi)) {
        out.push(String(m[1]).split(':')[0].toLowerCase());
    }
    // 裸域名：从边界起到第一个 / 为止，整段当 host 取出来，交给下面整体判断
    for (const m of s.matchAll(/(?:^|[\s(（【「])([\w.-]+\.[a-z]{2,24})\//gi)) {
        out.push(String(m[1]).toLowerCase());
    }
    return out;
}

/**
 * host 匹配：**整段**等于白名单，或以「.白名单」结尾。
 *
 * 不能写成让正则直接扫子串——那样 `abxhs.com` 会因为含 `xhs.com` 子串被误判成小红书
 * （实测踩到过）。这里跟 lib/api/http-utils 的 isAllowedDomain 用的是同一套判定。
 */
function isXhs(text: string): boolean {
    return hostsOf(text).some((h) =>
        XHS_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`)),
    );
}

/** 只认四个平台的链接；认不出返回 null（调用方据此不响应、不打日志） */
export function detectPlatform(text: string): Platform | null {
    const s = String(text || '');
    if (
        /https?:\/\/b23\.tv\/[a-zA-Z0-9]+/i.test(s)
        || /https?:\/\/(?:www\.)?bilibili\.com\/video\/BV[a-zA-Z0-9]{10}/i.test(s)
        || /\bBV[a-zA-Z0-9]{10}\b/i.test(s)
        || /^\s*av\d{1,12}\s*$/i.test(s)
        || /^\s*(?:ep|ss)\d{1,10}\s*$/i.test(s)
        || /https?:\/\/[^\s]*bilibili\.com\/(?:video|bangumi|opus)\/[^\s]*/i.test(s)
    ) {
        return 'blbl';
    }
    if (
        /https?:\/\/v\.douyin\.com\/[\w-]+/i.test(s)
        || /https?:\/\/(?:www\.)?douyin\.com\//i.test(s)
        || /https?:\/\/(?:www\.)?iesdouyin\.com\/share\//i.test(s)
    ) {
        return 'dy';
    }
    // 小红书域名全集（与 lib/api/xhs.ts 的 ALLOWED_DOMAINS 保持一致）
    if (isXhs(s)) {
        return 'xhs';
    }
    if (
        /https?:\/\/v\.kuaishou\.com\/[\w-]+/i.test(s)
        || /https?:\/\/(?:www\.)?kuaishou\.com\//i.test(s)
    ) {
        return 'ks';
    }
    return null;
}

function asStr(v: unknown): string {
    return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function asStrArr(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => asStr(x)).filter(Boolean);
}

function asNum(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 上游把实况图塞成字符串数组或 null 时，直接取 x.image 会抛 TypeError */
function asLiveItems(
    v: unknown,
    imageKey: string,
    videoKey: string,
): { image: string; video: string }[] {
    if (!Array.isArray(v)) return [];
    const out: { image: string; video: string }[] = [];
    for (const item of v) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const image = asStr(o[imageKey]);
        const video = asStr(o[videoKey]);
        if (image || video) out.push({ image, video });
    }
    return out;
}

function asAuthor(v: unknown): string {
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object') return asStr((v as Record<string, unknown>).name);
    return '';
}

function toMusic(v: unknown): MediaMusic | undefined {
    if (!v) return undefined;
    if (typeof v === 'string') {
        return v.trim() ? { name: '', artist: '', url: toHttps(v.trim()) } : undefined;
    }
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const url = asStr(o.url);
        if (!url) return undefined;
        return { name: asStr(o.name), artist: asStr(o.artist), url: toHttps(url) };
    }
    return undefined;
}

function distinctDesc(title: string, desc: string): string {
    const t = title.trim();
    const d = desc.trim();
    if (!d || d === t || d === '无描述') return '';
    return d;
}

function formatUnixTime(value: unknown): string | undefined {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return undefined;
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** http 媒体地址统一升 https：官方 MD 里的 http 图会被客户端拦掉 */
function toHttps(url: string): string {
    return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

function upgradeMediaSchemes(r: ParseResult): ParseResult {
    if (!r.ok) return r;
    return {
        ...r,
        cover: toHttps(r.cover),
        videoUrl: r.videoUrl ? toHttps(r.videoUrl) : r.videoUrl,
        images: r.images.map(toHttps),
        liveItems: r.liveItems.map((it) => ({ image: toHttps(it.image), video: toHttps(it.video) })),
    };
}

export async function parseMedia(
    ctx: { pluginPath?: string },
    text: string,
): Promise<ParseResult> {
    const input = String(text || '').trim();
    if (!input) return emptyResult({ ok: false, message: '空内容' });

    const platform = detectPlatform(input);
    if (!platform) {
        return emptyResult({ ok: false, message: '未能识别平台' });
    }

    try {
        const r = (await callLocalVideoApi(ctx, platform as LocalApiName, input)) as Record<string, unknown>;

        if (platform === 'blbl') {
            if (r['状态码'] !== 200 || !r['数据']) {
                return emptyResult({ ok: false, platform, message: asStr(r['消息']) || '解析失败' });
            }
            const d = r['数据'] as Record<string, unknown>;
            const title = asStr(d['视频标题']);
            const images = asStrArr(d['图片']);
            // 图文动态（opus）：有图无视频轨，按图集出
            const isOpus = images.length > 0 && !asStr(d['视频链接']);
            return {
                ok: true,
                platform,
                type: isOpus ? 'image' : 'video',
                title,
                author: asStr((d['UP主信息'] as Record<string, unknown>)?.['UP主名称']) || undefined,
                duration: isOpus ? null : asNum(d['视频时长秒']) ?? null,
                publishTime: asStr(d['发布时间']) || undefined,
                sizeText: isOpus ? undefined : asStr(d['视频大小']) || undefined,
                description: distinctDesc(title, asStr(d['视频描述'])),
                tags: asStrArr(d['标签']),
                stats: {
                    views: asNum(d['播放次数']),
                    likes: asNum(d['点赞数量']),
                    comments: asNum(d['评论数量']),
                    shares: asNum(d['分享数量']),
                    favorites: asNum(d['收藏数量']),
                    coins: asNum(d['投币数量']),
                    danmaku: asNum(d['弹幕数量']),
                },
                cover: asStr(d['视频封面']),
                videoUrl: isOpus ? null : asStr(d['视频链接']) || null,
                images,
                liveItems: [],
            };
        }

        if (platform === 'dy') {
            if (r['code'] !== 200 || !r['data']) {
                return emptyResult({ ok: false, platform, message: asStr(r['msg']) || '解析失败' });
            }
            const d = r['data'] as Record<string, unknown>;
            const title = asStr(d['title']);
            return {
                ok: true,
                platform,
                type: (asStr(d['type']) as MediaType) || 'unknown',
                title,
                author: asAuthor(d['author']) || undefined,
                duration: asNum(d['duration']) ?? null,
                publishTime: formatUnixTime(d['create_time']),
                description: distinctDesc(title, asStr(d['desc'])),
                tags: asStrArr(d['tags']),
                stats: {
                    views: asNum((d['stats'] as Record<string, unknown>)?.['views']),
                    likes: asNum((d['stats'] as Record<string, unknown>)?.['likes']),
                    comments: asNum((d['stats'] as Record<string, unknown>)?.['comments']),
                    shares: asNum((d['stats'] as Record<string, unknown>)?.['shares']),
                    favorites: asNum((d['stats'] as Record<string, unknown>)?.['favorites']),
                },
                cover: asStr(d['cover']),
                videoUrl: d['url'] ? asStr(d['url']) : null,
                images: asStrArr(d['images']),
                liveItems: asLiveItems(d['live_photo'], 'image', 'video'),
                ...(toMusic(d['music']) ? { music: toMusic(d['music']) } : {}),
            };
        }

        if (platform === 'xhs') {
            if (r['success'] !== true || !r['data']) {
                return emptyResult({
                    ok: false,
                    platform,
                    message: asStr(r['error']) || '解析失败',
                });
            }
            const d = r['data'] as Record<string, unknown>;
            const typeRaw = asStr(d['类型']);
            const type: MediaType =
                typeRaw === 'video' || typeRaw === 'image' || typeRaw === 'live' ? typeRaw : 'unknown';
            const title = asStr(d['标题']);
            return {
                ok: true,
                platform,
                type,
                title,
                author: asStr((d['作者'] as Record<string, unknown>)?.['名称']) || undefined,
                description: distinctDesc(title, asStr(d['描述'])),
                tags: asStrArr(d['标签']),
                stats: {
                    views: asNum(d['浏览']),
                    likes: asNum(d['点赞']),
                    comments: asNum(d['评论']),
                    shares: asNum(d['分享']),
                    favorites: asNum(d['收藏']),
                },
                cover: asStr(d['封面']),
                videoUrl: d['视频链接'] ? asStr(d['视频链接']) : null,
                images: asStrArr(d['图片']),
                liveItems: asLiveItems(d['实况图'], '图片', '视频'),
            };
        }

        // ks
        if (r['code'] !== 200 || !r['data']) {
            return emptyResult({ ok: false, platform, message: asStr(r['msg']) || '解析失败' });
        }
        const d = r['data'] as Record<string, unknown>;
        const title = asStr(d['title']);
        return {
            ok: true,
            platform,
            type: d['type'] === 'image' ? 'image' : 'video',
            title,
            author: asAuthor(d['author']) || undefined,
            publishTime: formatUnixTime(d['time']),
            description: '',
            tags: asStrArr(d['tags']),
            stats: {
                views: asNum(d['view']),
                likes: asNum(d['like']),
                comments: asNum(d['comment']),
                shares: asNum(d['share']),
            },
            cover: asStr(d['cover']),
            videoUrl: d['type'] === 'video' ? asStr(d['url']) || null : null,
            images:
                d['type'] === 'image'
                    ? asStrArr(d['images']).length
                        ? asStrArr(d['images'])
                        : [asStr(d['url'])].filter(Boolean)
                    : asStrArr(d['images']),
            liveItems: asLiveItems(d['liveItems'], 'image', 'video'),
            ...(toMusic(d['music']) ? { music: toMusic(d['music']) } : {}),
        };
    } catch (e) {
        return emptyResult({
            ok: false,
            platform,
            message: e instanceof Error ? e.message : String(e),
        });
    }
}

/** 统一入口（归一化后再补一道协议规范化） */
export async function parse(ctx: { pluginPath?: string }, text: string): Promise<ParseResult> {
    return upgradeMediaSchemes(await parseMedia(ctx, text));
}
