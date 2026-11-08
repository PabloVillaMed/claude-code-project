// Diálogos de la calle en español paisa (Medellín): saludos, charlas de los
// vecinos sentados frente a las tiendas, pregones de los venteros, reacciones
// y policía. Es solo datos (sin DOM): lo usan el juego (src/game/dialogue.js,
// subtítulos) y el generador de voces (scripts/assets/voces.mjs, que produce
// public/sounds/voces/<id>-<voz>.ogg con Chatterbox, clonando hablantes
// colombianos de OpenSLR 72).
//
// Cada línea: { id, cat, text, voices, tts?, hours?, kind?, conv?, role? }
//   text   lo que se muestra en el subtítulo
//   tts    (opcional) cómo se le pasa al TTS si hay que ayudarle a pronunciar
//   voices voces en las que existe el audio (ver VOICES)
//   hours  (opcional) [desde, hasta) hora del día en la que tiene sentido
//   kind   (pregones) tipo de ventero
//   conv/role (charlas) número de conversación y quién habla: 'A' o 'B'

/**
 * Voces del barrio. Cada una clona a un hablante colombiano real de OpenSLR 72
 * (el reparto está en CAST de scripts/assets/voces.mjs); radio: filtro de
 * radioteléfono.
 */
export const VOICES = {
  h1: { label: 'Señor mayor', gender: 'm' },
  h2: { label: 'Pelado', gender: 'm' },
  h3: { label: 'Señor', gender: 'm' },
  m1: { label: 'Señora mayor', gender: 'f' },
  m2: { label: 'Muchacha', gender: 'f' },
  m3: { label: 'Señora', gender: 'f' },
  p1: { label: 'Policía', gender: 'm' },
  p2: { label: 'Policía', gender: 'm' },
  r1: { label: 'Central', gender: 'f', radio: true },
  r2: { label: 'Patrulla', gender: 'm', radio: true },
};

/** Voces de la gente del barrio, por género (el orden alterna h/m a propósito). */
export const CIVIL_VOICES = ['h1', 'm1', 'h2', 'm2', 'h3', 'm3'];
export const CIVIL_BY_GENDER = { m: ['h1', 'h2', 'h3'], f: ['m1', 'm2', 'm3'] };
export const POLICE_VOICES = ['p1', 'p2'];

/** Tipos de ventero (coinciden con los props 'vendor' de cityLayout.js). */
export const VENDOR_KINDS = ['minutos', 'frutas', 'mangos', 'arepas', 'helados', 'dulces'];

const LINES = [];

/** Reparte cada texto en `n` voces del barrio, rotando para que todas tengan de todo. */
function spread(cat, texts, n = 2, { prefix = cat, ...extra } = {}) {
  texts.forEach((t, i) => {
    const e = typeof t === 'string' ? { text: t } : t;
    const voices = e.voices ?? Array.from({ length: n }, (_, k) => CIVIL_VOICES[(i * n + k) % CIVIL_VOICES.length]);
    LINES.push({ id: `${prefix}-${String(i + 1).padStart(2, '0')}`, cat, ...extra, ...e, voices });
  });
}

// ------------------------------------------------------------ saludos
// Cuando el jugador pasa caminando cerca (de vez en cuando).
spread('saludo', [
  'Quiubo, ¿qué más pues?',
  '¿Bien o qué, parce?',
  'Quiubo, parcero. ¿Todo bien?',
  '¡Eh, avemaría! ¿Usted por acá?',
  '¿Qué más, vecino? ¿Cómo va la cosa?',
  { text: 'Buenos días, mijo. ¿Cómo amaneció?', hours: [5, 12] },
  { text: 'Buenas tardes, joven.', hours: [12, 18.5] },
  { text: 'Buenas noches, pues. Cuídese.', hours: [18.5, 29] },
  'Pilas pues, no dé papaya por ahí.',
  'Hágale pues, que le vaya bien.',
  'Quiubo, mijo, ¿y su mamá cómo sigue?',
  { text: '¡Qué calor tan berraco el de hoy!', hours: [9, 17] },
  'Uy, parce, ¿y ese milagro por aquí?',
  'Todo bien, todo bonito, ¿o qué?',
  'Que Dios me lo bendiga, mijo.',
  '¡Qué más pues, mi llave!',
  'Oiga, joven, ¿no ha visto un perrito café por ahí?',
  'Buenas, qué pena con usted, ¿me regala la hora?',
  '¡Quiubo, parce! Tanto tiempo sin verlo.',
  'Vea pues, ¿y usted pa\' dónde va tan afanado?',
  'Siga, siga, bien pueda.',
  { text: '¡Ey, qué chimba de día, parce!', hours: [7, 17.5] },
  'Buenas, vecino. Me saluda a la familia.',
]);

