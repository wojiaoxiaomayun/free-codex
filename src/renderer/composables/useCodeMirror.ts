/**
 * CodeMirror 6 编辑器封装（File Explorer 用）
 *
 * - basicSetup：行号 / 折叠 / 搜索 / 高亮 / 自动补全 / 历史（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）
 * - Ctrl+S（Mac: Cmd+S）保存回调
 * - 明暗主题（oneDark / 默认浅色）与语言按需动态切换（Compartment）
 * - 只读切换；切换文件时重建 state（清空 undo 栈，避免跨文件撤销），
 *   重建时把当前语言/主题/只读配置烘焙进 compartments，避免回退到初始值
 */

import { Compartment, EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, keymap, type KeyBinding } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { vue } from '@codemirror/lang-vue'

export type EditorLanguage =
  | 'text'
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'vue'
  | 'html'
  | 'css'
  | 'markdown'
  | 'python'
  | 'xml'
  | 'yaml'

/** 按文件名（含扩展名）推断语言，未知回退纯文本 */
export function detectLanguage(fileName: string): EditorLanguage {
  const base = fileName.toLowerCase()
  if (/\.(ts|tsx|mts|cts)$/.test(base)) return 'typescript'
  if (/\.(js|jsx|mjs|cjs)$/.test(base)) return 'javascript'
  if (/\.(json|jsonc)$/.test(base)) return 'json'
  if (base.endsWith('.vue')) return 'vue'
  if (/\.(html?)$/.test(base)) return 'html'
  if (/\.(css|scss|less)$/.test(base)) return 'css'
  if (/\.(md|markdown|mdx)$/.test(base)) return 'markdown'
  if (base.endsWith('.py')) return 'python'
  if (/\.(xml|svg|plist)$/.test(base)) return 'xml'
  if (/\.(ya?ml)$/.test(base)) return 'yaml'
  return 'text'
}

function langExtensions(lang: EditorLanguage): Extension {
  switch (lang) {
    case 'typescript':
      return javascript({ typescript: true, jsx: true })
    case 'javascript':
      return javascript({ jsx: true })
    case 'json':
      return json()
    case 'vue':
      return vue()
    case 'html':
      return html()
    case 'css':
      return css()
    case 'markdown':
      return markdown()
    case 'python':
      return python()
    case 'xml':
      return xml()
    case 'yaml':
      return yaml()
    default:
      return []
  }
}

export interface CodeMirrorOptions {
  dark: boolean
  /** Ctrl+S（Mac: Cmd+S） */
  onSave?: () => void
  /** 文档内容变化（dirty 状态用） */
  onDocChange?: () => void
  /** 光标位置变化（状态栏 行:列） */
  onCursorChange?: (pos: { line: number; col: number }) => void
}

export interface CodeMirrorController {
  view: EditorView
  /** 替换全文（切换文件用；会清空 undo 栈） */
  setContent(text: string): void
  getContent(): string
  setReadOnly(readOnly: boolean): void
  setLanguage(lang: EditorLanguage): void
  setDark(dark: boolean): void
  /** 跳转到指定行（1-based）：选中整行并滚动到视口中央（搜索结果跳转用） */
  gotoLine(line: number): void
  /** 当前选区（无选区返回 null）：起止行号（1-based）+ 选中文本（右键菜单用） */
  getSelectionRange(): { fromLine: number; toLine: number; text: string } | null
  /**
   * 高亮指定行的若干区间（搜索结果跳转用）：临时装饰 + 光标移到首个匹配 + 滚动到视口。
   * 装饰在切换文件（setContent）/ 销毁时自动清除。
   */
  highlightMatch(line: number, ranges: { from: number; to: number }[]): void
  focus(): void
  destroy(): void
}

export function createCodeMirror(el: HTMLElement, opts: CodeMirrorOptions): CodeMirrorController {
  // 回调走可变 holder：组件可随时替换行为，无需重建编辑器
  const handlers: CodeMirrorOptions = { ...opts }
  const languageCompartment = new Compartment()
  const themeCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()
  const matchCompartment = new Compartment()

  // 当前配置（setContent 重建 state 时烘焙进 compartments，避免回退初始值）
  let currentLang: EditorLanguage = 'text'
  let currentDark = opts.dark
  let currentReadOnly = false

  const saveKeymap: KeyBinding[] = [
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        handlers.onSave?.()
        return true
      },
    },
  ]

  function buildState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        languageCompartment.of(langExtensions(currentLang)),
        themeCompartment.of(currentDark ? oneDark : []),
        readOnlyCompartment.of(
          currentReadOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
        matchCompartment.of([]),
        keymap.of(saveKeymap),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) handlers.onDocChange?.()
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            handlers.onCursorChange?.({ line: line.number, col: head - line.from + 1 })
          }
        }),
      ],
    })
  }

  const view = new EditorView({ parent: el, state: buildState('') })

  return {
    view,
    setContent(text: string): void {
      // 重建 state：切换文件时清空 undo 栈，避免跨文件撤销
      view.setState(buildState(text))
    },
    getContent(): string {
      return view.state.doc.toString()
    },
    setReadOnly(readOnly: boolean): void {
      currentReadOnly = readOnly
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(
          readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),
      })
    },
    setLanguage(lang: EditorLanguage): void {
      currentLang = lang
      view.dispatch({ effects: languageCompartment.reconfigure(langExtensions(lang)) })
    },
    setDark(dark: boolean): void {
      currentDark = dark
      view.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : []) })
    },
    gotoLine(line: number): void {
      const doc = view.state.doc
      const target = Math.max(1, Math.min(line, doc.lines))
      const lineObj = doc.line(target)
      view.dispatch({
        selection: { anchor: lineObj.from, head: lineObj.to },
        effects: EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      })
      view.focus()
    },
    getSelectionRange(): { fromLine: number; toLine: number; text: string } | null {
      const sel = view.state.selection.main
      if (sel.empty) return null
      return {
        fromLine: view.state.doc.lineAt(sel.from).number,
        toLine: view.state.doc.lineAt(sel.to).number,
        text: view.state.sliceDoc(sel.from, sel.to),
      }
    },
    highlightMatch(line: number, ranges: { from: number; to: number }[]): void {
      const doc = view.state.doc
      if (line < 1 || line > doc.lines) return
      const lineObj = doc.line(line)
      const mark = Decoration.mark({ class: 'cm-search-hit' })
      const decos: Range<Decoration>[] = []
      for (const r of ranges) {
        const from = Math.min(Math.max(lineObj.from + r.from, lineObj.from), lineObj.to)
        const to = Math.min(Math.max(lineObj.from + r.to, lineObj.from), lineObj.to)
        if (to > from) decos.push(mark.range(from, to))
      }
      view.dispatch({
        effects: matchCompartment.reconfigure(EditorView.decorations.of(Decoration.set(decos))),
      })
      // 光标定位到首个匹配并滚动到视口
      const anchor = decos.length > 0 ? decos[0].from : lineObj.from
      view.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
      })
      view.focus()
    },
    focus(): void {
      view.focus()
    },
    destroy(): void {
      view.destroy()
    },
  }
}
