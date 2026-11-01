# Notas técnicas del juego

Notas para Claude (y para quien toque el código). Lo personal y el rumbo están en el proyecto "Juego" de claude.ai (claude/instrucciones.md). Este archivo es público: nada personal acá.

Mantener al día: cuando cambia algo técnico, editar la parte que cambia (no reescribir todo).

## Cómo se trabaja

- Cambios: commit y push a main. GitHub Pages publica en ~1 minuto: https://jojochaher.github.io/juego/
- **Una publicación a la vez:** no pushear de nuevo hasta que termine la anterior (`gh run list -R jojochaher/juego -L 1` dice completed). Si se pisan, Pages falla con "in progress deployment" y los reruns quedan en "queued" para siempre; se destraba con un push nuevo (`git commit --allow-empty`) cuando la anterior terminó. Para verificar qué está publicado: WebFetch de https://jojochaher.github.io/juego/game.js?v=N y mirar VERSION (el contenedor no llega a github.io por curl).
- SIEMPRE subir `VERSION` en game.js en cada push (aunque solo cambie otro archivo): la auto-actualización compara esa constante.
- Antes de pushear: `node --check` de los .js y **`node tests/rapido.js .`** (~15 s). Si se tocó sala/rtc/arranque/guardado o es una versión grande: **`tests/completo.sh`** (~10 min, incluye el test de caos). NO correr tests en paralelo (el WebGL por software se pone lento y fallan por tiempos).
- Versiones grandes (varias cosas juntas o algo delicado de sala/rtc/física/guardado): antes de pushear, pedirle a un agente aparte (sin el contexto de la conversación) que revise el diff buscando bugs; verificar lo que encuentre antes de arreglarlo.
- Bugs que solo pasan en el iPhone de José: pedirle el registro (3 toques en la versión arriba a la izquierda → copiar; arriba de todo hay una línea "AHORA" con el estado). Antes de dar un bug por arreglado, reproducirlo en un test con la versión vieja (`git archive <commit> | tar -x -C /tmp/old`) y verificar que la nueva no falla; si no se puede reproducir, decir que es una hipótesis.

## Stack

- HTML + JS vanilla + WebGL1 a mano (canvas). Sin bundler, framework ni librerías.
- PWA. Service worker network-first, SOLO para archivos del mismo origen y nunca para text/event-stream (si intercepta los EventSource de Firebase los deja abiertos y trata de cachear un flujo infinito). Caché 'juego-v2'.
- Auto-actualización: game.js se baja a sí mismo cada 30 s y al volver a la app; si VERSION cambió, recarga (una vez por versión, no con dedos en pantalla ni foto en la mano).
- Archivos (todos comparten el ámbito global; cargan en este orden, game.js último):
  - diag.js: registro (localStorage 'diag', 300 eventos) + panel.
  - sala.js: salas compartidas (Firebase), presencia, mis salas.
  - rtc.js: WebRTC (voz, cara, vista de la cámara), texturas de caras.
  - personaje.js: dibujo de personajes (pjDibujar) + editor con vista en tercera persona.
  - voz.js: efectos de voz (tono, robot, radio, eco, cueva), se aplican antes de mandar.
  - game.js: todo lo demás (render, cámara, edición, física, input, guardado local).
  - sw.js, manifest.json, firebase-rules.json (copia de las reglas publicadas), icon-192/512.png.
  - tests/: pruebas con Playwright (ver abajo). Se publican también en Pages; no molesta.
- Prefijos para no pisarse: diag, sala/SALA_, rtc/RTC_, pj/PJ_, voz.

## Trampas conocidas (leer antes de tocar)

- **Nada que corre al cargar diag/sala/rtc/personaje/voz puede usar cosas de game.js** (clamp, EYE, gl...): ReferenceError. Solo adentro de funciones.
- **No declarar globales con nombres de propiedades de window** (orientation, name, status...). `function orientation()` pisó window.orientation y dejó todo en NaN solo en iPhone.
- **NaN no tira error: hace desaparecer todo.** Todo dato guardado o que llega por red se valida (poseRota(), Number.isFinite). Una foto guardada sin tamaño dejaba pos en NaN por la física → pantalla vacía (v9.2).
- **Nunca hacer que el arranque del dibujo dependa de una carga.** En iOS, indexedDB.open a veces no responde nunca al reabrir la app (bug de WebKit): se lo "pincha" con indexedDB.databases() cada 150 ms y se rinde a los 6 s (v9.1).
- iOS mata la app seguido al mandarla al fondo (vuelve como carga nueva). Al volver sin recarga: los EventSource y la cámara quedan muertos sin aviso → salaReconectar(), y se reabre la cámara si su track quedó 'ended'. Vigía: 70 s sin eventos de Firebase → reconecta.
- iOS no puede usar cámara frontal y trasera a la vez. Mic y frontal se piden recién después del toque en "entrar"; rtcMedios va en cola; un vigía cada 2 s reabre mic/cara muertos.
- iOS ignora audio.volume: el volumen por distancia va por WebAudio (PannerNode HRTF); el <audio> remoto reproduce mudo (si no, Safari no le pasa el stream a WebAudio).
- Memoria iOS: si se pasa, mata la página. Texturas de fotos a 512 px máx (TEX_MAX), carga de a una. ~200 fotos ≈ 160 MB. Miniaturas de "mis salas" se achican a 168 px.
- Pérdida del contexto WebGL: se recarga guardando pos/mirada en sessionStorage 'volver'.
- CSS: regla global `canvas { position: fixed; inset: 0; ... }`. Cualquier otro canvas necesita su propio estilo.
- draw() está en try/catch: un error de dibujo no aparece como pageerror en los tests, sale en #hint ("error: ...") y en el registro.
- `visible(el)` usa getComputedStyle (offsetParent es null para position:fixed).
- Escape para José: https://jojochaher.github.io/juego/?borrar vacía el museo personal.

