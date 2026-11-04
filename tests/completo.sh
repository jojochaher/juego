#!/bin/bash
# corre todas las pruebas de a una (en paralelo fallan por tiempos) y muestra solo lo que falla.
# uso: tests/completo.sh   (desde la raíz del repo).
cd "$(dirname "$0")/.." || exit 1
mkdir -p tests/out
for t in rapido test7 test8 test9 test10 test11 test12 test13 test14 test15 test16 test19 test20 test21 test22 test23 test24 test25 test26 test27 test28; do
  r=$(timeout 300 node tests/$t.js . 2>&1)
  f=$(echo "$r" | grep -E "^FAIL|Error|FALLA" | head -5)
  if [ -n "$f" ]; then echo "== $t"; echo "$f"; else echo "ok $t"; fi
done
echo "== caos (test18, 40 pasos)"
timeout 400 node tests/test18.js . 40 | grep -E "FALLA|OK sin|semilla" | head -10
