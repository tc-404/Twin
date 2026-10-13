// ---------------------------------------------------------------------------
// OneBot / NapCat（野生）侧：照抄 MKbot 视频解析的输出规则
//
// MKbot 依据（src/mkbot-core.ts 视频解析统一输出 18671-18869）：
//   ① 单视频（有 videoUrl、无图集、无实况）→ 只发视频本身，简介/封面一律不带。
//      理由写在 18691：合并转发是「全有或全无」，多带一个资源就多一个失败点。
//   ② 有图集 / 实况 → 合并转发：首节点 = 信息文本 + 封面，其后各图一节点；
//      主视频**不进**合并转发，单独发；视频上传失败再补一条原链接。
// ---------------------------------------------------------------------------

import type { ObMessageEvent, PluginContext } from '../types.js';
import { buildInfoText, platformLabel } from './format.js';
import type { ParseResult } from './parse.js';

type Seg = { type: string; data: Record<string, unknown> };

function 文本段(text: string): Seg {
    return { type: 'text', data: { text: String(text ?? '') } };
}
function 图片段(url: string): Seg {
    return { type: 'image', data: { file: String(url) } };
}
function 视频段(url: string): Seg {
    return { type: 'video', data: { file: String(url) } };
}

function 是链接(u: unknown): boolean {
    return /^https?:\/\//i.test(String(u ?? '').trim());
}

/** 合并转发节点 */
function 节点(name: string, uin: unknown, content: Seg[]): Seg {
    return {
        type: 'node',
        data: {
            name: String(name ?? '解析'),
            uin: String(uin ?? '').trim(),
            content: content.length ? content : [文本段('')],
        },
    };
}

async function 发消息(ctx: PluginContext, event: ObMessageEvent, segs: Seg[]): Promise<boolean> {
    if (!ctx?.actions?.call || !segs.length) return false;
    if (event.group_id) {
        await ctx.actions.call('send_group_msg', { group_id: event.group_id, message: segs });
        return true;
    }
    await ctx.actions.call('send_private_msg', { user_id: event.user_id, message: segs });
    return true;
}

async function 合并转发(ctx: PluginContext, event: ObMessageEvent, nodes: Seg[]): Promise<boolean> {
    if (!ctx?.actions?.call || !nodes.length) return false;
    if (event.group_id) {
        await ctx.actions.call('send_group_forward_msg', { group_id: event.group_id, messages: nodes });
        return true;
    }
    await ctx.actions.call('send_private_forward_msg', { user_id: event.user_id, messages: nodes });
    return true;
}

export async function sendOneBot(
    ctx: PluginContext,
    event: ObMessageEvent,
    r: ParseResult,
): Promise<void> {
    const 视频 = String(r.videoUrl ?? '').trim();
    const 图集 = (Array.isArray(r.images) ? r.images : []).filter(是链接);
    const 实况 = (Array.isArray(r.liveItems) ? r.liveItems : [])
        .map((it) => String(it?.image ?? '').trim())
        .filter(是链接);
    const 封面 = String(r.cover ?? '').trim();
    const 信息 = buildInfoText(r).trim();
    const 名字 = platformLabel(r);

    // ① 单视频：只发视频
    if (视频 && 是链接(视频) && !图集.length && !实况.length) {
        try {
            await 发消息(ctx, event, [视频段(视频)]);
            return;
        } catch {
            // 视频没发出去 → 退原链接，保证不是一条都没有（照 MKbot 18711）
            try {
                await 发消息(ctx, event, [文本段(视频)]);
            } catch (e) {
                ctx?.logger?.error?.(`[sssx-spjx] 视频发送失败：${e instanceof Error ? e.message : String(e)}`);
            }
            return;
        }
    }

    // ② 有图集 / 实况：合并转发（视频单独发，不进合并转发）
    const nodes: Seg[] = [];

    // 首节点：信息文本 + 封面（照 MKbot 18823-18829）
    if (信息 || (封面 && 是链接(封面))) {
        const content: Seg[] = [];
        if (信息) content.push(文本段(信息));
        if (封面 && 是链接(封面)) content.push(图片段(封面));
        nodes.push(节点(名字, event.self_id, content));
    }

    for (let i = 0; i < 图集.length; i++) {
        nodes.push(节点(名字, event.self_id, [文本段(`[${i + 1}/${图集.length}]`), 图片段(String(图集[i]))]));
    }
    for (let i = 0; i < 实况.length; i++) {
        nodes.push(节点(名字, event.self_id, [文本段(`[实况 ${i + 1}/${实况.length}]`), 图片段(实况[i])]));
    }

    let 合并已发 = false;
    if (nodes.length) {
        try {
            合并已发 = await 合并转发(ctx, event, nodes);
        } catch {
            合并已发 = false;
        }
        // 合并转发整体失败（协议端常见）→ 逐条发，别一条都收不到
        if (!合并已发) {
            try {
                if (信息) await 发消息(ctx, event, [文本段(信息)]);
                if (封面 && 是链接(封面)) await 发消息(ctx, event, [图片段(封面)]);
                for (const u of 图集) await 发消息(ctx, event, [图片段(String(u))]);
                for (const u of 实况) await 发消息(ctx, event, [图片段(u)]);
                合并已发 = true;
            } catch {
                合并已发 = false;
            }
        }
    }

    // 主视频单独发
    if (视频 && 是链接(视频)) {
        try {
            await 发消息(ctx, event, [视频段(视频)]);
        } catch {
            try {
                await 发消息(ctx, event, [文本段(`[视频上传失败] 原链接：${视频}`)]);
            } catch {
                // 兜底也失败就认了
            }
        }
        return;
    }

    // 既没视频也没图：至少把信息文本发出去
    if (!合并已发 && 信息) {
        try {
            await 发消息(ctx, event, [文本段(信息)]);
        } catch (e) {
            ctx?.logger?.error?.(`[sssx-spjx] OneBot 侧发送失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }
}
