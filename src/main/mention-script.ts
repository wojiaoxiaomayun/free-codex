/**
 * 通用 @ 提及 / 技能触发检测 + 文本插入脚本（注入 ChatGPT 页面主 world）
 *
 * 由 chat-preload（webFrame.executeJavaScript）注入，早于页面自身脚本执行。
 *
 * 职责：
 * 1. 监听输入：
 *    - 输入 `@`（任意位置）→ 记录元素，postMessage 通知主程序打开文件命令面板；
 *    - 输入 `/` 且位于消息开头 → 在 beforeinput 捕获阶段拦截（/ 不写入输入框，
 *      ChatGPT 原生斜杠菜单不会弹出），postMessage 通知主程序打开技能选择面板；
 *      未选中关闭时由主程序调 __freehubRestoreSlash 把 / 写回。
 * 2. 暴露 window.__freehubInsertText(text)：把文本插入到记录的可编辑元素光标处；
 *    若光标前一字符是触发字符（@ 或 /），则替换为插入文本。
 *
 * 注意：脚本为纯 JS 字符串（非 toString 序列化），不要使用模板字面量/反引号。
 */

export const MENTION_SCRIPT = `
(() => {
  if (window.__freehubMentionInstalled) return;
  window.__freehubMentionInstalled = true;

  /** 是否可编辑元素（输入框/文本域/富文本） */
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      if (el.isContentEditable) return true;
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      return type !== 'hidden' && type !== 'submit' && type !== 'button' &&
        type !== 'checkbox' && type !== 'radio' && type !== 'file' && type !== 'password';
    }
    return el.isContentEditable === true || el.getAttribute('contenteditable') === 'true';
  }

  /** 触发面板的输入元素（面板选中后插入用）与触发字符（@ 或 /） */
  window.__freehubMentionEl = null;
  window.__freehubTriggerChar = null;
  /** 挂起的消息开头斜杠（beforeinput 拦截后，选中技能/关闭面板时消费） */
  window.__freehubPendingSlash = false;
  /** 最近一次恢复斜杠的时间戳（防止恢复写回的 / 再次触发面板） */
  window.__freehubLastRestoreAt = 0;

  /** 光标前文本：textarea/input 用值+光标；contenteditable 向上取可编辑根，用 range 取文本 */
  function textBeforeCaret(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      var value = el.value || '';
      var caret = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
      return value.slice(0, caret);
    }
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    try {
      var node = el;
      while (node && node.parentElement && node.parentElement.isContentEditable) node = node.parentElement;
      var range = sel.getRangeAt(0);
      var clone = range.cloneRange();
      clone.selectNodeContents(node);
      clone.setEnd(range.startContainer, range.startOffset);
      return clone.toString();
    } catch (e) { return null; }
  }

  /** 输入 / 后是否处于消息开头（input 事件时值已更新：光标前恰好是 /） */
  function isMessageStartSlash(el) {
    return textBeforeCaret(el) === '/';
  }

  /** 将要输入的 / 是否落在消息开头（beforeinput 时值未更新：光标前为空） */
  function slashAtMessageStart(el) {
    return textBeforeCaret(el) === '';
  }

  function trigger(char, el) {
    window.__freehubMentionEl = el;
    window.__freehubTriggerChar = char;
    try {
      window.postMessage({ type: char === '@' ? 'freehub:mention-open' : 'freehub:skill-open' }, '*');
    } catch (e) { /* ignore */ }
  }

  // 消息开头的 /：在 beforeinput 捕获阶段拦截（/ 不写入输入框，ChatGPT 原生斜杠
  // 菜单不会弹出），打开应用技能面板；选中技能后由 __freehubInsertText 写入 /skill:名称。
  document.addEventListener('beforeinput', function (e) {
    if (!e || e.data !== '/') return;
    var el = e.target;
    if (!isEditable(el)) return;
    if (slashAtMessageStart(el)) {
      e.preventDefault();
      window.__freehubPendingSlash = true;
      trigger('/', el);
    }
  }, true);

  // 输入事件：仅当本次输入恰好是 '@'（任意位置）或 '/'（消息开头）时触发。
  // 捕获阶段监听，不干预页面自身的输入处理。
  // 注：beforeinput 拦截成功时这里不会收到该 /（值未写入）；此分支是兜底路径。
  document.addEventListener('input', function (e) {
    if (!e || typeof e.data !== 'string') return;
    var el = e.target;
    if (!isEditable(el)) return;
    if (e.data === '@') { trigger('@', el); return; }
    if (e.data === '/' && isMessageStartSlash(el)) {
      // 恢复写回的 /（300ms 内）不重复打开面板
      var now = Date.now();
      if (window.__freehubLastRestoreAt && now - window.__freehubLastRestoreAt < 300) {
        window.__freehubLastRestoreAt = 0;
        return;
      }
      trigger('/', el);
      return;
    }
  }, true);

  /** 把文本插入到记录的可编辑元素光标处（@ 或 / 前置时替换为文本） */
  window.__freehubInsertText = function (text) {
    // 选中技能写入即消费挂起的斜杠（/skill:名称 自带开头的 /）
    window.__freehubPendingSlash = false;
    var el = window.__freehubMentionEl;
    if (!el || !document.contains(el)) {
      el = document.activeElement && isEditable(document.activeElement) ? document.activeElement : null;
    }
    if (!el) return { ok: false, error: 'no-editable-input' };

    // textarea / input：原生 value setter（绕开 React 受控组件拦截）+ 光标处插入
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (!setter || !setter.set) setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      var value = el.value || '';
      var start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
      // 光标前一字符是触发字符（@ 文件 / 技能）→ 替换为插入文本
      var removeCount = 0;
      if (start > 0 && (value.charAt(start - 1) === '@' || value.charAt(start - 1) === '/')) {
        removeCount = 1;
        start -= 1;
      }
      var next = value.slice(0, start) + text + value.slice(start + removeCount);
      if (setter && setter.set) setter.set.call(el, next);
      else el.value = next;
      var caret = start + text.length;
      try { el.setSelectionRange(caret, caret); } catch (e2) { /* ignore */ }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      try { el.focus(); } catch (e3) { /* ignore */ }
      return { ok: true };
    }

    // contenteditable：选中光标前的触发字符（若有）再插入，insertText 会替换当前选区
    el.focus();
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var node = sel.focusNode;
      var offset = sel.focusOffset;
      if (node && node.nodeType === 3 && offset > 0) {
        var prevChar = node.data.charAt(offset - 1);
        if (prevChar === '@' || prevChar === '/') {
          try {
            var r = document.createRange();
            r.setStart(node, offset - 1);
            r.setEnd(node, offset);
            sel.removeAllRanges();
            sel.addRange(r);
          } catch (e4) { /* ignore */ }
        }
      }
    }
    document.execCommand('insertText', false, text);
    return { ok: true };
  };

  /** 技能面板未选中直接关闭时，把被拦截的 / 写回输入框（保留用户输入意图） */
  window.__freehubRestoreSlash = function () {
    if (!window.__freehubPendingSlash) return { ok: true, restored: false };
    window.__freehubPendingSlash = false;
    window.__freehubLastRestoreAt = Date.now();
    return window.__freehubInsertText('/');
  };
})();
`