## Firebase

- Proyecto `juego-dd2eb` (plan Spark, cuenta de Google de José). Realtime Database https://juego-dd2eb-default-rtdb.firebaseio.com, por REST + EventSource, sin SDK.
- El contenedor de Claude NO llega a firebaseio.com. Para probar contra la base real: el Chrome de José (fetch desde la página del juego) o el mock de los tests.
- Reglas: ver firebase-rules.json (salas/<64 chars> legible/escribible por quien tenga el hash; no se puede listar `salas`).
- Modelo: `salas/<sha256('juego:'+contraseña)>/`
  - `poses/<id>` = {c, r, u, w, h, uv}
  - `imgs/<id>` = dataURL JPEG 768 px q0.8
  - `gente/<idDispositivo>` = {p, yaw, pitch, col, cam, t, m?, mid?, cu?, ca?, fa?} (m = pose en el mundo de lo que tiene en la mano: c3, r3, u3, w, h, uv4; mid = foto agarrada; cu/ca = sin torso / cabeza cubo; fa = alto/ancho de la cabeza)
  - `rtc/<para>/<de>` = {type, sdp, t} (se borra al leerlo)
- Editar reglas desde el Chrome de José: el editor es CodeMirror 6 (ctrl+a, Delete, tipear el JSON en una línea; el aviso "Expected ':'" es falso). Publicar con find("Publish button") y click por ref.
- TURN: hueco `RTC_TURN = {app, key}` en rtc.js (Open Relay de Metered); hace falta que José cree la cuenta.

## Mecánicas (cómo funcionan por dentro)

- Cámara de la vista: cuaterniones del giroscopio (DeviceOrientation) + yawOff/pitchOff del arrastre. fov sobre el lado más corto de la pantalla (tans()).
- "En la mano": la vista previa de la cámara o una foto agarrada, con pose relativa a la cámara (L: c, r, u, w, h, uv). Modos: mover / recortar / encuadre / girar. Al agarrar, la vista gira hacia la foto (aim). heldPose()/previewPose() dan la pose final (con grilla, alineada por snapPose()).
- Grilla: de pie (o acostada si está a < 45° de horizontal), 45° de rumbo, 90° de giro, ancho en pasos de 10 cm, esquina de abajo a la izquierda en la grilla de 10 cm.
- Física (fisica()): fotos casi horizontales = piso (escalones de hasta 40 cm, sin saltar); el resto = pared (esferas de 22 cm cada 20 cm, empuje horizontal). Gravedad 9.8. No chocan: la que tenés en la mano, las que tienen otros y las rotas. Si pos queda NaN vuelve a la última buena.
- Guardado local: IndexedDB 'juego' v2, store 'obras' ({...pose, blob}).
- Salas: presencia cada 200 ms si cambió (latido 5 s), DELETE con keepalive al ir al fondo (sala.chau se espera antes de volver a avisar), 30 s sin verse = se fue. Al entrar en el origen se aparece en un lugar al azar a 0.9-1.7 m.
- WebRTC: una conexión por persona, llama el de id menor, SDP completo (sin trickle) por Firebase. Transceivers en orden: audio, video cara, video vista (la trasera con la cámara de fotos equipada, maxBitrate 400k). replaceTrack para todo. "disconnected" más de 4 s → se rearma.
- Personajes: cuerpo con torso / sin torso × cabeza esfera (recorte que siempre mira; cara en elipse) / cubo (caja 3D; cara rectangular en el frente). Forma alto/ancho 0.5-2. localStorage 'pj', 'color'.
- Voz: pitch shifter de retardos modulados (estilo "Jungle" de Chris Wilson) + efecto, en MediaStreamDestination; sin efecto se manda el mic crudo.
- Compu: WASD/flechas, mouse para mirar, clic agarra, rueda distancia (shift tamaño, alt giro), espacio foto/soltar, esc cancelar, supr borrar, C cámara, G grilla, 1-4 modos, H ayuda. Sin joystick si no hay pantalla táctil.
- Registro (diag.js + game.js): abrir/cerrar, fondo/volver, "dibujando ok · estado", "no se dibuja", "no se ve el piso", fotos rotas, pos/mirada rotas, indexedDB lento, fotos cargadas, sala, rtc, mic/cara/cámara, webgl, errores de JS y de dibujo.

