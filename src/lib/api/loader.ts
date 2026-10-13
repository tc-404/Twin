// ---------------------------------------------------------------------------
// 本地视频解析 API 加载器（运行时从 lib/api/*.mjs 动态导入）
//
// 照抄 `其他插件源码/GF_mk/src/lib/api/loader.ts` 的机制：
// 解析器由 scripts/build-api.mjs 单独打包成 .mjs，主构建不内联，
// 运行时按平台名动态 import 并缓存。
// ---------------------------------------------------------------------------

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type LocalApiName = 'blbl' | 'dy' | 'xhs' | 'ks';

const moduleCache = new Map<LocalApiName, { parse: (input: string) => Promise<unknown> }>();

/** 插件根目录（index.mjs 所在目录） */
function pluginDir(ctx: { pluginPath?: string }): string {
    const base = String(ctx?.pluginPath ?? '').trim();
    if (!base) throw new Error('sssx-spjx: 缺少 pluginPath，无法定位 lib/api');
    return base;
}

export async function callLocalVideoApi(
    ctx: { pluginPath?: string },
    apiName: LocalApiName,
    input: string,
): Promise<unknown> {
    let mod = moduleCache.get(apiName);
    if (!mod) {
        const modPath = path.join(pluginDir(ctx), 'lib', 'api', `${apiName}.mjs`);
        mod = (await import(pathToFileURL(modPath).href)) as {
            parse: (input: string) => Promise<unknown>;
        };
        moduleCache.set(apiName, mod);
    }
    return mod.parse(input);
}