// ------------------------------------------------------------ comentarios sueltos
// Alguien quieto o sentado, solo, hablando para sí mismo.
spread('comentario', [
  'Ay, esta rodilla me está matando.',
  'Uy, qué hambre tan berraca. Ya casi es hora del almuerzo.',
  'Como que va a llover. Mejor entro la ropa.',
  '¿Dónde dejaría yo las llaves, Dios mío?',
  'Qué rico un tintico ahora.',
  'Ese bus se demoró más de la cuenta.',
  'Ay, qué pereza tener que subir esa loma.',
  'Hoy sí me gané el día, gracias a Dios.',
  'Uf, qué bochorno. No corre ni una brisa.',
  'Ahorita paso por la tienda a comprar el mecato.',
]);

// ------------------------------------------------------------ charlas
// Vecinos sentados en las sillas plásticas frente a las tiendas. Cada línea
// existe en todas las voces del barrio: la charla usa la voz de cada vecino.
const CHARLAS = [
  // la lluvia
  ['¿Vio cómo se puso el cielo? Ya se viene el aguacero.', 'Sí, y yo con la ropa colgada en la terraza.', 'Pues vaya y la entra, que eso cae es de una.'],
  // fútbol
  ['¿Vos viste el partido del domingo?', '¡Ave María, qué golazo el del segundo tiempo!', 'Sí, pero el árbitro estaba ciego, parce.', 'Tranquilo, que el otro domingo ganamos de una.'],
  // precios
  ['¿Supo que la libra de arroz volvió a subir?', 'No me diga. Con este sueldo ya no alcanza pa\' nada.', 'Toca apretarse el cinturón, ¿qué más hacemos?'],
  // el metro
  ['Mañana me toca madrugar pa\'l centro.', 'Váyase en metro, que en bus se demora una eternidad.', 'Sí, en el metro llega uno en veinte minuticos.'],
  // la fiesta del vecindario
  ['¿Y esa música tan duro anoche?', 'La fiesta de quince de la nieta de doña Gloria.', 'Con razón. Quedé sin dormir, ¡qué pereza!', 'Ay, pero déjela, que eso es una vez en la vida.'],
  // el calor y el tinto
  ['¡Uf, qué bochorno tan berraco!', 'Venga pa\' la sombra y se toma un tinto.', '¿Un tinto con este calor? Mejor una limonada.'],
  // chisme
  ['¿Supo que el hijo de don Álvaro se va pa\' España?', '¡Avemaría! ¿Y quién le va a ayudar en la tienda?', 'Pues el sobrino, que ese pelado sí es juicioso.'],
  // el perro del vecino
  ['Ese perro volvió a ladrar toda la noche.', 'Es que el dueño lo deja solo en la terraza.', 'Pobre animalito. Hay que decirle algo a ese señor.'],
  // el trabajo
  ['¿Y qué, consiguió el camello en la fábrica?', 'Todavía nada, pero me dijeron que el lunes me llaman.', 'Hágale pues, que eso sale. Pilas con el celular.'],
  // el parque del barrio
  ['Dicen que van a arreglar el parque de la esquina.', 'Eso dicen cada año y nada, parce.', 'Esta vez la junta ya consiguió la plata.', 'Pues ojalá, porque esos columpios están en la olla.'],
  // el clima de Medellín
  ['Esta mañana hacía un frío, y mire ahora este solazo.', 'Así es Medellín: las cuatro estaciones en un solo día.'],
  // el trancón
  [{ text: 'El trancón por la 52 estaba horrible hoy.', tts: 'El trancón por la cincuenta y dos estaba horrible hoy.' }, 'Por eso yo me voy es a pie, así sea loma arriba.', 'Usted sí es muy guapo. Yo con esta rodilla no subo.'],
  // las matas
  ['Mire qué bonitas están las matas de la vecina.', 'Ella las riega todos los días, sin falta.', 'Así da gusto sentarse aquí afuera un ratico.'],
  // la tienda ya no fía
  ['Don Julio ya no fía, ¿sí vio el letrero?', 'Normal, si todo el mundo le quedaba debiendo.', 'Pues sí, uno tiene que pagar lo que debe.'],
];
CHARLAS.forEach((conv, c) => {
  conv.forEach((t, k) => {
    const e = typeof t === 'string' ? { text: t } : t;
    LINES.push({ id: `charla-${String(c + 1).padStart(2, '0')}-${k + 1}`, cat: 'charla', conv: c, role: k % 2 ? 'B' : 'A', step: k, ...e, voices: [...CIVIL_VOICES] });
  });
});

