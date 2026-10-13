// ---------------------------------------------------------------------------
// sssx-spjx · 双生插件（OneBot / NapCat + QQ 官方机器人）
//
// 行为约定：
//   · 群聊：必须 @ 机器人 才触发；@ 的这条消息里含可解析链接就自动解析
//   · 私聊：不需要 @，直接匹配
//   · 匹配不上：不响应，也不打日志
//
// 输出：
//   · 官方侧 → Markdown 消息（文本 + 多图，MD 特性）
//   · OneBot 侧 → 照抄 MKbot 视频解析的输出规则
//
// 支持：抖音 / 快手 / B站 / 小红书
// ---------------------------------------------------------------------------

import { protocolOf, type AnyEvent, type ObMessageEvent, type OfficialEvent, type PluginContext } from './types.js';
import { checkTrigger, hasLink } from './lib/trigger.js';
import { parse, PLATFORM_LABEL } from './lib/parse.js';
import { sendOfficial } from './lib/send-official.js';
import { sendOneBot } from './lib/send-onebot.js';

async function plugin_init(ctx: PluginContext): Promise<void> {
    ctx?.logger?.info?.(
        `[sssx-spjx] 已加载：协议=${ctx?.frameworkEnv?.protocol ?? '未知'} · 数据目录=${ctx?.dataPath ?? '-'}`,
    );
}

async function plugin_onmessage(ctx: PluginContext, event: AnyEvent): Promise<void> {
    const trigger = checkTrigger(ctx, event);
    // 群聊没 @ / 私聊空消息 → 不响应
    if (!trigger.ok) return;
    // 没有可解析的链接 → 不响应，也不打日志（需求明确要求）
    if (!hasLink(trigger.text)) return;

    const r = await parse(ctx, trigger.text);
    if (!r.ok || !r.platform) {
        // 链接认出来了但解析失败，属于真故障，记一条便于排查；不打扰群里
        ctx?.logger?.error?.(`[sssx-spjx] 解析失败：${r.message ?? '未知错误'}`);
        return;
    }

    try {
        if (protocolOf(ctx, event) === 'qq_official') {
            await sendOfficial(ctx, event as OfficialEvent, r);
        } else {
            await sendOneBot(ctx, event as ObMessageEvent, r);
        }
    } catch (e) {
        ctx?.logger?.error?.(
            `[sssx-spjx] ${PLATFORM_LABEL[r.platform]} 发送失败：${e instanceof Error ? e.message : String(e)}`,
        );
    }
}

export { plugin_init, plugin_onmessage };
