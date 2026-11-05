# 015 — route naturelle quais et barges

- Statut : **PASS**.
- Départ : {"money":600,"materials":0,"population":0,"phase":1,"buildings":0}.
- t28 : {"tick":28,"flows":[{"resource":"food","amount":4,"sourceDistrict":2,"destinationDistrict":0},{"resource":"water","amount":1.7496597908508473,"sourceDistrict":0,"destinationDistrict":2}],"barges":[{"resource":"food","amount":4},{"resource":"water","amount":1.7496597908508473}]}.
- t120 : {"tick":120,"networks":[{"basin":2,"districts":[0,2],"quays":[{"district":0,"c":2,"r":5,"activity":1,"quaySide":{"c":2,"r":4}},{"district":2,"c":4,"r":6,"activity":1,"quaySide":{"c":4,"r":5}}],"nominalCapacity":12,"effectiveCapacity":6,"weatherMultiplier":0.5,"reductionReason":"drought"}],"flows":[{"resource":"food","amount":3.896157598306317},{"resource":"water","amount":2.103842401693683}],"backupWells":3}.
- Final : {"tick":161,"status":"success","finishedAtTick":161,"droughtHeld":true,"population":155.51993969689767,"money":3144.043704302432,"materials":67.45682245938211,"phase":4,"outcome":null}.
- Delta graphique présent/absent : {"additionalP95Ms":0,"additionalP95Percent":0,"additionalDrawCalls":39,"additionalTriangles":9382}.
- Captures : [015-natural-t28-inspector.png](captures/015-natural-t28-inspector.png) · [015-natural-mobile-fr.png](captures/015-natural-mobile-fr.png) · [015-natural-t120-saturated.png](captures/015-natural-t120-saturated.png) · [015-quays-barges-present.png](captures/015-quays-barges-present.png) · [015-quays-barges-absent.png](captures/015-quays-barges-absent.png) · [015-natural-victory.png](captures/015-natural-victory.png).

Les intervalles RAF bruts et toutes les actions sont dans `015-natural-results.json`.
