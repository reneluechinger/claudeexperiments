import json, sys
tpl, orte, out = sys.argv[1:4]
data = json.load(open(orte, encoding='utf-8'))
keep = ['id','typ','gebiet','titel','tipp','alter','nacht','items','tag']
data = [{k: o[k] for k in keep if k in o} for o in data]
js = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
html = open(tpl, encoding='utf-8').read().replace('/*ORTE*/[]', js)
open(out, 'w', encoding='utf-8').write(html)
print(len(data), 'Einträge,', len(html), 'Bytes')
