// ---------------------------------------------------------------------------
// QQ 官方机器人侧：Markdown 消息（msg_type=2）+ 富媒体视频（msg_type=7）
//
// 需求：官方侧以 MD 输出文本内容；多图片也走 MD——MD 支持多图，还能顺带文字。
// 视频另外真发一条：上传拿 file_info → msg_type=7 发送。
//
// 上传 / 发送细节照 `其他插件源码/GF_mk/src/BOTAPI.ts`：
//   上传   构建上传体(..., fileType) → 请求上传 → file_info（BOTAPI.ts:326-359）
//   视频   file_type=2，`/v2/{groups|users}/{id}/files`，srv_send_msg: false
//   发送   msg_type=7 + media.file_info（BOTAPI.ts:406-424）
//   顺序   先 MD 信息、后发视频；MD 末尾写「视频发送中」——GF_mk 也是这个顺序
//          （见 GF_mk/src/lib/video-parse.ts:95）
//
// 注意：官方 MD 需内邀开通，被动 MD 还要单独申请；没开通时 msg_type=2 会被拒，
// 这时回退成纯文本。
// ---------------------------------------------------------------------------

import type { OfficialEvent, PluginContext } from '../types.js';
import { buildInfoText, platformLabel } from './format.js';
import { fitSize, probeImageSize } from './image-size.js';
import type { ParseResult } from './parse.js';

/** 官方 MD 图片行 */
function md图片行(url: string, alt = 'img', w = 640, h = 360): string {
    return `![${alt}#${w}px #${h}px](${url})`;
}

/** MD 里 [ ] 要转义，换行压成空格（照 GF_mk 的 转义Md） */
function 转义Md(text: unknown): string {
    return String(text ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\n/g, ' ')
        .replace(/\[/g, '\\[')
        .replace(/]/g, '\\]')
        .trim();
}

// ---- msg_seq：同一条 msg_id 回多次必须递增，写死 1 第二条起会失败 ----
const seqMap = new Map<string, number>();
function nextSeq(messageId: string): number {
    const key = String(messageId ?? '');
    const n = (seqMap.get(key) ?? 0) + 1;
    seqMap.set(key, n);
    if (seqMap.size > 500) {
        for (const k of seqMap.keys()) {
            seqMap.delete(k);
            if (seqMap.size <= 200) break;
        }
    }
    return n;
}

type 目标 = { scope: 'group' | 'user'; group_openid?: string; user_openid?: string; msg_id: string };

function 取目标(event: OfficialEvent): 目标 | null {
    const t = String(event?.t ?? '');
    const msg_id = String(event?.id ?? '');
    // 单聊按 event.t 是否 C2C 分路，别拿 member_openid 去打单聊接口
    if (t.startsWith('C2C')) {
        const user_openid = String(event?.author?.user_openid ?? '').trim();
        return user_openid ? { scope: 'user', user_openid, msg_id } : null;
    }
    const group_openid = String(event?.group_openid ?? '').trim();
    return group_openid ? { scope: 'group', group_openid, msg_id } : null;
}

/**
 * 会话标识：照 GF_mk 的 填充消息会话标识（BOTAPI.ts:313-324），
 * 群发消息 body 带 group_openid、单聊带 openid。
 */
function 填会话标识(body: Record<string, unknown>, 目标: 目标): void {
    if (目标.scope === 'group') body.group_openid = 目标.group_openid;
    else body.openid = 目标.user_openid;
}

function 组装发送载荷(目标: 目标, fields: Record<string, unknown>, seq: number): Record<string, unknown> {
    const base: Record<string, unknown> = { ...fields };
    填会话标识(base, 目标);
    base.msg_id = 目标.msg_id;
    base.msg_seq = seq;
    return base;
}

/** 上传视频拿 file_info（file_type=2，url 方式让官方去拉） */
async function 上传视频(ctx: PluginContext, 目标: 目标, url: string): Promise<string> {
    const body: Record<string, unknown> = {
        file_type: 2,
        // 主动推送（srv_send_msg=true）官方自 2025-04-21 起已不再提供，必须 false
        srv_send_msg: false,
        url: String(url ?? '').trim(),
    };
    if (目标.scope === 'group') body.group_openid = 目标.group_openid;

    const path = 目标.scope === 'group'
        ? `/v2/groups/${目标.group_openid}/files`
        : `/v2/users/${目标.user_openid}/files`;

    const res = (await ctx.actions!.call(path, body)) as { file_info?: string } | null;
    const info = String(res?.file_info ?? '').trim();
    if (!info) throw new Error('富媒体上传未返回 file_info');
    return info;
}

async function 发一条(ctx: PluginContext, 目标: 目标, fields: Record<string, unknown>): Promise<void> {
    const path = 目标.scope === 'group'
        ? `/v2/groups/${目标.group_openid}/messages`
        : `/v2/users/${目标.user_openid}/messages`;
    const seq = nextSeq(目标.msg_id);
    await ctx.actions!.call(path, 组装发送载荷(目标, fields, seq));
}

