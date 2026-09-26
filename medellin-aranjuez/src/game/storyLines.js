// Historia: capítulo 1, "El regreso". Solo datos (sin DOM): lo usan el juego
// (src/game/story.js y la cinemática, con subtítulos) y el generador de voces
// (scripts/assets/voces.mjs, que produce public/sounds/historia/<id>.ogg con
// las mismas voces clonadas de la calle).
//
// Santiago "Santi" Ríos vuelve a Aranjuez después de seis años trabajando por
// fuera. Su abuela, Doña Rosa, tiene una tienda frente a la 92 y debe el
// arriendo del local: cinco mil barras (cinco millones de pesos; en el juego,
// $5.000) o la sacan a fin de mes.

/** Personajes: nombre en el subtítulo y voz (ver VOICES en dialogueLines.js). */
export const STORY_CAST = {
  santi: { name: 'Santi', voice: 'h2' },
  rosa: { name: 'Doña Rosa', voice: 'm1' },
  oscar: { name: 'Don Óscar', voice: 'h3' },
};

/**
 * Estilo de la actuación (Chatterbox): exag = exageración emocional,
 * cfg = guía (más bajo = más suelto), level = nivel en dB.
 */
export const STORY_STYLE = {
  calmo: { exag: 0.45, cfg: 0.5, level: -1 },
  normal: { exag: 0.55, cfg: 0.5, level: 0 },
  emocion: { exag: 0.7, cfg: 0.4, level: 1 },
};

/** Cada línea: { id, who, text, tts?, style? } (tts: cómo se pronuncia). */
export const STORY_LINES = [
  // Cinemática de entrada.
  { id: 'intro-01', who: 'santi', text: 'Seis años por fuera… y el barrio sigue igualito.', style: 'calmo' },
  { id: 'intro-02', who: 'santi', text: 'La 92, las mandingas, la iglesia… hasta el olor es el mismo.', tts: 'La noventa y dos, las mandingas, la iglesia… hasta el olor es el mismo.', style: 'calmo' },
  { id: 'intro-03', who: 'rosa', text: '¡Ay, Dios mío! ¡Santiago! ¿Usted por qué no me avisó que venía, mijo?', style: 'emocion' },
  { id: 'intro-04', who: 'santi', text: 'Quería darle la sorpresa, abuela. ¿Y cómo va la tienda?' },
  { id: 'intro-05', who: 'rosa', text: 'Mal, mijo. El dueño del local quiere el arriendo atrasado: cinco mil barras, o nos saca a fin de mes.' },
  { id: 'intro-06', who: 'santi', text: 'Tranquila, abuela. Yo le consigo esa plata.' },
  { id: 'intro-07', who: 'rosa', text: 'Hable con Don Óscar, el de Mandingas La 92. Él siempre necesita quién le haga los domicilios.', tts: 'Hable con Don Óscar, el de Mandingas la noventa y dos. Él siempre necesita quién le haga los domicilios.' },
  // Don Óscar, al empezar el primer encargo.
  { id: 'oscar-01', who: 'oscar', text: '¿Usted es el nieto de Doña Rosa? Hágale pues, que tengo pedidos por todo el barrio.' },
  // Cuando la plata no alcanza.
  { id: 'rosa-falta', who: 'rosa', text: 'Todavía no alcanza, mijo. Pero vamos bien, ¿oyó?', style: 'calmo' },
  // Final del capítulo.
  { id: 'final-01', who: 'rosa', text: '¡Mijo, usted sí es un berraco! Con esto pagamos el arriendo y nos sobra pa\'l mercado.', style: 'emocion' },
  { id: 'final-02', who: 'santi', text: 'Esto apenas empieza, abuela. Aranjuez es mi casa.', style: 'calmo' },
];

export const STORY_LINE = Object.fromEntries(STORY_LINES.map((l) => [l.id, l]));

/** Archivo de audio de una línea de la historia. */
export const storyVoiceFile = (id) => `sounds/historia/${id}.ogg`;

/** Pasos del capítulo 1 (ver StorySystem en story.js). */
export const CHAPTER_1 = {
  id: 'cap1',
  title: 'Capítulo 1: El regreso',
  rent: 5000,
  steps: [
    { id: 'oscar', kind: 'mission', mission: 'mandingas', poi: 'mandingas92', text: 'Habla con Don Óscar en Mandingas La 92' },
    { id: 'plata', kind: 'money', text: 'Reúne $5.000 para el arriendo de la tienda', hint: 'Los encargos (¡ en el mapa) y los lugares por descubrir dan plata.' },
    { id: 'pagar', kind: 'talk', poi: 'abuela', text: 'Lleva la plata a tu abuela en la Tienda Doña Rosa' },
  ],
};
