// ---------------------------------------------------------------------------
// 双生插件公共类型
//
// 框架侧字段照 `kakake/使用教程/插件开发/SS-双生插件/说明.md` §四：
//   ctx.frameworkEnv.protocol  → 'onebot' | 'qq_official'
//   ctx.actions.call(action, params) → 出站动作，按连接类型自动分流
//   ctx.dataPath / ctx.pluginPath / ctx.logger
// ---------------------------------------------------------------------------

export type Protocol = 'onebot' | 'qq_official';

export interface PluginLogger {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
}

export interface FrameworkEnv {
    protocol?: Protocol;
    ob11Mode?: string;
    connectionId?: string;
    frameworkId?: string;
    frameworkVersion?: string;
}

export interface PluginContext {
    pluginName?: string;
    /** 运行副本目录（勿写数据） */
    pluginPath?: string;
    /** 数据目录：data/<账号键>/<插件名> */
    dataPath?: string;
    configPath?: string;
    connectionId?: string;
    frameworkEnv?: FrameworkEnv;
    logger?: PluginLogger;
    actions?: {
        call: (action: string, params?: unknown) => Promise<unknown>;
    };
    [key: string]: unknown;
}

/** OneBot 消息段 */
export interface ObSegment {
    type: string;
    data?: Record<string, unknown>;
}

/** OneBot 消息事件（只列本插件用到的字段） */
export interface ObMessageEvent {
    post_type?: string;
    message_type?: 'group' | 'private' | string;
    message_id?: number | string;
    user_id?: number;
    group_id?: number;
    self_id?: number;
    raw_message?: string;
    message?: ObSegment[] | string;
    sender?: Record<string, unknown>;
    onebot?: boolean;
}

/** 官方事件的 @ 提及项 */
export interface OfficialMention {
    id?: string;
    member_openid?: string;
    user_openid?: string;
    /** @ 的是「本机器人」 */
    is_you?: boolean;
    /** @ 的是机器人 */
    bot?: boolean;
    scope?: string;
    username?: string;
}

/** QQ 官方事件（只列本插件用到的字段） */
export interface OfficialEvent {
    t?: string;
    id?: string;
    content?: string;
    group_openid?: string;
    /** 被 @ 的人；平台在这项里直接标了 is_you / bot，见 trigger.ts 的 @ 判定 */
    mentions?: OfficialMention[];
    author?: {
        member_openid?: string;
        user_openid?: string;
        username?: string;
        member_role?: string;
        bot?: boolean;
        id?: string;
    };
    timestamp?: string;
    qq_official?: boolean;
}

export type AnyEvent = (ObMessageEvent & OfficialEvent) | Record<string, unknown>;

/** 判断协议：优先 frameworkEnv，退回事件标记键 */
export function protocolOf(ctx: PluginContext, event?: AnyEvent): Protocol {
    const p = ctx?.frameworkEnv?.protocol;
    if (p === 'onebot' || p === 'qq_official') return p;
    const e = (event ?? {}) as OfficialEvent;
    return e.qq_official ? 'qq_official' : 'onebot';
}
