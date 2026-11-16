// El pulso de verdad de cada pista que suena en las discotecas (puro): tempo
// (tiempos por minuto) y fase (segundo del primer tiempo) medidos fuera de
// línea sobre los mismos .ogg que trae el juego (public/sounds/musica), con
// un peine de frecuencias sobre los golpes de la pista y el histograma de
// fase del bombo. Con esto la gente de adentro (game/clubLife.js) y el
// minijuego de baile (game/danceGame.js) van al compás de la canción que
// suena y no de un tempo supuesto por estilo.
//
// Para medir una pista nueva: scripts de sonda del repo de trabajo (decodifican
// con OfflineAudioContext y buscan el tempo entre 70 y 200); las pistas sin
// medir siguen con el tempo del estilo (sim/clubLife.js TEMPOS).

/** Clave `emisora/pista` (la misma de game/radio.js) -> [tiempos por minuto, s del primer tiempo]. */
export const PULSOS = {
  'perreo/wayo-wayo': [94.992, 0.025],
  'perreo/put-your-hands-up-dotjot': [94.992, 0.035],
  'perreo/sacudete': [112.974, 0.021],
  'perreo/dont-worry': [90.002, 0.036],
  'perreo/hands-up-cdk': [89.998, 0.193],
  'perreo/island-of-the-sirens': [118.762, 0.075],
  'sabrosa/no-frills-salsa': [108.747, 0.092],
  'sabrosa/no-frills-cumbia': [96.027, 0.054],
  'sabrosa/arroz-con-pollo': [100.016, 0.501],
  'sabrosa/notanico-merengue': [105.008, 0.031],
  'sabrosa/del-rio-bravo': [74.986, 0.006],
  'sabrosa/lamadio-tiado': [90.0, 0.036],
  'parce/put-your-hands-up-reiswerk': [94.99, 0.025],
  'parce/latin-industries': [122.002, 0.027],
  'parce/electro-cabello': [116.99, 0.02],
  'parce/la-tripleta': [96.002, 0.034],
  'parce/future-cha-cha': [140.008, 0.03],
  'parce/ethernight-club': [117.002, 0.028],
};

/**
 * Tempo de la pista `clave` llevado al más cercano (en octavas) al tempo
 * `nominal` del estilo: una pista medida a 90 en un club de electrónica de
 * 126 se baila a 90 y no a 180, una de 75 en la fonda (120) a 150. null si
 * la pista no está medida.
 */
export function tempoPista(clave, nominal = 0) {
  const p = PULSOS[clave];
  if (!p) return null;
  let bpm = p[0];
  if (nominal > 0) {
    while (bpm * Math.SQRT2 < nominal) bpm *= 2;
    while (bpm / Math.SQRT2 > nominal) bpm /= 2;
  }
  return bpm;
}

/**
 * Tiempos de la música transcurridos a los `t` segundos de la pista `clave`
 * (contados desde su primer tiempo) al tempo `bpm` (el de tempoPista); null
 * si la pista no está medida.
 */
export function tiempoPista(clave, t, bpm) {
  const p = PULSOS[clave];
  if (!p || !(bpm > 0)) return null;
  return ((t - p[1]) * bpm) / 60;
}