/**
 * 组装 MD：标题 + 封面 + 信息文本 + 图集（多图直接堆在 MD 里）。
 * 有视频时末尾写「视频发送中」（照 GF_mk），随后单独发视频消息。
 *
 * 图片尺寸：官方 MD 必须显式给 `![alt#宽px #高px](url)`，写死 640x360 会把竖图拉成横屏，
 * 所以先探测原图宽高再**等比缩小**（只缩不放，见 image-size.ts）。
 * 探测失败才退回 640x360。
 */
export async function buildMd(r: ParseResult): Promise<string> {
    const 标题 = 转义Md(r.title) || '解析结果';
    const lines: string[] = [`## ${标题}`, ''];

    const 封面 = String(r.cover ?? '').trim();
    const 图集 = (Array.isArray(r.images) ? r.images : []).map((u) => String(u ?? '').trim()).filter((u) => /^https?:\/\//i.test(u));
    const 实况 = (Array.isArray(r.liveItems) ? r.liveItems : []).map((it) => String(it?.image ?? '').trim()).filter((u) => /^https?:\/\//i.test(u));

    // 并发探测，只拉图片头部，不下载整图
    const 全部图 = [封面, ...图集, ...实况].filter((u) => /^https?:\/\//i.test(u));
    const 探测结果 = await Promise.all(全部图.map((u) => probeImageSize(u)));
    const 尺寸表 = new Map<string, { w: number; h: number }>();
    全部图.forEach((u, i) => {
        const s = 探测结果[i];
        if (s) 尺寸表.set(u, s);
    });
    const 图行 = (url: string, alt: string): string => {
        const s = fitSize(尺寸表.get(url) ?? null);
        return md图片行(url, alt, s.w, s.h);
    };

    if (/^https?:\/\//i.test(封面)) {
        lines.push(图行(封面, '封面'), '');
    }

    // 信息文本（MKbot 同款：标题/作者/... 逐行）
    for (const line of buildInfoText(r).split('\n')) {
        if (!line.trim()) continue;
        lines.push(`> ${转义Md(line)}`);
    }
    lines.push('');

    // 图集：MD 支持多图，直接接着堆
    if (图集.length) {
        lines.push(`**图集 ${图集.length} 张**`, '');
        for (let i = 0; i < 图集.length; i++) {
            lines.push(图行(图集[i], `图${i + 1}`));
        }
        lines.push('');
    }

    // 实况图：MD 只能出静图，取 image 那一路
    if (实况.length) {
        lines.push(`**实况 ${实况.length} 张**`, '');
        for (let i = 0; i < 实况.length; i++) {
            lines.push(图行(实况[i], `实况${i + 1}`));
        }
        lines.push('');
    }

    const 视频 = String(r.videoUrl ?? '').trim();
    if (视频 && /^https?:\/\//i.test(视频)) {
        lines.push('---', '_视频发送中，请稍等…_');
    }

    return lines.join('\n');
}

/** 发 MD（失败回退纯文本） */
async function 发MD(ctx: PluginContext, 目标: 目标, md: string, 纯文本备用: string): Promise<void> {
    try {
        await 发一条(ctx, 目标, { msg_type: 2, markdown: { content: md } });
    } catch {
        // MD 没开通 / 被拒 → 回退纯文本
        await 发一条(ctx, 目标, { msg_type: 0, content: 纯文本备用.slice(0, 1500) });
    }
}

export async function sendOfficial(
    ctx: PluginContext,
    event: OfficialEvent,
    r: ParseResult,
): Promise<void> {
    const 目标 = 取目标(event);
    if (!目标 || !ctx?.actions?.call) return;

    const md = await buildMd(r);
    const 纯文本 = `${platformLabel(r)}｜${buildInfoText(r).replace(/\n/g, ' / ')}`;

    try {
        await 发MD(ctx, 目标, md, 纯文本);
    } catch (e) {
        ctx?.logger?.error?.(`[sssx-spjx] 官方侧 MD 发送失败：${e instanceof Error ? e.message : String(e)}`);
        return;
    }

    const 视频 = String(r.videoUrl ?? '').trim();
    if (!视频 || !/^https?:\/\//i.test(视频)) return;

    // 视频：上传 → msg_type=7 发送
    try {
        const fileInfo = await 上传视频(ctx, 目标, 视频);
        await 发一条(ctx, 目标, { msg_type: 7, media: { file_info: fileInfo } });
    } catch (e) {
        // 上传/发送失败：MD 里已经说了「视频发送中」，这里补一条说明 + 原链接，
        // 别让群里卡在「请稍等」却什么都没来。
        ctx?.logger?.warn?.(
            `[sssx-spjx] 官方侧视频发送失败，改发直链：${e instanceof Error ? e.message : String(e)}`,
        );
        try {
            await 发一条(ctx, 目标, {
                msg_type: 0,
                content: `视频上传失败，这是原链接：${视频}`.slice(0, 1500),
            });
        } catch {
            // 兜底也失败就认了
        }
    }
}
