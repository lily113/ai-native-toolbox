#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""花样滑冰小程序静态自检（8 项）
用法：cd figure-skating-mp && python3 ../tools/audit_mp.py

① wxml 里绑定/引用的方法 ↔ JS 里定义的方法（含动态绑定 {{a ? 'x' : 'y'}}）
② JS 里 this.xxx() 调用 ↔ 已定义的方法（防编辑误删方法）
③ 同一个 Page 内重复定义的方法名
④ wxml 模板里用到的字段 ↔ data 里声明的字段
⑤ wxss 重复选择器（同一选择器写到两处，属性冲突会导致样式飘忽）
⑥ 未定义的大写常量引用
⑦ wxml 模板里出现方法/函数调用（WXML 不支持，会编译失败）
⑧ wxml 标签闭合 / wxss 花括号 / json 合法性
"""
import re, sys, glob, os, json
from string import ascii_letters as ASCII_LETTERS

KW = {'if', 'for', 'while', 'return', 'switch', 'catch', 'else', 'do', 'function',
      'new', 'typeof', 'try', 'true', 'false', 'null', 'undefined', 'in', 'of', 'void'}
# 小程序内置方法：不是 Page 自己定义的，别当成漏定义
BUILTIN_METHODS = {'setData', 'selectComponent', 'selectAllComponents', 'createSelectorQuery',
                   'animate', 'groupSetData', 'getTabBar', 'getOpenerEventChannel', 'hasBehavior',
                   'triggerEvent', 'setUpdatePerformanceListener', 'getPageId'}
RESULTS = []


def say(name, bad, extra=''):
    RESULTS.append((name, bad))
    mark = '0 ✅' if not bad else '%d ❌' % bad
    print('  %-42s %s%s' % (name, mark, ('  ' + extra) if extra else ''))


def walk(pat):
    return sorted(glob.glob(os.path.join('.', pat), recursive=True))


def read(p):
    return open(p, encoding='utf-8').read()


def all_js():
    return [f for f in walk('**/*.js') if 'cloudfunctions' not in f and 'node_modules' not in f]


def page_pairs():
    """返回 [(js路径, wxml路径或None)]；只收 Page 文件（utils 里的普通函数不算页面方法）"""
    out = []
    for jsf in all_js():
        if 'Page(' not in read(jsf):
            continue
        wf = jsf[:-3] + '.wxml'
        out.append((jsf, wf if os.path.exists(wf) else None))
    return out


def strip_code(js):
    js = re.sub(r'/\*[\s\S]*?\*/', ' ', js)
    js = re.sub(r'(^|[^:])\/\/[^\n]*', r'\1 ', js)
    js = re.sub(r'`(?:\\.|[^`\\])*`', '``', js)
    js = re.sub(r"'(?:\\.|[^'\\])*'", "''", js)
    js = re.sub(r'"(?:\\.|[^"\\])*"', '""', js)
    return js


def defined_methods(js):
    # Page 对象里缩进两格的方法简写名
    return set(m.group(1) for m in re.finditer(r'^  ([A-Za-z_$][\w$]*)\s*\(', js, re.M)
               if m.group(1) not in KW)


# ---------- ① + ⑧ wxml 引用的方法 ↔ JS 方法 ----------
def audit_handlers():
    bad = 0
    for jsf, wf in page_pairs():
        if not wf:
            continue
        js, w = read(jsf), read(wf)
        defined = defined_methods(js)
        refs = set()
        for m in re.finditer(r'\b(?:bind|catch)[a-zA-Z]*\s*=\s*"([^"]+)"', w):
            v = m.group(1)
            refs |= set(re.findall(r"'([A-Za-z_$][\w$]*)'", v))   # 动态绑定里的方法名
            if '{' not in v and v.strip():
                refs.add(v.strip())
        miss = sorted(x for x in refs if x not in defined)
        if miss:
            bad += 1
            print('     ❌ %s 缺方法: %s' % (os.path.relpath(wf), miss))
    say('① wxml 绑定 ↔ 方法（含动态绑定）', bad)


# ---------- ② this.xxx() ↔ 方法定义 ----------
def audit_this_calls():
    bad = 0
    for jsf, _ in page_pairs():
        js = strip_code(read(jsf))
        body = js.split('Page(', 1)
        body = body[1] if len(body) > 1 else js
        defined = defined_methods(js)
        called = set(m.group(1) for m in re.finditer(r'this\.([A-Za-z_$][\w$]*)\s*\(', body))
        miss = sorted(c for c in called if c not in defined and c not in BUILTIN_METHODS)
        if miss:
            bad += 1
            print('     ❌ %s 调用了不存在的方法: %s' % (jsf, miss))
    say('② this.xxx() ↔ 方法定义', bad)


# ---------- ③ 重复方法名 ----------
def audit_dup_methods():
    bad = 0
    for jsf, _ in page_pairs():
        js = read(jsf)
        at = js.find('Page(')
        js = js[at:] if at >= 0 else js
        seen, dup = {}, []
        for m in re.finditer(r'^  ([A-Za-z_$][\w$]*)\s*\(', js, re.M):
            n = m.group(1)
            if n in KW:
                continue
            line = js[:m.start()].count('\n') + 1
            if n in seen:
                dup.append('%s(%d,%d)' % (n, seen[n], line))
            else:
                seen[n] = line
        if dup:
            bad += 1
            print('     ❌ %s 重复定义: %s' % (jsf, dup))
    say('③ 重复方法名', bad)


# ---------- ④ wxml 字段 ↔ data ----------
def data_keys(js):
    at = js.find('data:')
    if at < 0:
        return set()
    i = js.find('{', at)
    if i < 0:
        return set()
    depth, j = 0, i
    while j < len(js):
        if js[j] == '{':
            depth += 1
        elif js[j] == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    block = js[i:j + 1]
    # 扫描一层深度上的 `键:`（data 支持一行写完，所以不能靠行首匹配）
    keys, depth, k = set(), 0, 0
    while k < len(block):
        ch = block[k]
        if ch in '{([':
            depth += 1
        elif ch in '})]':
            depth -= 1
        elif depth == 1 and (ch in ASCII_LETTERS or ch in '_$'):
            m = re.match(r'[A-Za-z_$][\w$]*', block[k:])
            name = m.group(0)
            if block[k + len(name):].lstrip().startswith(':'):
                keys.add(name)
            k += len(name) - 1
        k += 1
    return keys


def audit_fields():
    bad = 0
    for jsf, wf in page_pairs():
        if not wf:
            continue
        js, w = read(jsf), read(wf)
        keys = data_keys(js)
        aliases = set(['item', 'index'])
        for m in re.finditer(r'wx:for-(?:item|index)\s*=\s*"([^"]+)"', w):
            aliases.add(m.group(1))
        used = set()
        for m in re.finditer(r'\{\{([\s\S]*?)\}\}', w):
            expr = strip_code(m.group(1)).replace("''", ' ')
            for c in re.finditer(r'(?<![\w.$])([A-Za-z_$][\w$]*)', expr):
                n = c.group(1)
                if n in KW or n in aliases:
                    continue
                used.add(n)
        miss = sorted(u for u in used if u not in keys)
        if miss:
            bad += 1
            print('     ❌ %s 用到的字段没在 data 里: %s' % (os.path.relpath(wf), miss))
    say('④ wxml 字段 ↔ data', bad)


# ---------- ⑤ wxss 重复选择器 ----------
def audit_wxss():
    bad = 0
    for f in walk('**/*.wxss'):
        if 'node_modules' in f:
            continue
        src = read(f)
        src = re.sub(r'/\*[\s\S]*?\*/', ' ', src)
        rules = {}
        for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', src):
            decls = {}
            for d in m.group(2).split(';'):
                if ':' in d:
                    k = d.split(':', 1)[0].strip()
                    if k:
                        decls[k] = d.split(':', 1)[1].strip()
            for sel in m.group(1).split(','):
                sel = ' '.join(sel.split())
                if not sel or sel.startswith('@'):
                    continue
                rules.setdefault(sel, []).append(decls)
        for sel, blocks in rules.items():
            if len(blocks) < 2:
                continue
            common = set(blocks[0])
            for b in blocks[1:]:
                common &= set(b)
            common = {k for k in common if len({b[k] for b in blocks}) > 1}
            if common:
                bad += 1
                print('     ⚠  %s 选择器 %s 重复且属性冲突（确认是有意覆盖再忽略）: %s' % (f, sel, sorted(common)))
    say('⑤ wxss 重复选择器（属性冲突·仅提示）', 0, extra=('%d 处提示' % bad) if bad else '')


# ---------- ⑥ 未定义大写常量 ----------
BUILTIN = {'JSON', 'Math', 'Date', 'Number', 'String', 'Array', 'Object', 'Boolean', 'NaN',
           'Infinity', 'Promise', 'Set', 'Map', 'Error', 'RegExp', 'Buffer', 'process',
           'require', 'module', 'exports', 'WX', 'GET', 'POST', 'API', 'ID', 'URL', 'HTML',
           'CSS', 'KB', 'AI', 'UTF', 'OK', 'MD', 'IDX', 'ENV'}


def declared_names(js):
    names = set()
    for m in re.finditer(r'\b(?:const|let|var)\s+([^;\n]+)', js):
        seg = m.group(1)
        for part in re.split(r',(?![^{}]*\})', seg):
            part = part.strip()
            if part.startswith('{') or part.startswith('['):
                names |= set(re.findall(r'[A-Za-z_$][\w$]*', part))
            else:
                mm = re.match(r'([A-Za-z_$][\w$]*)', part)
                if mm:
                    names.add(mm.group(1))
    names |= set(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)', js))
    for m in re.findall(r'function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)', js):
        for p in m.split(','):
            p = p.strip()
            if p:
                names.add(re.sub(r'=.*$', '', p).strip())
    for m in re.finditer(r'([A-Za-z_$][\w$]*)\s*=>', js):
        names.add(m.group(1))
    for m in re.finditer(r'catch\s*\(\s*([A-Za-z_$][\w$]*)', js):
        names.add(m.group(1))
    names |= set(re.findall(r'^  ([A-Za-z_$][\w$]*)\s*\(', js, re.M))
    return names


def audit_consts():
    bad = 0
    for jsf, _ in page_pairs():
        js = strip_code(read(jsf))
        declared = declared_names(js)
        used = set()
        for m in re.finditer(r'(?<![\.\w$])([A-Z][A-Z0-9_]{2,})\b', js):
            if js[m.end():m.end() + 1] != ':':
                used.add(m.group(1))
        miss = sorted(u for u in used if u not in declared and u not in BUILTIN)
        if miss:
            bad += 1
            print('     ❌ %s 未定义常量: %s' % (jsf, miss))
    say('⑥ 未定义大写常量', bad)


# ---------- ⑦ wxml 非法调用 ----------
def audit_wxml_calls():
    bad = 0
    pat_method = re.compile(r'\.\s*[A-Za-z_$][\w$]*\s*\(')
    pat_call = re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(')
    for f in walk('**/*.wxml'):
        src = read(f)
        for m in re.finditer(r'\{\{([\s\S]*?)\}\}', src):
            expr = m.group(1)
            hits = []
            if pat_method.search(expr):
                hits.append('方法调用 ' + pat_method.search(expr).group(0).strip())
            for c in pat_call.finditer(expr):
                n = c.group(1)
                if n not in ('true', 'false', 'null', 'undefined') and not n.isupper():
                    hits.append('函数调用 %s()' % n)
            if hits:
                bad += 1
                print('     ❌ %s:%d %s' % (f, src[:m.start()].count('\n') + 1, ' | '.join(sorted(set(hits)))))
    say('⑦ wxml 非法调用', bad)


# ---------- ⑧ 标签 / 花括号 / JSON ----------
VOID = set()   # WXML 里凡是没有写成 <tag ... /> 的都必须有闭合标签


def audit_syntax():
    bad = 0
    for f in walk('**/*.wxml'):
        src = re.sub(r'<!--[\s\S]*?-->', ' ', read(f))
        stack = []
        for m in re.finditer(r'<\s*(/)?\s*([A-Za-z][\w-]*)([^>]*?)(/)?\s*>', src):
            closing, tag, attrs, selfclose = m.group(1), m.group(2), m.group(3), m.group(4)
            if closing:
                if not stack:
                    bad += 1
                    print('     ❌ %s 多余的 </%s>' % (f, tag))
                elif stack[-1][0] != tag:
                    bad += 1
                    print('     ❌ %s </%s> 与 <%s>（第 %d 行）不匹配' % (f, tag, stack[-1][0], stack[-1][1]))
                    stack.pop()
                else:
                    stack.pop()
            elif selfclose or tag in VOID:
                continue
            else:
                stack.append((tag, src[:m.start()].count('\n') + 1))
        for tag, line in stack:
            bad += 1
            print('     ❌ %s <%s>（第 %d 行）没有闭合' % (f, tag, line))
    for f in walk('**/*.wxss'):
        src = re.sub(r'/\*[\s\S]*?\*/', ' ', read(f))
        if src.count('{') != src.count('}'):
            bad += 1
            print('     ❌ %s 花括号不配对 { %d / } %d' % (f, src.count('{'), src.count('}')))
    for f in walk('**/*.json'):
        if 'node_modules' in f or 'cloudfunctions' in f:
            continue
        try:
            json.loads(read(f))
        except Exception as e:
            bad += 1
            print('     ❌ %s JSON 非法: %s' % (f, e))
    say('⑧ 标签闭合 / 花括号 / JSON', bad)


if __name__ == '__main__':
    print('自检目录: %s' % os.getcwd())
    audit_handlers()
    audit_this_calls()
    audit_dup_methods()
    audit_fields()
    audit_wxss()
    audit_consts()
    audit_wxml_calls()
    audit_syntax()
    total = sum(b for _, b in RESULTS)
    print('\n合计问题: %d' % total)
    sys.exit(1 if total else 0)
