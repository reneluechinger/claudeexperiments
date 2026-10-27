import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
ERW = {'Waldtempel','Feuertempel','Wassertempel','Schattentempel','Eishöhle','Gerudo-Festung','Gespensterwüste'}
KIND = {'Deku-Baum','Dodongos Höhle','Jabu-Jabus Bauch','Grund des Brunnens'}
for o in d:
    o['items'] = ['Dins Feuerinferno oder Feuerpfeile' if i.startswith('Feuer (') else i for i in o['items']]
    if o['alter'] == 'beide' and o['gebiet'] in ERW: o['alter'] = 'erwachsen'
    if o['alter'] == 'beide' and o['gebiet'] in KIND: o['alter'] = 'kind'
    e = o['en']
    if e == 'OGC GS': o.update(alter='erwachsen', titel='Vor Ganons Schloss', tipp='Als Erwachsener vor Ganons Schloss holen.')
    if e == 'ZF Bottom Freestanding PoH': o.update(alter='erwachsen', items=['Eisenstiefel'])
    if e == 'GF Chest': o['alter'] = 'erwachsen'
    if e == 'Graveyard Freestanding PoH': o['items'] = ['Zauberbohne oder Fanghaken']
    if e == 'LH Freestanding PoH': o['items'] = ['Zauberbohne oder Vogelscheuchen-Lied']
    if 'agsüber' in o['tipp']: o['tag'] = True
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok', len(d))
