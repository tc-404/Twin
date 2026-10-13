/**
 * 把 src/lib/api 下各解析模块单独打包到 <产物目录>/lib/api/*.mjs
 *
 * 单独打包的原因：运行时由 loader.ts 动态 import 这些 .mjs
 * （见 src/lib/api/loader.ts）。若被 vite 主构建内联进 index.mjs，
 * 运行时就找不到 lib/api 目录了。
 */
import { build } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import fs from 'fs';
import { PLUGIN_DIR_NAME } from './plugin-constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, PLUGIN_DIR_NAME, 'lib/api');

const nodeModules = [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
].flat();

/** 需要的四个平台（抖音 / 快手 / B站 / 小红书） */
const apiEntries = ['blbl', 'dy', 'ks', 'xhs'];

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

for (const name of apiEntries) {
    await build({
        configFile: false,
        resolve: { conditions: ['node', 'default'] },
        build: {
            sourcemap: false,
            target: 'esnext',
            minify: false,
            emptyOutDir: false,
            lib: {
                entry: resolve(root, `src/lib/api/${name}.ts`),
                formats: ['es'],
                fileName: () => `${name}.mjs`,
            },
            rollupOptions: {
                external: nodeModules,
                output: { inlineDynamicImports: true },
            },
            outDir,
        },
        plugins: [nodeResolve()],
    });
    console.log(`[sssx-spjx build-api] lib/api/${name}.mjs`);
}