// ------------------------------------------------------------ pregones
// Cada ventero repite su pregón cada tanto cuando el jugador está cerca.
const PREGONES = {
  minutos: ['¡Minutos a doscientos, minutos!', '¡Llame a todo operador, a doscientos el minuto!', '¡Minutos, minutos! ¿Va a llamar, mijo?', '¡Hay minutos y recargas, siga no más!'],
  frutas: ['¡Lleve la fruta picada, fresquecita!', '¡Papaya, piña y sandía, a mil el vasito!', '¡Salpicón, salpicón bien frío!', '¡Lulo, maracuyá, guanábana, lleve pues!'],
  mangos: ['¡Mango biche con sal y limón!', '¡Mango maduro, mango biche, lleve, lleve!', '¡El mango biche bien picadito, a dos mil!', '¡Venga, mijo, pruebe el mango sin compromiso!'],
  arepas: ['¡Arepas de chócolo con quesito, calienticas!', '¡Arepa con quesito, arepa con mantequilla!', '¡Chorizo con arepa, bien calientico!', '¡Lleve la arepa recién asada, lleve pues!'],
  helados: ['¡Paletas, paletas de agua y de leche!', '¡Helado, helado, bien frío pa\' este calor!', '¡Raspado de mora y de maracuyá!', '¡Paleta de coco, paleta de mora, a mil quinientos!'],
  dulces: ['¡Dulces, chicles, bombones, lleve pues!', '¡Obleas con arequipe, obleas!', '¡Cocadas, panelitas, lleve el dulcecito!', '¡Maní, maní salado, maní con pasas!'],
};
for (const kind of VENDOR_KINDS) spread('pregon', PREGONES[kind], 3, { kind, prefix: `pregon-${kind}` });

// ------------------------------------------------------------ reacciones
spread('empujon', [
  '¡Ey, pilas pues!',
  '¿Qué le pasa, parcero?',
  '¡Uy, cuidado, pues!',
  '¡Oiga, mire por dónde camina!',
  '¡Ey, despacio, que esto no es una cancha!',
  '¡Ave María, qué atropello!',
  '¡Respete, parce!',
  '¡No empuje, hombre!',
  '¡Ay, mi pie! ¡Fíjese, pues!',
]);

spread('carro', [
  '¡Casi me mata, animal!',
  '¡Ey, frene, frene!',
  '¡Aprenda a manejar, pues!',
  '¿Está loco o qué? ¡Por poco me lleva!',
  '¡Uy, mi Dios, qué susto!',
  '¡Vaya más despacio, que aquí hay niños!',
]);

