import re, sys, glob, os

BUILTIN = {'JSON','Math','Date','Number','String','Array','Object','Boolean','NaN','Infinity',
           'Promise','Set','Map','Error','RegExp','Buffer','process','require','module','exports',
           'WX','GET','POST','API','ID','URL','HTML','CSS','KB','AI','UTF','OK','MD','IDX'}

def strip_code(js):
    """去掉字符串与注释，避免把文本内容当成标识符"""
    js = re.sub(r'/\*[\s\S]*?\*/', ' ', js)
    js = re.sub(r'(^|[^:])\/\/[^\n]*', r'\1 ', js)
    js = re.sub(r'`(?:\\.|[^`\\])*`', '``', js)
    js = re.sub(r"'(?:\\.|[^'\\])*'", "''", js)
    js = re.sub(r'"(?:\\.|[^"\\])*"', '""', js)
    return js

def declared_names(js):
    names = set()
    # const/let/var 声明（含逗号分隔与解构）
    for m in re.finditer(r'\b(?:const|let|var)\s+([^;\n]+)', js):
        seg = m.group(1)
        for part in re.split(r',(?![^{}]*\})', seg):
            part = part.strip()
            if part.startswith('{') or part.startswith('['):
                names |= set(re.findall(r'[A-Za-z_$][\w$]*', part))
            else:
                mm = re.match(r'([A-Za-z_$][\w$]*)', part)
                if mm: names.add(mm.group(1))
    names |= set(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)', js))
    for m in re.findall(r'function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)', js):
        for p in m.split(','):
            p = p.strip()
            if p: names.add(re.sub(r'=.*$', '', p).strip())
    for m in re.finditer(r'([A-Za-z_$][\w$]*)\s*=>', js):
        names.add(m.group(1))
    for m in re.finditer(r'catch\s*\(\s*([A-Za-z_$][\w$]*)', js):
        names.add(m.group(1))
    # 方法简写名 / 参数名（宽松补充）
    names |= set(re.findall(r'^  ([A-Za-z_$][\w$]*)\s*\(', js, re.M))
    return names

def check(path):
    raw = open(path, encoding='utf-8').read()
    js = strip_code(raw)
    declared = declared_names(js)
    used = set()
    for m in re.finditer(r'(?<![\.\w$])([A-Z][A-Z0-9_]{2,})\b', js):   # 裸的大写标识符（排除属性访问）
        if js[m.end():m.end()+1] != ':':   # 排除对象键（NAME: value）
            used.add(m.group(1))
    return sorted(u for u in used if u not in declared and u not in BUILTIN)

if __name__ == '__main__':
    files = []
    for pat in ('pages/**/*.js','utils/*.js','packageExam/**/*.js','app.js'):
        files += glob.glob(pat, recursive=True)
    bad = 0
    for f in sorted(set(files)):
        if 'node_modules' in f: continue
        m = check(f)
        if m:
            bad += 1
            print('  ❌ %s → %s' % (f, m))
    print('  未定义常量引用: %s' % (bad if bad else '0 ✅'))
    # 自检：故意构造一个未定义常量，确认能抓出来
    tmp = '/tmp/_selfcheck.js'
    open(tmp,'w',encoding='utf-8').write("const A_B = 1;\nfunction f(){ return A_B + NOT_DEFINED_X; }\n")
    print('  自检（应报 NOT_DEFINED_X）:', check(tmp))

# ---------- ⑦ WXML 模板里出现方法/函数调用（WXML 不支持，会编译失败）----------
def audit_wxml_calls(root):
    import re as _re, glob as _glob, os as _os
    pat_method = _re.compile(r'\.\s*[A-Za-z_$][\w$]*\s*\(')
    pat_call = _re.compile(r'(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(')
    allow = {'true', 'false', 'null', 'undefined'}
    bad = 0
    for f in sorted(_glob.glob(_os.path.join(root, '**', '*.wxml'), recursive=True)):
        src = open(f, encoding='utf-8').read()
        for m in _re.finditer(r'\{\{([\s\S]*?)\}\}', src):
            expr = m.group(1)
            hits = []
            mm = pat_method.search(expr)
            if mm: hits.append('方法调用 ' + mm.group(0).strip())
            for c in pat_call.finditer(expr):
                n = c.group(1)
                if n not in allow and not n.isupper(): hits.append('函数调用 ' + n + '()')
            if hits:
                bad += 1
                print('  \u274c %s:%d %s' % (_os.path.relpath(f, root), src[:m.start()].count('\n') + 1, ' | '.join(sorted(set(hits)))))
    print('  WXML 非法调用: %s' % (bad if bad else '0 \u2705'))
