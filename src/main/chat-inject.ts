/**
 * ChatGPT 页面请求层注入（项目路径上下文）
 *
 * 从 freehub plugins/chatgpt/src/fetch-hook.ts 精简复制：
 * 只保留「每个新会话首次请求注入项目路径」这一能力
 * （不注入工具清单、不拦截响应流、不做工具调用闭环）。
 *
 * 原理（与 freehub 一致）：
 * - 主进程在页面加载完成后通过 executeJavaScript 注入本 hook
 *   （ChatGPT 页面 JS 会覆盖 window.fetch，必须在页面加载完成后注入）
 * - hook 拦截 POST 到 backend-api 的 conversation 请求，在 body.messages 最前
 *   追加一条 system 消息（项目路径上下文块），session-first：每个会话只注入一次
 * - 项目路径由主进程写入 window.__freehubProjectContext（buildProjectContext
 *   构建的完整文本块），项目切换时同步更新
 */

import { existsSync, readFileSync } from 'fs'
import path from 'node:path'
import type { InjectionSettings } from './config'

/** 项目路径上下文特征标记（与 freehub 一致） */
export const PROJECT_CONTEXT_MARKER = '[当前项目路径]'

/** 构造注入到请求的项目根目录上下文文本（让模型知道相对路径的解析基准） */
export function buildProjectContext(root: string | null | undefined): string {
  if (!root) return ''
  return [
    PROJECT_CONTEXT_MARKER,
    root,
    '',
    '你执行文件操作工具（read/write/ls/grep/glob 等）时，所有相对路径均相对于以上项目根目录解析；必要时可基于该路径构造绝对路径。',
    '[当前项目路径结束]',
  ].join('\n')
}

/** 注入的 skills 条目（名称 + 描述 + 作用域） */
export type InjectionSkill = {
  name: string
  description: string
  scope: 'user' | 'project'
}

/** 读取项目根目录下的规则文件（AGENTS.md / CLAUDE.md；不存在返回 null） */
function readProjectRule(root: string, filename: string): string | null {
  try {
    const p = path.join(root, filename)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  } catch {
    return null
  }
}

/**
 * 构建每个新会话注入的完整上下文块（session-first，按开关组合段落）：
 * 项目路径 / 指定插件 / AGENTS.md / CLAUDE.md / 可用技能。
 * AGENTS.md、CLAUDE.md 项目里不存在时即使开启也不注入。
 * 插件激活由 fetch 层自动 @提及注入（autoSelectPlugin）完成，不再注入文字段。
 */
export function buildInjectionContext(
  root: string | null | undefined,
  injections: InjectionSettings,
  skills: InjectionSkill[],
): string {
  const parts: string[] = []
  const projectRoot = root || ''

  // 1) 项目路径
  if (injections.projectPath) {
    const ctx = buildProjectContext(projectRoot)
    if (ctx) parts.push(ctx)
  }

  // 2) AGENTS.md（默认开；文件不存在则不注入）
  if (injections.agentsMd && projectRoot) {
    const md = readProjectRule(projectRoot, 'AGENTS.md')
    if (md && md.trim()) {
      parts.push(['[项目规则 AGENTS.md]', md.trimEnd(), '[AGENTS.md 结束]'].join('\n'))
    }
  }

  // 3) CLAUDE.md（默认关；文件不存在则不注入）
  if (injections.claudeMd && projectRoot) {
    const md = readProjectRule(projectRoot, 'CLAUDE.md')
    if (md && md.trim()) {
      parts.push(['[项目规则 CLAUDE.md]', md.trimEnd(), '[CLAUDE.md 结束]'].join('\n'))
    }
  }

  // 4) 可用技能：标题 + 描述（按开关过滤；未配置默认开）
  const enabledSkills = skills.filter((s) => injections.skills[s.name] !== false)
  if (enabledSkills.length) {
    const lines = enabledSkills.map((s) => {
      const desc = s.description ? `：${s.description.slice(0, 300)}` : ''
      const scopeLabel = s.scope === 'project' ? '（项目级）' : '（用户级）'
      return `- ${s.name}${scopeLabel}${desc}`
    })
    parts.push(['[可用技能]', ...lines, '[可用技能结束]'].join('\n'))
  }

  return parts.join('\n\n')
}