spread('disparos', [
  '¡Corran, corran!',
  '¡Ave María, están disparando!',
  '¡Al suelo, al suelo!',
  '¡Ay, Dios mío, métanse pa\' la casa!',
  '¡Llamen a la policía!',
  '¡Se armó la balacera!',
  '¡Virgen santísima!',
  '¡Cierren la puerta, cierren!',
]);

spread('apuntado', [
  '¡Tranquilo, tranquilo, parce!',
  '¡No, no, no dispare, por favor!',
  '¡Calmado, hermano, yo no he hecho nada!',
  '¡Baje eso, que yo no tengo nada!',
  '¡Ay, no, por mi mamá, tranquilo!',
  '¡Llévese lo que quiera, pero no me haga nada!',
]);

spread('muerte', [
  '¡Ay, no, qué horror!',
  '¡Ave María purísima! ¡Llamen una ambulancia!',
  '¡Dios mío, no se mueve!',
  '¡Una ambulancia, por favor, una ambulancia!',
  '¡Ay, mi Dios, esto no puede ser!',
  '¡Qué tristeza, Dios mío!',
]);

spread('golpe', ['¡Ay! ¿Por qué me pega?', '¡Auxilio, auxilio!', '¡Ayuda, me quieren robar!', '¡Suélteme, déjeme quieto!'], 3);

// ------------------------------------------------------------ policía
const police = (cat, texts) => spread(cat, texts.map((text) => ({ text, voices: [...POLICE_VOICES] })));
police('policia_alto', ['¡Policía! ¡Quieto ahí!', '¡Alto, policía!', '¡Deténgase! ¡Manos arriba!', '¡Quieto, no se mueva!']);
police('policia_arma', ['¡Suelte el arma!', '¡Tírese al piso! ¡Al piso!', '¡Bote el arma, ya!', '¡Las manos donde las pueda ver!']);
police('policia_rodeo', ['¡Lo tenemos rodeado!', '¡Entréguese, no tiene pa\' dónde coger!', '¡Ríndase, que es por su bien!']);
police('policia_busca', ['Revisen por esa cuadra.', 'Se metió por ese callejón. ¡Pilas!', 'Busquen detrás de las tiendas.', '¿Alguien vio pa\' dónde cogió?', 'Sigan buscando, no puede estar lejos.']);
police('policia_fuego', ['¡Nos están disparando!', '¡Cúbranse, cúbranse!', '¡Necesitamos refuerzos!', '¡Agente herido, agente herido!']);

// Radio de las patrullas: la central pregunta, la patrulla responde.
spread('radio_central', [
  'Central a todas las unidades: sospechoso armado en Aranjuez.',
  'Atentos, individuo huyendo por la parte alta del barrio.',
  'Reportan disparos en el sector. Unidades cercanas, respondan.',
  { text: 'Se solicita apoyo en la comuna 4.', tts: 'Se solicita apoyo en la comuna cuatro.' },
  'Central: confirmen la ubicación del sospechoso.',
].map((text) => (typeof text === 'string' ? { text, voices: ['r1'] } : { ...text, voices: ['r1'] })));
spread('radio_patrulla', [
  'Enterado, central. Vamos en camino.',
  'Patrulla en el sector, cambio.',
  'Perdimos contacto visual, cambio.',
  'Tenemos al sospechoso a la vista.',
  'Afirmativo, cerrando las salidas del barrio.',
].map((text) => ({ text, voices: ['r2'] })));
spread('radio_fin', [
  { text: 'Central, se nos voló. Suspendemos la búsqueda.', voices: ['r2'] },
  { text: 'Recibido. Todas las unidades, regresen a patrullaje.', voices: ['r1'] },
]);

