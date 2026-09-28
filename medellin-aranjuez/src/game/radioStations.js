// Emisoras de radio del juego (nombres y frecuencias inventados) y la música
// que suena en cada una. Es la única fuente de verdad de las pistas: de aquí
// salen el script que las baja y procesa (scripts/assets/musica.mjs), el
// letrero de atribución en pantalla y la prueba que exige que cada pista esté
// en ASSETS-CREDITS.md.
//
// Licencias: solo se aceptan obras que permitan redistribuirlas dentro de un
// juego comercial: CC0 o CC BY (con atribución). Nada NC ni ND. Las pistas se
// recortan (algunas), se normalizan a -16 LUFS y se recodifican a Opus; son
// cambios permitidos por CC BY y se declaran en los créditos.
//
// Canciones comerciales famosas (reguetón, salsa, etc. de artistas conocidos)
// NO se pueden incluir: tienen derechos reservados. Se escogió música libre
// de esos géneros en Incompetech (Kevin MacLeod, CC BY 4.0) y ccMixter
// (CC BY 3.0 / 2.5; ccMixter solo acepta remezclas con licencias compatibles
// con las de sus fuentes, así que una remezcla CC BY no arrastra NC).

const INC = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/';
const INC_PAG = (isrc) => `https://incompetech.com/music/royalty-free/index.html?isrc=${isrc}`;
const CC_BY_4 = { licencia: 'CC BY 4.0', licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/' };
const CC_BY_3 = { licencia: 'CC BY 3.0', licenciaUrl: 'https://creativecommons.org/licenses/by/3.0/' };
const CC_BY_25 = { licencia: 'CC BY 2.5', licenciaUrl: 'https://creativecommons.org/licenses/by/2.5/' };

/** Pista de Kevin MacLeod (incompetech.com), CC BY 4.0. */
const kevin = (id, titulo, archivo, isrc, extra = {}) => ({
  id,
  titulo,
  artista: 'Kevin MacLeod',
  fuente: INC_PAG(isrc),
  descarga: INC + encodeURIComponent(archivo),
  ...CC_BY_4,
  ...extra,
});

/**
 * Pista de ccMixter (la licencia se leyó en la página de cada una). `usa`:
 * obras de ccMixter que la remezcla incorpora (también CC BY; se acreditan).
 */
const ccm = (id, titulo, artista, pagina, descarga, lic, usa = []) => ({ id, titulo, artista, fuente: pagina, descarga, ...lic, usa });
/** Obra de origen de una remezcla de ccMixter. */
const fuente = (titulo, autor, url, licencia = 'CC BY 3.0') => ({ titulo, autor, url, licencia });
// La voz de "Put your Hands Up" que usan varias remezclas de reguetón.
const PUT_YOUR_HANDS_UP = fuente('Put your Hands Up (Acapella)', 'Andrés Franco (andrewfranco)', 'https://ccmixter.org/files/andrewfranco/23076');

export const EMISORAS = [
  {
    id: 'sabrosa',
    nombre: 'La Sabrosa',
    frecuencia: '92.4',
    genero: 'Salsa, cumbia y tropical',
    color: '#ff7a3d',
    pistas: [
      kevin('no-frills-salsa', 'No Frills Salsa', 'No Frills Salsa.mp3', 'USUAN1100133'),
      kevin('no-frills-cumbia', 'No Frills Cumbia', 'CumbiaNoFrillsFaster.mp3', 'USUAN1100892'),
      kevin('arroz-con-pollo', 'Arroz Con Pollo', 'Arroz Con Pollo.mp3', 'USUAN1800011'),
      kevin('notanico-merengue', 'Notanico Merengue', 'Notanico Merengue.mp3', 'USUAN1100130'),
      kevin('del-rio-bravo', 'Del Rio Bravo', 'Del Rio Bravo.mp3', 'USUAN1900031'),
      ccm('lamadio-tiado', 'Lamadio Tiado (Hot Cha Cha Mix)', 'Coruscate', 'https://ccmixter.org/files/Coruscate/70326', 'https://ccmixter.org/content/Coruscate/Coruscate_-_Lamadio_Tiado_(Hot_Cha_Cha_Mix)_1.mp3', CC_BY_3, [fuente('Lamadio Tiado Vocals', 'SackJo22', 'https://ccmixter.org/files/SackJo22/33441')]),
    ],
  },
  {
    id: 'perreo',
    nombre: 'Perreo FM',
    frecuencia: '100.6',
    genero: 'Reguetón y dancehall',
    color: '#e040fb',
    pistas: [
      ccm('wayo-wayo', 'Wayo Wayo (Summer Edition)', 'wellman', 'https://ccmixter.org/files/wellman/22358', 'https://ccmixter.org/content/wellman/wellman_-_Wayo_Wayo-Summer_Edition.mp3', CC_BY_3, [
        fuente('Jhonblack - Wayo Wayo', 'Andrés Franco (andrewfranco), voz de Jhonblack', 'https://ccmixter.org/files/andrewfranco/21090'),
        fuente('hooked on fonics synth', 'cdk', 'https://ccmixter.org/files/cdk/6936', 'CC BY 2.5'),
      ]),
      ccm('put-your-hands-up-dotjot', "Put Your Hands Up (dotjot's summer party mix)", 'dotjot', 'https://ccmixter.org/files/dotjot/67321', 'https://ccmixter.org/content/dotjot/dotjot_-_Put_Your_Hands_Up_(dotjots_summer_party_mix).mp3', CC_BY_3, [PUT_YOUR_HANDS_UP]),
      ccm('sacudete', 'Sacúdete', 'Yuyo MC', 'https://ccmixter.org/files/yuyomc/3428', 'https://ccmixter.org/content/yuyomc/yuyomc_-_SACUDETE.mp3', CC_BY_25),
      ccm('dont-worry', "Don't Worry (original mix '12)", 'DanScrew', 'https://ccmixter.org/files/DanScrew/40426', 'https://ccmixter.org/content/DanScrew/DanScrew_-_Don_t_worry_(original_mix_12).mp3', CC_BY_3, [fuente('Brake Dance', 'Andrés Franco (andrewfranco)', 'https://ccmixter.org/files/andrewfranco/33929')]),
      ccm('hands-up-cdk', 'Hands Up (cdk Island Mix)', 'cdk', 'https://ccmixter.org/files/cdk/39541', 'https://ccmixter.org/content/cdk/cdk_-_Hands_Up_(cdk_Island_Mix).mp3', CC_BY_3, [PUT_YOUR_HANDS_UP]),
      ccm('island-of-the-sirens', 'Put Your Hands Up (island of the sirens mix)', 'shagrugge', 'https://ccmixter.org/files/shagrugge/23788', 'https://ccmixter.org/content/shagrugge/shagrugge_-_Put_Your_Hands_Up_(island_of_the_sirens_mix).mp3', CC_BY_3, [PUT_YOUR_HANDS_UP]),
    ],
  },
  {
    id: 'parce',
    nombre: 'Parce Radio',
    frecuencia: '97.8',
    genero: 'Guaracha y electrónica',
    color: '#26c6da',
    pistas: [
      ccm('put-your-hands-up-reiswerk', 'Put Your Hands Up', 'Reiswerk', 'https://ccmixter.org/files/Reiswerk/56836', 'https://ccmixter.org/content/Reiswerk/Reiswerk_-_Put_your_hands_up.mp3', CC_BY_3, [PUT_YOUR_HANDS_UP]),
      kevin('latin-industries', 'Latin Industries', 'Latin Industries.mp3', 'USUAN1200015'),
      kevin('electro-cabello', 'Electro Cabello', 'Electro Cabello.mp3', 'USUAN1400048'),
      ccm('la-tripleta', 'La Tripleta', 'virtualdjmax', 'https://ccmixter.org/files/virtualdjmax/16150', 'https://ccmixter.org/content/virtualdjmax/virtualdjmax_-_LA_TRIPLETA.mp3', CC_BY_3),
      kevin('future-cha-cha', 'Future Cha Cha', 'Future Cha Cha.mp3', 'USUAN1100374'),
      kevin('ethernight-club', 'Ethernight Club', 'Ethernight Club.mp3', 'USUAN2100002'),
    ],
  },
  {
    id: 'chill',
    nombre: 'Chill Comuna 4',
    frecuencia: '88.2',
    genero: 'Lo-fi para el trancón',
    color: '#9ccc65',
    kbps: 48, // lo-fi: el filtro y el ruido propios del género esconden la compresión
    pistas: [
      ccm('good-night', 'Good Night', 'John Dope', 'https://ccmixter.org/files/JohnDope/60163', 'https://ccmixter.org/content/JohnDope/JohnDope_-_Good_Night_1.mp3', CC_BY_3, [fuente('Kalimba Impromptu June 05,2018', 'HanAra', 'https://ccmixter.org/files/HanAra/57730')]),
      ccm('perspective', 'perspective', 'Darkroom (mactonite)', 'https://ccmixter.org/files/mactonite/65604', 'https://ccmixter.org/content/mactonite/mactonite_-_perspective.mp3', CC_BY_3, [fuente('Perspectives', 'SackJo22', 'https://ccmixter.org/files/SackJo22/60306')]),
      kevin('chill', 'Chill', 'Chill.mp3', 'USUAN1100375'),
      kevin('chillin-hard', 'Chillin Hard', 'Chillin Hard.mp3', 'USUAN1600028'),
      kevin('hackbeat', 'Hackbeat', 'Hackbeat.mp3', 'USUAN1100805'),
      kevin('bossa-antigua', 'Bossa Antigua', 'Bossa Antigua.mp3', 'USUAN1700069'),
    ],
  },
];

/** Licencias que se aceptan para la música del juego (redistribución comercial). */
export const LICENCIAS_OK = ['CC0', 'CC BY 4.0', 'CC BY 3.0', 'CC BY 2.5'];

/** Ruta pública (relativa a la base de Vite) del archivo de una pista. */
export const rutaPista = (emisora, pista) => `sounds/musica/${emisora.id}/${pista.id}.ogg`;
