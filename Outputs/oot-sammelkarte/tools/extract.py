import re, json, glob, sys
src = sys.argv[1]
txt = open(src + '/LocationList.py', encoding='utf-8').read()
rows = re.findall(r'\("([^"]+)",\s*\("([^"]+)",[^\n]*?\'([^\']+)\',\s*\(([^)]*)\)\)\)', txt)
gs, poh, rew = [], [], []
for name, typ, item, cats in rows:
    if 'MQ' in name: continue
    cats = [c.strip().strip('"') for c in cats.split(',') if c.strip()]
    if typ == 'GS Token': gs.append((name, cats))
    elif (item.startswith("Piece of Heart") and "Out of Logic" not in item) or name == "Kak 50 Gold Skulltula Reward": poh.append((name, cats))
    if 'Gold Skulltula Reward' in name: rew.append((name, item))
rules = {}
for f in glob.glob(src + '/*.json'):
    raw = open(f, encoding='utf-8').read()
    raw = '\n'.join(re.sub(r'\s#[^"]*$','',l) for l in raw.split('\n') if not l.strip().startswith('#'))
    raw = re.sub(r',(\s*[}\]])', r'\1', raw)
    try: regions = json.loads(raw, strict=False)
    except Exception as e: print('parse fail', f, e, file=sys.stderr); continue
    for r in regions:
        for loc, rule in (r.get('locations') or {}).items():
            rules[loc] = {'rule': ' '.join(rule.split()), 'region': r.get('region_name'), 'scene': r.get('scene') or r.get('dungeon')}
out = {'gs': [{'name': n, 'cats': c, **rules.get(n, {})} for n, c in gs],
       'poh': [{'name': n, 'cats': c, **rules.get(n, {})} for n, c in poh],
       'rewards': [{'name': n, 'item': i} for n, i in rew]}
print(len(out['gs']), len(out['poh']), len(out['rewards']), file=sys.stderr)
print('missing rules', [x['name'] for x in out['gs'] + out['poh'] if 'rule' not in x], file=sys.stderr)
json.dump(out, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