// ------------------------------------------------------------ la calle
// (game/streetLife.js) En las seis voces: cualquiera las puede decir. Sin
// audio todavía (pendingVoice): salen en subtítulos hasta que
// scripts/assets/voces.mjs las genere (ese script genera todas las de LINES).
// Habitantes de calle cuando el jugador pasa caminando cerca.
spread('limosna', [
  '¿Me da cien pesitos, por favor?',
  "¿Me regala cien pesitos, por favor? Pa' un pancito.",
  'Una monedita, mijo, que Dios se lo pague.',
  'Patrón, ¿me colabora con lo que pueda?',
  'Mi amor, una moneda, que hoy no he comido nada.',
  '¿Me da cien pesitos? Lo que sea es bien recibido.',
  "Ayúdeme con cien pesitos, por favor, pa' la aguapanela.",
], 6, { pendingVoice: true });
spread('limosna_gracias', [
  '¡Dios le pague, mijo! Que le vaya bonito.',
  'Gracias, mi amor. Dios me lo bendiga.',
  'Uy, qué persona tan especial. Gracias, patrón.',
  'Que la Virgen me lo acompañe, mijo.',
], 6, { pendingVoice: true });
spread('limosna_nada', ['Bueno, de todas formas, que Dios lo bendiga.', 'Tranquilo, mijo, otro día será.', 'Bueno, siga pues, que le vaya bien.'], 6, { pendingVoice: true });
// Los muchachos de la plaza cuando el jugador se arrima a la esquina.
spread('banda', [
  '¿Qué más, parce? ¿Qué se le ofrece?',
  'Siga derecho, mi llave, que por acá no se le perdió nada.',
  'Pilas, que este parche tiene dueño.',
  'Bien pueda, pero no se ponga a mirar mucho.',
  '¿Usted de dónde es? Por acá no lo había visto.',
  'Quieto ahí, parcero. ¿Busca algo?',
  'Todo bien, todo bien, pero siga caminando.',
], 6, { pendingVoice: true });
// El campanero cuando ve una patrulla.
spread('campanero', ['¡Agua, agua! ¡Llegó la tomba!', '¡Pilas, que viene la ley!', '¡Ojo, muchachos, patrulla en la esquina!'], 6, { pendingVoice: true });
// Al empezar una balacera entre bandas.
spread('balacera', ['¡Nos cayeron, muchachos!', '¡Esos manes se metieron al parche!', '¡A cubrirse, a cubrirse!', '¡Llegaron los de allá arriba!'], 6, { pendingVoice: true });

// ------------------------------------------------------------ la rumba de la 92
// (game/nightlife.js) De noche, frente a las discotecas y bares. Sin audio
// todavía (pendingVoice), como las de la calle.
// Los de los grupos del andén cuando el jugador pasa caminando cerca.
spread('rumba', [
  '¡Eso, parce! Hoy sí hay rumba.',
  '¿Qué más, mi llave? ¿Se viene a bailar o qué?',
  '¿Pa dónde es la vuelta: pa la salsoteca o pa la de reguetón?',
  'Hágale, que la noche está joven.',
  'Uy, esa canción está buenísima, ¡súbanle!',
  'Pídase un guaro, que la próxima la invito yo.',
  'Mañana no se trabaja, ¡a gozar!',
  'Qué nota de noche, ¿cierto?',
  'Ey, ¿usted no es el de la cuadra de abajo?',
  'Ya casi entramos, estamos esperando a la otra parcera.',
  '¡Avemaría, cómo está de llena la 92 hoy!',
  'Vamos a bailar hasta que nos saquen.',
], 6, { pendingVoice: true });
// Los de la fila de la puerta.
spread('rumba_fila', [
  'Esta fila no avanza, hermano.',
  '¿Cuánto está el cover hoy?',
  'Dizque adentro está llenísimo.',
  'Tranquilos, que ya casi nos toca.',
  'Si no entramos aquí, nos vamos pa la fonda.',
], 6, { pendingVoice: true });
// El portero de cada local cuando el jugador llega a la puerta.
spread('portero', [
  'Buenas noches. Documento, por favor.',
  'Hoy hay cover, parcero. Haga la fila.',
  'Haga la fila como todo el mundo, mi llave.',
  'Adentro está lleno; espere un momentico.',
  'Aquí se viene a gozar, no a buscar problemas.',
  'Con armas no entra nadie, ¿listo?',
], 6, { pendingVoice: true });
// El portero si el jugador llega a la puerta con el arma en la mano.
spread('portero_arma', ['¡Ey, ey! Guarde eso, que aquí no se le recibe así.', 'Bájele a eso, parcero, que aquí hay mucha gente.', 'Con eso en la mano no se me arrima a la puerta.'], 6, { pendingVoice: true });