## Pruebas (tests/)

- Playwright Chromium (ya instalado en el contenedor; no reinstalar). Uso: `node tests/<test>.js .` desde la raíz. Capturas en tests/out/ (ignorado por git).
- Flags: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (+ `--autoplay-policy=no-user-gesture-required` para audio). La cámara falsa es la misma para frontal y trasera; el mic falso hace un pitido. No hay WebKit: lo de Safari no se puede reproducir.
- Trucos: multi-touch con CDP Input.dispatchTouchEvent; giroscopio con `Object.assign(new Event('deviceorientation'), {alpha, beta, gamma})`; ir al fondo redefiniendo document.hidden + visibilitychange; perder WebGL con WEBGL_lose_context; trabar indexedDB con addInitScript (test23); meter fotos rotas con store() (test24). Globales útiles desde page.evaluate: __game, gl, canvas, addWork, store, tans, diagLog, estadoTxt, pjVista, voz, vozCadena.
- mockdb.js imita Firebase REST + streaming (reglas, ?shallow=true, /__dump, /__streams, /__freeze). El juego acepta `?db=http://localhost:PUERTO`. No manda keep-alive: en tests de más de 70 s salta el vigía y reconecta (esperable).
- rapido.js: arranca, piso visible, foto, sala con 2 que se ven/escuchan/comparten fotos (~15 s).
- test7 inicio/giroscopio · test8 edición (su chequeo de fov falla, es viejo) · test9 cámara/fov · test10 sala con 3 · test11 video/mic · test12 contraseña, salir/volver, fondo · test13 caras al volver · test14 lo que el otro tiene en la mano · test15 grilla · test16 colisiones · test18 caos (`node tests/test18.js . [pasos] [semilla]`) · test19 compu · test20 mis salas · test21 editor de personaje · test22 voz · test23 indexedDB trabado · test24 fotos rotas.

## Estado

- v9.2 publicada y confirmada por José en su iPhone (1 nov 2026): arreglada la pantalla oscura al volver a entrar (v9.1 indexedDB + v9.2 NaN por fotos rotas). Sin TURN todavía.
- Historia: v1 honda · v2 cuarto de fotos · v3 museo en el vacío con giroscopio · v4-v5.2 joystick, edición, modos, fov, cámara equipable · v6 salas · v7 cara y voz (WebRTC) · v7.1-7.3 arreglos de salas, contraseña, ver lo que el otro tiene en la mano, grilla · v8 colisiones + personaje caja · v9 editor de personaje, voz, mis salas, compu, registro · v9.1/9.2 pantalla oscura.

## Pendientes

- **Modo admin de salas** (José lo eligió, "no ahora"): usuario con email y contraseña en Firebase Auth (REST, sin SDK, con la Web API key pública) + reglas que dejan leer/borrar todo `salas` solo a su uid; en "mis salas" ver TODAS las salas con miniaturas y borrar una por una o todas. Hace falta activar el proveedor, crear su usuario y cambiar reglas desde su Chrome. Sugerido también: que las fotos de las salas venzan solas (ej. 30 días). Motivo: privacidad y contraseñas olvidadas.
- **Pulir bastante la mecánica principal** (sacar fotos, acomodarlas, construir) y sus submecánicas (modos, grilla, distancia, colisiones, agarrar).
- Su museo personal tiene ~200 fotos (≈160 MB de texturas): si iOS la sigue matando o va lenta, cargar/descargar texturas según distancia.
- Si el registro muestra fotos rotas en su museo, decidir con José qué hacer (borrarlas o reparar los datos).
- Probar en iPhone: efectos de voz (WebAudio sobre el mic puede fallar en Safari; el registro anota "voz: no pude armar el efecto"), editor de personaje, mis salas, colisiones (¿hace falta saltar?), audio espacial, datos móviles.
- Ideas sin decidir: voz que dependa del lugar (reverb en cuartos cerrados de fotos), subir el registro a Firebase solo, toggle "atravesar", toggle para no mandar la vista de la cámara, saltar, agrupar los botones de arriba en un menú, nombres sobre los personajes, guías visuales de la grilla, mejor calidad al hacer zoom.
- TURN si con datos móviles no conecta: José crea cuenta en Metered y pasa app + key.
- "Traer mis fotos" a una sala: José dijo "todavía no".
- Dirección de arrastre: falta que José elija y sacar el toggle.
