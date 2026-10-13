// ---------------------------------------------------------------------------
// 信息文本：照抄 MKbot 视频解析的输出格式
//
// 依据 MKbot/src/mkbot-core.ts：
//   B站   18973-18987   标题/简介/作者/════/时长/大小/发布/════/播放/弹幕/评论/分享/点赞/收藏/投币
//   抖音   19008-19014   标题/作者/[音乐]/[时长]
//   小红书 19069         标题/作者/描述
//   快手   19117-19122   标题/作者/[发布]/点赞/[音乐]；图集另加「张数」(19134)
// 字段名、顺序、分隔线都跟那边一致。
// ---------------------------------------------------------------------------

import { PLATFORM_LABEL, type ParseResult } from './parse.js';

const 分隔线 = '══════════════';

function 数字(n: number | undefined): string {
    return n == null ? '0' : String(n);
}

/** 秒 → 时:分:秒 / 分:秒 */
function 时长文案(sec: number | null | undefined): string {
    if (sec == null || !Number.isFinite(sec) || sec <= 0) return '';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(r).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function 音乐行(music?: ParseResult['music']): string {
    if (!music || typeof music !== 'object') return '';
    const name = String(music.name ?? '').trim();
    const artist = String(music.artist ?? '').trim();
    if (!name && !artist) return '';
    // MKbot：音乐:${title}${author ? ` — ${author}` : ""}
    return artist ? `${name} — ${artist}` : name;
}

/** 按平台还原 MKbot 同款信息文本 */
export function buildInfoText(r: ParseResult): string {
    const 平台 = r.platform ?? 'dy';
    const 标题 = String(r.title ?? '').trim();
    const 作者 = String(r.author ?? '').trim();
    const 描述 = String(r.description ?? '').trim();
    const s = r.stats ?? {};

    if (平台 === 'blbl') {
        const lines: string[] = [
            `标题:${标题}`,
            `简介:${描述}`,
            `作者:${作者}`,
            分隔线,
            `时长:${时长文案(r.duration)}`,
            `大小:${String(r.sizeText ?? '').trim()}`,
            `发布:${String(r.publishTime ?? '').trim()}`,
            分隔线,
            `播放:${数字(s.views)}`,
            `弹幕:${数字(s.danmaku)}`,
            `评论:${数字(s.comments)}`,
            `分享:${数字(s.shares)}`,
            `点赞:${数字(s.likes)}`,
            `收藏:${数字(s.favorites)}`,
            `投币:${数字(s.coins)}`,
        ];
        return lines.join('\n');
    }

    if (平台 === 'xhs') {
        // MKbot：标题 / 作者 / 描述
        return [`标题:${标题}`, `作者:${作者}`, `描述:${描述}`].join('\n');
    }

    if (平台 === 'ks') {
        const lines: string[] = [`标题:${标题}`, `作者:${作者}`];
        if (r.publishTime) lines.push(`发布:${r.publishTime}`);
        lines.push(`点赞:${数字(s.likes)}`);
        const m = 音乐行(r.music);
        if (m) lines.push(`音乐:${m}`);
        // MKbot：图集额外补「张数」
        if (r.type === 'image' && Array.isArray(r.images) && r.images.length) {
            lines.push(`张数:${r.images.length}`);
        }
        return lines.join('\n');
    }

    // 抖音
    const lines: string[] = [`标题:${标题}`, `作者:${作者}`];
    const m = 音乐行(r.music);
    if (m) lines.push(`音乐:${m}`);
    // MKbot：仅 video 且有时长才补「时长」
    if (r.type === 'video' && r.duration != null) {
        const d = 时长文案(r.duration);
        if (d) lines.push(`时长:${d}`);
    }
    return lines.join('\n');
}

/** 平台中文名（用于合并转发节点名 / MD 标题） */
export function platformLabel(r: ParseResult): string {
    return PLATFORM_LABEL[r.platform ?? 'dy'] ?? '解析';
}