// ------------------------------------------------------------ damas de compañía
// (game/companions.js) De noche en el andén: coqueteo leve y respetuoso, en
// las tres voces de mujer. Sin audio todavía (pendingVoice), como las de la calle.
const damas = (cat, texts) => spread(cat, texts.map((text) => ({ text, voices: CIVIL_BY_GENDER.f })), 3, { pendingVoice: true });
// Cuando el jugador para el carro a su lado.
damas('dama', [
  'Buenas noches, bizcocho. ¿Para dónde va tan solito?',
  '¡Hola, mi amor! ¿Me invita a dar una vuelta?',
  'Qué carro tan bonito. ¿Le provoca compañía un ratico?',
  'Hola, corazón. Si quiere, yo lo acompaño esta noche.',
  '¿Quiubo, mor? ¿Me va a abrir la puerta o qué?',
]);
// Acepta y se sube.
damas('dama_si', [
  'Listo, mi amor. Vamos, pero a un lugar tranquilo.',
  'Hágale pues. Usted maneja y yo le pongo la conversación.',
  'Me encanta. Busquemos un sitio calmadito, ¿sí?',
  'Bueno, corazón, pero sin afanes, ¿listo?',
]);
// Al jugador no le alcanza.
damas('dama_sin_plata', [
  'Ay, mor, con eso no alcanza. Vuelva cuando ande con platica.',
  'Uy, no, bizcocho, así no. Otro día será.',
  'Qué pena, corazón, pero sin plata no hay paseo.',
]);
// Andando, cuando hay gente cerca.
damas('dama_viaje', [
  'Aquí hay mucha gente, mi amor. Busquemos algo más solo.',
  'Por aquí no, que está muy concurrido.',
  'Sigamos un poquito más, donde no haya nadie mirando.',
  'Qué rico este carro… pero sigamos buscando, ¿sí?',
]);
// Hay policía cerca.
damas('dama_tomba', ['Uy, ahí está la tomba. Sigamos derecho, mor.', 'Con la policía ahí no, corazón. Más allá.']);
// Llegaron al lugar tranquilo (antes del fundido).
damas('dama_lugar', ['Aquí sí está bueno, mi amor.', 'Uy, qué tranquilidad aquí. Perfecto.', 'Este sitio está perfecto, corazón.']);
// Se despide al bajarse.
damas('dama_chao', [
  'Gracias, mor. Cuídese mucho, ¿oyó?',
  'Qué noche tan agradable. Chao, bizcocho.',
  'Bueno, corazón, me voy. Maneje con cuidado.',
  'Fue un placer. Ya sabe dónde encontrarme.',
]);
// Asustada (disparos, policía, un choque): se baja y se va.
damas('dama_susto', [
  '¡Ay, no, no, no! ¡Déjeme bajar!',
  '¡Usted está loco! ¡Yo me voy!',
  '¡Pare ese carro, que yo me bajo aquí!',
  '¡Dios mío! ¡Conmigo no cuente para eso!',
]);
// El jugador se bajó y la dejó sola en el carro.
damas('dama_abandono', ['¿Y me va a dejar aquí sola? ¡Qué falta de respeto!', 'Bueno, si se va, yo también me voy.']);

export { LINES };

/** Número de charlas distintas. */
export const CONVERSATIONS = CHARLAS.length;

/** Ruta (relativa al index.html) del audio de una línea en una voz. */
export const voiceFile = (lineId, voice) => `sounds/voces/${lineId}-${voice}.ogg`;
