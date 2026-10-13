// 临时自测：用构建产物 + mock ctx 验证触发规则，测完删除
import { fileURLToPath } from 'node:url';
import { plugin_onmessage } from '../sssx-plugin-spjx/index.mjs';

// 注意：必须用 fileURLToPath，用 URL.pathname 会把中文路径编成 %E7%AD%B1...
const PLUGIN_DIR = fileURLToPath(new URL('../sssx-plugin-spjx/', import.meta.url)).replace(/[\\/]$/, '');

let fail = 0;
function eq(name, got, want) {
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} → got=${got} want=${want}`);
}

function makeCtx(protocol) {
    const calls = [];
    const logs = [];
    const ctx = {
        frameworkEnv: { protocol },
        pluginPath: PLUGIN_DIR,
        dataPath: PLUGIN_DIR,
        logger: {
            info: () => {},
            warn: () => {},
            error: (...a) => logs.push(a.join(' ')),
        },
        actions: { call: async (a, p) => { calls.push([a, p]); return {}; } },
    };
    return { ctx, calls, logs };
}

const BV = 'https://www.bilibili.com/video/BV1xx411c7mD';
const DY = 'https://v.douyin.com/iRNBhoYr/';

// ---- 官方侧 ----
console.log('--- 官方机器人 ---');
{
    const { ctx, calls, logs } = makeCtx('qq_official');
    await plugin_onmessage(ctx, { t: 'GROUP_AT_MESSAGE_CREATE', id: 'M1', content: `<@BOTID> 你好呀`, group_openid: 'G1', author: { member_openid: 'U1' }, qq_official: true });
    eq('@了但没链接 → 不发送', calls.length, 0);
    eq('@了但没链接 → 不打日志', logs.length, 0);
}
{
    const { ctx, calls } = makeCtx('qq_official');
    // 普通群消息（没 @）：不该触发
    await plugin_onmessage(ctx, { t: 'GROUP_MESSAGE_CREATE', id: 'M2', content: BV, group_openid: 'G1', author: { member_openid: 'U1' }, qq_official: true });
    eq('群聊没@（GROUP_MESSAGE_CREATE）→ 不发送', calls.length, 0);
}
{
    const { ctx, calls, logs } = makeCtx('qq_official');
    await plugin_onmessage(ctx, { t: 'C2C_MESSAGE_CREATE', id: 'M3', content: '今天天气怎么样', author: { user_openid: 'U2' }, qq_official: true });
    eq('私聊没链接 → 不发送', calls.length, 0);
    eq('私聊没链接 → 不打日志', logs.length, 0);
}
{
    // @ 在**句尾**的实测形态：必须仍能识别链接
    const { ctx, calls, logs } = makeCtx('qq_official');
    await plugin_onmessage(ctx, { t: 'GROUP_AT_MESSAGE_CREATE', id: 'M4', content: `帮我看看这个${BV}<@BOTID> `, group_openid: 'G1', author: { member_openid: 'U1' }, qq_official: true });
    // 进入解析阶段的证据：要么发出去了（calls>0），要么解析失败记了 error（logs>0）。
    // 若两个都是 0，说明链接压根没被识别 —— 那就是句尾 @ 没剥干净。
    console.log(`      （句尾@：calls=${calls.length} logs=${logs.length} → ${logs[0] ?? ''}）`);
    eq('句尾@ + 链接 → 链接确实被识别（进入解析）', calls.length > 0 || logs.length > 0, true);
}

// ---- OneBot 侧 ----
console.log('--- OneBot / 野生 ---');
{
    const { ctx, calls, logs } = makeCtx('onebot');
    await plugin_onmessage(ctx, { post_type: 'message', message_type: 'group', self_id: 123, group_id: 888, user_id: 10001, message: [{ type: 'at', data: { qq: '123' } }, { type: 'text', data: { text: ' 你好' } }], onebot: true });
    eq('群聊@我但没链接 → 不发送', calls.length, 0);
    eq('群聊@我但没链接 → 不打日志', logs.length, 0);
}
{
    const { ctx, calls } = makeCtx('onebot');
    // @ 的是别人，不是机器人
    await plugin_onmessage(ctx, { post_type: 'message', message_type: 'group', self_id: 123, group_id: 888, user_id: 10001, message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: ` ${DY}` } }], onebot: true });
    eq('群聊@别人（不是机器人）→ 不发送', calls.length, 0);
}
{
    const { ctx, calls } = makeCtx('onebot');
    // 完全没 @
    await plugin_onmessage(ctx, { post_type: 'message', message_type: 'group', self_id: 123, group_id: 888, user_id: 10001, message: [{ type: 'text', data: { text: DY } }], onebot: true });
    eq('群聊没@任何人 → 不发送', calls.length, 0);
}
{
    const { ctx, calls, logs } = makeCtx('onebot');
    await plugin_onmessage(ctx, { post_type: 'message', message_type: 'private', self_id: 123, user_id: 10001, message: [{ type: 'text', data: { text: '在吗' } }], onebot: true });
    eq('私聊没链接 → 不发送', calls.length, 0);
    eq('私聊没链接 → 不打日志', logs.length, 0);
}

// ---- 官方群聊 @ 判定（真机事件类型是 GROUP_MESSAGE_CREATE）----
console.log('--- 官方机器人：群聊 @ 判定 ---');

async function 跑群聊(mentions) {
    const calls = [];
    const logs = [];
    const ctx = {
        frameworkEnv: { protocol: 'qq_official' },
        pluginPath: PLUGIN_DIR,
        logger: { info: () => {}, warn: () => {}, error: (...a) => logs.push(a.join(' ')) },
        actions: {
            call: async (a, p) => {
                calls.push([a, p]);
                if (String(a).endsWith('/files')) return { file_info: 'FAKE' };
                return {};
            },
        },
    };
    const ev = {
        t: 'GROUP_MESSAGE_CREATE', id: 'MSG-G1',
        content: `<@BOT> ${BV}`, group_openid: 'G1',
        author: { member_openid: 'U1' }, qq_official: true,
    };
    if (mentions) ev.mentions = mentions;
    await plugin_onmessage(ctx, ev);
    return { calls, logs };
}

{
    // 真机形态：被 @ 时事件带 mentions，且 is_you / bot = true
    const { calls, logs } = await 跑群聊([{ bot: true, is_you: true, id: 'BOT', member_openid: 'BOT' }]);
    eq('GROUP_MESSAGE_CREATE + @机器人 → 触发', calls.length > 0 || logs.length > 0, true);
}
{
    // 没被 @：事件里没有 mentions 字段
    const { calls, logs } = await 跑群聊(null);
    eq('GROUP_MESSAGE_CREATE 但没 @ → 不发送', calls.length, 0);
    eq('GROUP_MESSAGE_CREATE 但没 @ → 不打日志', logs.length, 0);
}
{
    // @ 的是别人，不是机器人
    const { calls } = await 跑群聊([{ bot: false, is_you: false, id: 'OTHER', member_openid: 'OTHER' }]);
    eq('GROUP_MESSAGE_CREATE 但 @ 的是别人 → 不发送', calls.length, 0);
}

// ---- 官方侧：视频发送（msg_type=7）----
console.log('--- 官方机器人：视频发送 ---');

async function 跑官方视频(上传返回) {
    const calls = [];
    const ctx = {
        frameworkEnv: { protocol: 'qq_official' },
        pluginPath: PLUGIN_DIR,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        actions: {
            call: async (a, p) => {
                calls.push([a, p]);
                if (String(a).endsWith('/files')) return 上传返回;
                return {};
            },
        },
    };
    await plugin_onmessage(ctx, {
        t: 'GROUP_AT_MESSAGE_CREATE', id: 'MSG-V1',
        content: `<@BOT> ${BV}`, group_openid: 'G1',
        author: { member_openid: 'U1' }, qq_official: true,
    });
    return calls;
}

{
    const calls = await 跑官方视频({ file_info: 'FAKE_FILE_INFO' });
    const msgs = calls.filter(([a]) => String(a).endsWith('/messages'));
    const ups = calls.filter(([a]) => String(a).endsWith('/files'));
    eq('上传调用 1 次', ups.length, 1);
    if (ups.length) {
        eq('上传路径（群 files）', ups[0][0], '/v2/groups/G1/files');
        eq('file_type=2（视频）', ups[0][1].file_type, 2);
        eq('srv_send_msg=false', ups[0][1].srv_send_msg, false);
    }
    eq('共发 2 条（MD + 视频）', msgs.length, 2);
    if (msgs.length >= 2) {
        eq('第 1 条是 MD', msgs[0][1].msg_type, 2);
        eq('第 2 条是视频 msg_type=7', msgs[1][1].msg_type, 7);
        eq('视频带 file_info', msgs[1][1].media?.file_info, 'FAKE_FILE_INFO');
        eq('msg_seq 递增 1→2', `${msgs[0][1].msg_seq}-${msgs[1][1].msg_seq}`, '1-2');
        eq('MD 末尾提示视频发送中', /视频发送中/.test(String(msgs[0][1].markdown?.content ?? '')), true);
    }
}
{
    // 上传失败（没返回 file_info）→ 不能卡在「请稍等」，要补发原链接
    const calls = await 跑官方视频({});
    const msgs = calls.filter(([a]) => String(a).endsWith('/messages'));
    eq('上传失败仍补发 1 条', msgs.length, 2);
    if (msgs.length >= 2) {
        eq('补发的是文本', msgs[1][1].msg_type, 0);
        eq('补发内容带原链接', /https?:\/\//.test(String(msgs[1][1].content ?? '')), true);
    }
}

console.log(fail === 0 ? '\n全部通过' : `\n失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
