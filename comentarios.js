// juego — comentarios: texto + fotos (de la galería y una captura del juego) + versión y registro.
// Se guardan en la base en `comentarios/` (cualquiera puede escribir uno nuevo, nadie puede leerlos
// salvo José; ver firebase-rules.json). Un workflow del repo privado juego-comentarios los baja y los borra.
// autor 'jose' solo si entró con su cuenta (la base lo verifica con su uid); si no, 'otro'.
// Se carga antes de game.js: acá al cargar no se usa nada de game.js.

const COM_MAX_FOTOS = 4, COM_FOTO_MAX = 1280;
let comFotos = [];                 // dataURLs JPEG ya achicados
let comCapturaPedida = null;       // game.js la llama al terminar de dibujar un cuadro (ver frame())
let comMandando = false;

function comAchicar(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, COM_FOTO_MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      // la base acepta hasta 700.000 letras por foto: si una foto muy detallada se pasa, baja la calidad
      let u = '';
      for (const q of [0.8, 0.65, 0.5, 0.35]) { u = c.toDataURL('image/jpeg', q); if (u.length < 650000) break; }
      res(u);
    };
    img.onerror = () => rej(new Error('no pude abrir la imagen'));
    img.src = src;
  });
}
// captura de lo que se ve en el juego (el canvas de WebGL solo se puede leer justo después de dibujar)
function comCaptura() {
  return new Promise(res => {
    const t = setTimeout(() => { comCapturaPedida = null; res(null); }, 1500);
    comCapturaPedida = url => { clearTimeout(t); res(url); };
  });
}
function comPintarFotos() {
  const cont = document.getElementById('comFotos');
  cont.innerHTML = '';
  comFotos.forEach((f, i) => {
    const m = document.createElement('div'); m.className = 'miniFoto';
    const img = new Image(); img.src = f; m.append(img);
    const x = document.createElement('div'); x.className = 'x'; x.textContent = '✕';
    x.addEventListener('click', () => { comFotos.splice(i, 1); comPintarFotos(); });
    m.append(x); cont.append(m);
  });
  document.getElementById('comMasFoto').style.display = comFotos.length < COM_MAX_FOTOS ? '' : 'none';
}
async function comAbrir() {
  // la captura primero, antes de que el panel tape la pantalla
  if (!comFotos.length) {
    const url = await comCaptura();
    if (url) { try { comFotos.push(await comAchicar(url)); } catch (e) {} }
  }
  document.getElementById('comPanel').style.display = '';
  document.getElementById('comComo').textContent = cuentaAdmin() ? 'va como tuyo (José)' : 'lo leen José y Claude';
  document.getElementById('comEstado').textContent = '';
  comPintarFotos();
}
async function comMandar() {
  if (comMandando) return;
  const texto = document.getElementById('comTexto').value.trim().slice(0, 4000);
  const estado = document.getElementById('comEstado');
  if (!texto && !comFotos.length) { estado.textContent = 'escribí algo o agregá una foto'; return; }
  comMandando = true; estado.textContent = 'mandando…';
  let ahora = '';
  try { ahora = 'AHORA · ' + estadoTxt() + '\n'; } catch (e) {}
  const c = {
    texto, autor: 'otro', v: typeof VERSION === 'string' ? VERSION : '?', t: Date.now(),
    registro: (ahora + diagLog.slice(-200).reverse().join('\n')).slice(0, 90000),
    disp: (navigator.userAgent || '').slice(0, 250), sala: !!(typeof sala === 'object' && sala.active),
  };
  const enviadas = comFotos.slice();
  if (enviadas.length) c.fotos = Object.fromEntries(enviadas.map((f, i) => [String(i), f]));
  let tok = null, aviso = '';
  if (cuentaAdmin()) { tok = await cuentaToken(); if (tok) c.autor = 'jose'; else aviso = ' (como anónimo: tu cuenta no respondió)'; }
  const mandar = () => fetch(`${SALA_DB}/comentarios.json` + (tok ? '?auth=' + encodeURIComponent(tok) : ''), { method: 'POST', body: JSON.stringify(c) });
  try {
    let r = await mandar();
    if (r.status === 401 && c.autor === 'jose') {
      // la base no reconoce esta cuenta como la de José (ej. todavía no está su id en las reglas): va como anónimo
      diag('comentario: la cuenta no es admin para la base, va como otro');
      c.autor = 'otro'; tok = null; aviso = ' (como anónimo: la base no reconoce tu cuenta)';
      r = await mandar();
    }
    if (!r.ok) throw new Error(r.status === 401 ? 'la base no lo aceptó' : 'error ' + r.status);
    diag('comentario: mandado (' + c.autor + ', ' + enviadas.length + ' fotos)');
    if (document.getElementById('comTexto').value.trim().slice(0, 4000) === texto) document.getElementById('comTexto').value = '';
    comFotos = comFotos.filter(f => !enviadas.includes(f));
    document.getElementById('comPanel').style.display = 'none';
    showHint('¡gracias! llegó' + aviso);
  } catch (e) {
    diag('comentario: no se pudo mandar (' + e.message + ')');
    estado.textContent = 'no se pudo mandar: ' + e.message + '. probá de nuevo en un rato.';
  } finally { comMandando = false; }
}
document.addEventListener('DOMContentLoaded', () => {
  const $c = id => document.getElementById(id);
  $c('opcComentario').addEventListener('click', comAbrir);
  $c('comCerrar').addEventListener('click', () => { $c('comPanel').style.display = 'none'; $c('comTexto').blur(); });
  $c('comMandar').addEventListener('click', comMandar);
  $c('comMasFoto').addEventListener('click', () => $c('comArchivo').click());
  $c('comArchivo').addEventListener('change', async e => {
    const fs = [...e.target.files].slice(0, COM_MAX_FOTOS - comFotos.length);
    e.target.value = '';
    for (const f of fs) {
      const u = URL.createObjectURL(f);
      try { comFotos.push(await comAchicar(u)); } catch (err) { $c('comEstado').textContent = 'una foto no se pudo abrir'; }
      URL.revokeObjectURL(u);
      comPintarFotos();
    }
  });
});
