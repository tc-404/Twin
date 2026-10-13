// ---------------------------------------------------------------------------
// 触发判定
//
// 要求（来自需求）：
//   · 群聊：必须 @ 机器人 才触发；@ 的这条消息里含可解析链接就自动解析
//   · 私聊：不需要 @，直接匹配
//   · 匹配不上：不响应，也不打日志
// ---------------------------------------------------------------------------

import { protocolOf, type AnyEvent, type ObMessageEvent, type OfficialEvent, type PluginContext } from '../types.js';
import { detectPlatform } from './parse.js';

export interface TriggerInfo {
    /** 满足触发条件（群聊已 @ / 私聊） */
    ok: boolean;
    /** 是否是群聊 */
    isGroup: boolean;
    /** 清洗后的纯文本（已剥 @ 标记） */
    text: string;
}

const NO: TriggerInfo = { ok: false, isGroup: false, text: '' };

/** OneBot：消息段里取纯文本（跳过 at 段，天然不含 @） */
function obText(event: ObMessageEvent): string {
    const segs = Array.isArray(event.message) ? event.message : [];
    if (segs.length) {
        return segs
            .filter((s) => s && s.type === 'text')
            .map((s) => String((s.data as Record<string, unknown>)?.text ?? ''))
            .join('')
            .trim();
    }
    const raw = typeof event.raw_message === 'string' ? event.raw_message : '';
    // 兜底：raw_message 里 @ 是 CQ 码形态
    return raw.replace(/\[CQ:at[^\]]*\]/g, '').trim();
}

/** OneBot：是否被 @ 了自己 */
function obAtMe(event: ObMessageEvent): boolean {
    const selfId = event.self_id;
    if (selfId == null) return false; // 拿不到自己也就不敢认，宁可不响应
    const segs = Array.isArray(event.message) ? event.message : [];
    return segs.some((s) => s && s.type === 'at' && String((s.data as Record<string, unknown>)?.qq ?? '') === String(selfId));
}

/**
 * 官方：content 里的 @ 标记要**全局剥**。
 * 实测（kakake/log/2026-10-13.log）：平台给的是旧格式 `<@32位openid>`，
 * 位置不固定——多数在句首（有时带前导空格），也会出现在**句尾**。
 * 只剥开头会漏掉句尾那种，链接就匹配不上了。
 */
function officialText(content: string): string {
    return String(content ?? '')
        .replace(/<@[^>]*>/g, '')
        .replace(/<qqbot-at-user[^>]*>/gi, '')
        .replace(/^(?:@\S+\s*)+/, '')
        .trim();
}

/**
 * 官方群聊：这条是不是 @ 了机器人。
 *
 * 不能只看事件名。实测（kakake/log/2026-10-13.log）这个机器人收到的群事件
 * **全是 GROUP_MESSAGE_CREATE**（37 条），一条 GROUP_AT_MESSAGE_CREATE 都没有——
 * 只认 GROUP_AT_MESSAGE_CREATE 会导致群聊永远不触发。
 *
 * 真正的依据在事件自带的 `mentions` 数组里，平台直接标了 is_you / bot：
 *   L29 被@：mentions=[{ bot:true, is_you:true, id:"4D8F…", username:"楯羲" }]
 *   L28 没@：整个事件里没有 mentions 字段
 * 这跟项目里在跑的 GF-plugin-mkai 一致（index.mjs:15188）。
 */
function officialAtBot(event: OfficialEvent): boolean {
    const t = String(event?.t ?? '');
    if (t === 'GROUP_AT_MESSAGE_CREATE') return true;
    const list = Array.isArray(event?.mentions) ? event.mentions : [];
    return list.some((m) => m && (m.is_you === true || m.bot === true));
}

export function checkTrigger(ctx: PluginContext, event: AnyEvent): TriggerInfo {
    if (!event) return NO;

    if (protocolOf(ctx, event) === 'qq_official') {
        const e = event as OfficialEvent;
        const t = String(e.t ?? '');

        // 单聊：直接匹配，不需要 @
        if (t === 'C2C_MESSAGE_CREATE') {
            const text = officialText(String(e.content ?? ''));
            return { ok: Boolean(text), isGroup: false, text };
        }

        // 群聊：两种群事件都认，但必须 @ 了机器人才触发
        if (t === 'GROUP_AT_MESSAGE_CREATE' || t === 'GROUP_MESSAGE_CREATE') {
            if (!officialAtBot(e)) return NO;
            const text = officialText(String(e.content ?? ''));
            return { ok: Boolean(text), isGroup: true, text };
        }

        return NO;
    }

    const e = event as ObMessageEvent;
    if (e.post_type !== 'message') return NO;

    if (e.message_type === 'private') {
        const text = obText(e);
        return { ok: Boolean(text), isGroup: false, text };
    }

    if (e.message_type === 'group') {
        if (!obAtMe(e)) return NO;
        const text = obText(e);
        return { ok: Boolean(text), isGroup: true, text };
    }

    return NO;
}

/** 文本里是否含四平台链接（不含就不响应、不打日志） */
export function hasLink(text: string): boolean {
    return detectPlatform(text) !== null;
}
