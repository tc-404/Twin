import { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import nodeResolve from '@rollup/plugin-node-resolve';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { PLUGIN_DIR_NAME } from './scripts/plugin-constants.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 构建成品输出到源码目录内的 sssx-plugin-spjx/ */
const OUT_DIR = resolve(__dirname, PLUGIN_DIR_NAME);

const nodeModules = [
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
].flat();

function copyPluginAssets() {
    return {
        name: 'copy-sssx-plugin-assets',
        writeBundle() {
            const pluginJson = resolve(__dirname, 'plugin.json');
            if (fs.existsSync(pluginJson)) {
                fs.copyFileSync(pluginJson, resolve(OUT_DIR, 'plugin.json'));
                console.log(`[sssx-spjx] plugin.json → ${OUT_DIR}`);
            }
            const pkgPath = resolve(__dirname, 'package.json');
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                const distPkg: Record<string, unknown> = {
                    name: pkg.name,
                    plugin: pkg.plugin,
                    version: pkg.version,
                    type: pkg.type,
                    main: pkg.main,
                    description: pkg.description,
                    author: pkg.author,
                };
                fs.writeFileSync(resolve(OUT_DIR, 'package.json'), `${JSON.stringify(distPkg, null, 2)}\n`);
            }
        },
    };
}

export default defineConfig({
    resolve: {
        conditions: ['node', 'default'],
    },
    build: {
        sourcemap: false,
        target: 'esnext',
        minify: false,
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            formats: ['es'],
            fileName: () => 'index.mjs',
        },
        rollupOptions: {
            // lib/api/*.mjs 由 scripts/build-api.mjs 单独产出，运行时动态 import
            external: [...nodeModules],
            output: {
                inlineDynamicImports: true,
            },
        },
        outDir: OUT_DIR,
        emptyOutDir: true,
    },
    plugins: [nodeResolve(), copyPluginAssets()],
});
