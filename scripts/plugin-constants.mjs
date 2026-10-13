/**
 * 构建成品目录名。
 *
 * 框架对双生插件的硬规则：目录必须以 `sssx-plugin-` 开头才会被识别
 * （写成 sssx-spjx / SS-plugin-spjx 都不会加载）。
 * 所以源码项目目录叫 sssx-spjx，产物按规则改名。
 */
export const PLUGIN_DIR_NAME = 'sssx-plugin-spjx';