/**
 * 页内 fetch hook 脚本（纯 JS，注入主 world）。
 *
 * 安装健壮性（与 freehub 一致）：整体 try/catch，失败时恢复原始 fetch
 * 并清理标记，主进程可重试注入。
 *
 * 诊断：window.__freehubProjectStats 实时统计（matched/injected/skipped/errors），
 * 有变化时（节流 2s）postMessage 上报主进程；页面 console 可调
 * window.__freehubTestAugment(init) 手动测试注入逻辑。
 */
export const CHAT_FETCH_HOOK_SCRIPT = `
(function () {
  if (window.__freehubProjectHookInstalled) return { ok: true, installed: true };

  var origFetch = window.fetch;
  var urlTimer = null;
  var lastReportAt = 0;

  function cleanup() {
    try {
      if (urlTimer) { clearInterval(urlTimer); urlTimer = null; }
      if (window.fetch && window.fetch.__freehubProjectHook === true) window.fetch = origFetch;
    } catch (e) { /* ignore */ }
    delete window.__freehubProjectHookInstalled;
    delete window.__freehubProjectHook;
    delete window.__freehubInjectedConvs;
    delete window.__freehubCurrentConversationId;
    delete window.__freehubProjectStats;
  }

  try {
    install();
    try { Object.defineProperty(window.fetch, '__freehubProjectHook', { value: true, configurable: true }); }
    catch (e) { window.fetch.__freehubProjectHook = true; }
    window.__freehubProjectHookInstalled = true;
    report();
  } catch (e) {
    cleanup();
    throw e;
  }

  return { ok: true, installed: true };

  /** 节流上报统计到主进程（供终端日志诊断） */
  function report() {
    var now = Date.now();
    if (now - lastReportAt < 2000) return;
    lastReportAt = now;
    try {
      window.postMessage({
        type: 'freecodex:inject',
        stats: window.__freehubProjectStats,
        installed: !!window.__freehubProjectHookInstalled,
        context: (window.__freehubProjectContext || '').slice(0, 100),
      }, '*');
    } catch (e) { /* ignore */ }
  }

  function install() {
    window.__freehubInjectedConvs = {};
    window.__freehubProjectStats = { matched: 0, injected: 0, skippedSession: 0, skippedNoContext: 0, skippedNoBody: 0, errors: 0, lastError: null };

    var MARKER = '[当前项目路径]';

    /** 是否为对话生成请求（POST 到 backend-api 的 conversation 端点） */
    function isChatCompletion(url) {
      try {
        var u = new URL(url, location.href);
        if (u.origin !== 'https://chatgpt.com' && u.origin !== 'https://chat.openai.com') return false;
        var p = u.pathname.replace(/\\/+$/, '');
        if (p.indexOf('/backend-api/') !== 0) return false;
        var segs = p.split('/');
        return segs[segs.length - 1] === 'conversation';
      } catch (e) { return false; }
    }

    /** 从请求体探测会话 ID */
    function detectConversationId(body) {
      if (body && typeof body.conversation_id === 'string' && body.conversation_id) return body.conversation_id;
      return null;
    }

    /** 是否首页（新会话）URL */
    function isHomeUrl() {
      var path = location.pathname.replace(/\\/+$/, '');
      return path === '' || path === '/';
    }

    /** 当前会话标识：/c/{id} URL 优先，首页依赖请求体会话 ID */
    function currentConversationKey() {
      var m = location.pathname.match(/^\\/c\\/([^/]+)/);
      if (m && m[1]) return m[1];
      var sid = window.__freehubCurrentConversationId;
      return sid || 'default';
    }

    /** 注入消息的 id 必须是 UUID，否则后端拒绝 */
    function genUuid() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    /**
     * 注入项目路径到请求体（session-first：每个会话首个请求注入一次）：
     * 追加为 messages 首位的 system 消息（/f/ 端要求最后一条必须是用户新消息，
     * 追加在尾部会报错；system 角色不污染用户可见消息、不与客户端渲染冲突）。
     * 返回 { body } 表示已注入；{ skip: 原因 } 表示未注入（原因用于诊断统计）。
     */
    function augmentRequestBody(init) {
      var bodyStr = init && typeof init.body === 'string' ? init.body : '';
      if (!bodyStr) return { skip: 'no-body' };
      try {
        var body = JSON.parse(bodyStr);
        if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length === 0) return { skip: 'no-messages' };

        var cid = detectConversationId(body);
        if (cid) {
          window.__freehubCurrentConversationId = cid;
          // 新会话首条请求以 'default' 占位注入，真实 conversation_id 出现时
          // 把注入标记移交给真实 id 并清除占位（否则续聊会重复注入、
          // 下一个首页新会话会被跳过）
          if (window.__freehubInjectedConvs['default']) {
            window.__freehubInjectedConvs[cid] = true;
            delete window.__freehubInjectedConvs['default'];
          }
        } else if (isHomeUrl()) {
          // 首页新会话请求（无 conversation_id）：清除残留会话 ID，
          // 避免沿用旧会话 key 而跳过注入（不等定时器，立即兜底）
          window.__freehubCurrentConversationId = null;
        }

        var convKey = currentConversationKey();
        if (window.__freehubInjectedConvs[convKey]) return { skip: 'session-injected' };

        var projectText = window.__freehubProjectContext || '';
        if (!projectText) return { skip: 'no-context' };

        // 会话历史里已有注入块（会话 key 变化后防重复注入）
        var messages = body.messages;
        for (var i = 0; i < messages.length; i++) {
          var mm = messages[i];
          if (!mm || !mm.author || mm.author.role !== 'system') continue;
          var mmText = mm.content ? (typeof mm.content.text === 'string' ? mm.content.text
            : (Array.isArray(mm.content.parts) ? mm.content.parts.join('') : '')) : '';
          if (mmText.indexOf(MARKER) !== -1) return { skip: 'already-in-history' };
        }

        // 插件提及注入（自动激活插件）：在最后一条 user 消息前置 @<插件名>，
        // 加 system_hints: ["plugin:<appId>"] + ecosystemMention 偏移标记，
        // 与 ChatGPT 手动输入 @mycodex 的效果一致（服务端据此把插件工具挂给模型）。
        // 开关与插件信息由主进程写入 window.__freehubPluginMention / __freehubPluginAppId。
        var pluginMention = window.__freehubPluginMention;
        var pluginAppId = window.__freehubPluginAppId;
        if (pluginMention && pluginAppId) {
          var hint = 'plugin:' + pluginAppId;
          var hints = Array.isArray(body.system_hints) ? body.system_hints.slice() : [];
          if (hints.indexOf(hint) < 0) hints.unshift(hint);
          body.system_hints = hints;

          var lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.author && lastMsg.author.role === 'user' && lastMsg.content) {
            var parts2 = Array.isArray(lastMsg.content.parts) ? lastMsg.content.parts.slice() : [];
            if (parts2.length === 0) parts2 = [''];
            var mentionPrefix = '@' + pluginMention + ' ';
            // 拼进第一段（与 ChatGPT 手动 @mycodex 一致：单一 part "@mycodex nihao"，
            // 不能 unshift 新 part——那会被前端渲染成两条 user 消息）
            if (parts2[0].indexOf(mentionPrefix) !== 0) {
              parts2[0] = mentionPrefix + parts2[0];
            }
            lastMsg.content.parts = parts2;
            lastMsg.metadata = lastMsg.metadata || {};
            lastMsg.metadata.system_hints = hints;
            lastMsg.metadata.serialization_metadata = lastMsg.metadata.serialization_metadata || {};
            lastMsg.metadata.serialization_metadata.custom_symbol_offsets = [
              // 与 ChatGPT 手动 @mycodex 一致：endIndex 不含尾随空格（如 @mycodex = 8）
              { id: hint, symbol: 'ecosystemMention', startIndex: 0, endIndex: ('@' + pluginMention).length },
            ];
          }
        }

        messages.unshift({
          id: genUuid(),
          author: { role: 'system', name: null, metadata: {} },
          create_time: Date.now() / 1000,
          update_time: Date.now() / 1000,
          content: { content_type: 'text', parts: [projectText] },
          status: 'finished_successfully',
          end_turn: null,
          weight: 1,
          recipient: 'all',
          channel: null,
          metadata: {},
        });
        window.__freehubInjectedConvs[convKey] = true;
        // 调试：把注入内容打印到 ChatGPT 视图控制台（F12 打开 DevTools 查看）
        try {
          console.log('[free-codex 注入] 新会话上下文已注入（' + convKey + '）:\\n' + projectText);
        } catch (e) { /* ignore */ }
        return { body: JSON.stringify(body) };
      } catch (e) {
        return { skip: 'error', error: String((e && e.message) || e) };
      }
    }

    /** 节流上报统计到主进程（供终端日志诊断） */
    function report() {
      var now = Date.now();
      if (now - lastReportAt < 2000) return;
      lastReportAt = now;
      try {
        window.postMessage({
          type: 'freecodex:inject',
          stats: window.__freehubProjectStats,
          installed: !!window.__freehubProjectHookInstalled,
          context: (window.__freehubProjectContext || '').slice(0, 100),
        }, '*');
      } catch (e) { /* ignore */ }
    }

    /** 节流上报统计到主进程（供终端日志诊断） */
    function report() {
      var now = Date.now();
      if (now - lastReportAt < 2000) return;
      lastReportAt = now;
      try {
        window.postMessage({
          type: 'freecodex:inject',
          stats: window.__freehubProjectStats,
          installed: !!window.__freehubProjectHookInstalled,
          context: (window.__freehubProjectContext || '').slice(0, 100),
        }, '*');
      } catch (e) { /* ignore */ }
    }

    // 首页 = 新会话：清除残留的会话 ID（否则新会话会被当成旧会话跳过注入）；
    // 离开首页 = 会话已成形：清除 'default' 占位标记（下一个首页新会话重新注入）
    urlTimer = setInterval(function () {
      if (isHomeUrl()) {
        window.__freehubCurrentConversationId = null;
      } else {
        delete window.__freehubInjectedConvs['default'];
      }
    }, 500);

    /** 读取 system 消息文本（兼容 content.text / content.parts 两种形态） */
    function systemMessageText(mm) {
      if (!mm || !mm.content) return '';
      if (typeof mm.content.text === 'string') return mm.content.text;
      if (Array.isArray(mm.content.parts)) return mm.content.parts.join('');
      return '';
    }

    /**
     * todos 块（每请求，非 session-first）：读 window.__freehubTodosState，
     * 按 [todos 模式] 标记替换已有 system 消息或新增；未启用时清理历史残留。
     * dirty 标记：每次请求置 true（新一轮开始），todos_* 工具调用成功由主进程清 false。
     */
    function applyTodosBlock(body) {
      if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return false;
      var state = window.__freehubTodosState;
      var marker = '[todos 模式]';
      var messages = body.messages;
      var changed = false;

      if (!state || !state.enabled || !state.blockText) {
        for (var i = messages.length - 1; i >= 0; i--) {
          if (systemMessageText(messages[i]).indexOf(marker) !== -1) {
            messages.splice(i, 1);
            changed = true;
          }
        }
        return changed;
      }

      var wasDirty = window.__freehubTodosDirty === true;
      window.__freehubTodosDirty = true;

      var text = state.blockText;
      if (state.incomplete && wasDirty && state.reminder) {
        text = text.replace(marker, marker + '\\n' + state.reminder);
      }

      var replaced = false;
      for (var j = 0; j < messages.length; j++) {
        var mm = messages[j];
        if (!mm || !mm.author || mm.author.role !== 'system') continue;
        if (systemMessageText(mm).indexOf(marker) !== -1) {
          mm.content = { content_type: 'text', parts: [text] };
          replaced = true;
          changed = true;
          break;
        }
      }
      if (!replaced) {
        messages.unshift({
          id: genUuid(),
          author: { role: 'system', name: null, metadata: {} },
          create_time: Date.now() / 1000,
          update_time: Date.now() / 1000,
          content: { content_type: 'text', parts: [text] },
          status: 'finished_successfully',
          end_turn: null,
          weight: 1,
          recipient: 'all',
          channel: null,
          metadata: {},
        });
        changed = true;
      }
      return changed;
    }

    window.fetch = function (input, init) {
      var url = '';
      if (typeof input === 'string') url = input;
      else if (input instanceof URL) url = input.href;
      else if (input && typeof input.url === 'string') url = input.url;

      var method = (init && init.method) || (input instanceof Request ? input.method : 'GET');
      if (!isChatCompletion(url) || method !== 'POST') return origFetch(input, init);

      var stats = window.__freehubProjectStats;
      stats.matched++;
      var result = augmentRequestBody(init);
      // todos 块每请求处理：项目上下文注入/跳过与否都要走到
      var finalBody = null;
      if (result && result.body) {
        try { finalBody = JSON.parse(result.body); } catch (e) { finalBody = null; }
      } else if (result && result.skip && init && typeof init.body === 'string') {
        try { finalBody = JSON.parse(init.body); } catch (e) { finalBody = null; }
      }
      if (finalBody) {
        var todosChanged = applyTodosBlock(finalBody);
        if (result && result.body) {
          stats.injected++;
          report();
          return origFetch(input, Object.assign({}, init, { body: JSON.stringify(finalBody) }));
        }
        if (todosChanged) {
          return origFetch(input, Object.assign({}, init, { body: JSON.stringify(finalBody) }));
        }
      }
      if (result && result.skip) {
        if (result.skip === 'session-injected') stats.skippedSession++;
        else if (result.skip === 'no-context') stats.skippedNoContext++;
        else if (result.skip === 'no-body') stats.skippedNoBody++;
        else if (result.skip === 'error') { stats.errors++; stats.lastError = result.error || 'unknown'; }
        report();
      }
      return origFetch(input, init);
    };

    // 调试：页面 console 可手动测试注入逻辑（window.__freehubTestAugment({body})）
    window.__freehubTestAugment = augmentRequestBody;
    // 调试：页面 console 可手动测试 todos 块注入逻辑（window.__freehubTestApplyTodos(body)）
    window.__freehubTestApplyTodos = applyTodosBlock;
  }
})();
`

// ------------------------------------------------------------
// 临时清理当前会话（删除旧消息 DOM，防卡顿；保留最新 N 条）
// ------------------------------------------------------------

/** 构造删除当前会话 DOM 中最早消息的脚本（保留最新 keep 条；按对话轮次节点删除） */
export function buildTrimConversationScript(keep: number): string {
  const n = Math.max(1, Math.floor(keep))
  return `(() => {
  try {
    var nodes = Array.from(document.querySelectorAll('[data-testid*="turn"], [data-message-author-role]'));
    // 同时命中父子时只保留最外层（轮次容器），避免重复删
    nodes = nodes.filter(function (node) {
      return !nodes.some(function (other) { return other !== node && other.contains(node); });
    });
    var total = nodes.length;
    if (total <= ${n}) return { removed: 0, total: total };
    var removed = 0;
    for (var i = 0; i < total - ${n}; i++) {
      var node = nodes[i];
      if (node && node.parentElement) {
        node.parentElement.removeChild(node);
        removed++;
      }
    }
    return { removed: removed, total: total };
  } catch (e) {
    return { removed: 0, total: 0, error: String((e && e.message) || e) };
  }
})()`
}
