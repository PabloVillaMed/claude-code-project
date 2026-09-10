/**
 * Fotos del catalogo. Todas vienen de Wikimedia Commons con licencia libre y
 * estan empaquetadas en la app (`public/fotos/<id>.webp`, 640x360) para que
 * abra sin conexion. Las licencias CC BY y CC BY-SA exigen credito: por eso
 * cada foto guarda autor, licencia y enlace a su pagina en Commons, y la app
 * lo muestra en el detalle del parche.
 *
 * Un parche sin entrada aqui se dibuja con un patron generado a partir de su
 * id, no con una foto ajena.
 */

export interface CreditoFoto {
  autor: string
  licencia: string
  licenciaUrl: string
  pagina: string
}

export const FOTOS: Record<string, CreditoFoto> = {
  'atanasio-girardot': {
    autor: "Oo. Denis .oO",
    licencia: "CC BY 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Estadio_Atanasio_Girardot_2024.jpg",
  },
  'bello-parque-santander': {
    autor: "SajoR",
    licencia: "CC BY-SA 2.5",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_Santander(2)-Bello.JPG",
  },
  'biblioteca-epm': {
    autor: "SajoR",
    licencia: "Public domain",
    licenciaUrl: "https://commons.wikimedia.org",
    pagina: "https://commons.wikimedia.org/wiki/File:Biblioteca_EPM-Multimedia-Medellin.JPG",
  },
  'biblioteca-piloto': {
    autor: "Alejandro Rojas (SajoR)",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Biblioteca_P%C3%BAblica_Piloto_-_Entrada_principal_-_Medellin_1.jpg",
  },
  'cerro-el-volador': {
    autor: "SajoR",
    licencia: "CC BY-SA 2.5",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
    pagina: "https://commons.wikimedia.org/wiki/File:Ecoparque_Cerro_El_Volador(1)-Medellin.JPG",
  },
  'cerro-nutibara': {
    autor: "Edgar Jiménez",
    licencia: "CC BY-SA 2.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Pueblito_Paisa-Navidad_2008-Medellin.jpg",
  },
  'cerro-quitasol': {
    autor: "SajoR",
    licencia: "CC BY-SA 2.5",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
    pagina: "https://commons.wikimedia.org/wiki/File:Cerro_Quitasol-Bello.JPG",
  },
  'cerro-tres-cruces': {
    autor: "Luis90f",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Sur_de_Medellin_desde_el_Cerro_de_las_Tres_Cruces.jpg",
  },
  'ciclovia-medellin': {
    autor: "Secretaría de Movilidad de Medellín",
    licencia: "CC BY 2.0",
    licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Parques_del_R%C3%ADo_Medell%C3%ADn_-_ciclov%C3%ADa_en_soterrado,_2019.jpg",
  },
  'comuna-13': {
    autor: "Juan Gómez",
    licencia: "CC BY 2.0",
    licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Escaleras_el%C3%A9ctricas_de_la_comuna_13,_Medell%C3%ADn_-_04.jpg",
  },
  'ditaires': {
    autor: "John Jairo Estrada",
    licencia: "CC BY-SA 2.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_Ditaires.jpg",
  },
  'envigado-parque-principal': {
    autor: "Felipe Restrepo Acosta",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:2019_Envigado_-_Edificios_en_el_Parque_Principal_de_Envigado.jpg",
  },
  'guarne-parque': {
    autor: "SajoR",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_principal_Guarne_-_Antioquia.jpg",
  },
  'jardin-botanico': {
    autor: "User: (WT-shared) CONOCER at wts wikivoyage",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Orquideorama_Jardin_Botanico_4.jpg",
  },
  'jardin-circunvalar': {
    autor: "ALONSOZAR",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:BARRIO_COLORIDO_JARDIN_CIRCUNVALAR_MEDELLIN.jpg",
  },
  'la-presidenta': {
    autor: "Felipe Restrepo Acosta",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_quebrada_La_Presidenta.jpg",
  },
  'la-romera': {
    autor: "Josefito123",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_Ecologico_La_Romera_20220704_065605.jpg",
  },
  'mamm': {
    autor: "Felipe Restrepo Acosta",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:2018_Museo_de_Arte_Moderno_de_Medell%C3%ADn_-_Antiguoss_Talleres_Robledo.jpg",
  },
  'museo-el-castillo': {
    autor: "Zack Knowles",
    licencia: "CC BY-SA 3.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    pagina: "https://commons.wikimedia.org/wiki/File:El_Castillo,_Medell%C3%ADn,_Medellin,_Antioquia,_Colombia_-_panoramio_(2).jpg",
  },
  'parque-arvi': {
    autor: "Alejandro Rojas (SajoR)",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Metrocable_del_Parque_Arv%C3%AD_-_Medell%C3%ADn.jpg",
  },
  'parque-de-los-deseos': {
    autor: "einalem",
    licencia: "CC BY-SA 2.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_de_los_Deseos_-_planetario.jpg",
  },
  'parque-explora': {
    autor: "User: (WT-shared) CONOCER at wts wikivoyage",
    licencia: "Public domain",
    licenciaUrl: "https://commons.wikimedia.org",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_Explora._from_Metrostation_Universidad,_Medell%C3%ADn.jpg",
  },
  'parque-norte': {
    autor: "SajoR",
    licencia: "CC BY-SA 2.5",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_Norte(14)-Medellin.JPG",
  },
  'pies-descalzos': {
    autor: "SajoR",
    licencia: "Public domain",
    licenciaUrl: "https://commons.wikimedia.org",
    pagina: "https://commons.wikimedia.org/wiki/File:Parque_Pies_Descalzos-AreaVerde-Medellin.JPG",
  },
  'placita-de-florez': {
    autor: "Felipe Restrepo Acosta",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_Placita_de_Fl%C3%B3rez.jpg",
  },
  'plaza-botero': {
    autor: "Steffen Schmitz (more photos)",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Medell%C3%ADn,_Plaza_Botero,_2023-07_CN-01.jpg",
  },
  'plaza-minorista': {
    autor: "Free Walking Tours Medellin",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Minorista_Plaza.jpg",
  },
  'rionegro-parque-libertad': {
    autor: "Kamilokardona",
    licencia: "CC BY-SA 3.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Cordova_del_Maestro_Rodrigo_Arenas_Betancur_en_El_parque_de_la_libertad_._Rionegro_(Antioquia).JPG",
  },
  'ruta-n': {
    autor: "Dr EG from Medellin, Colombia",
    licencia: "CC BY 2.0",
    licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Ruta_N_medellin.JPG",
  },
  'sabaneta-parque-principal': {
    autor: "Cquiran",
    licencia: "CC BY 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Iglesia_santa_ana_sabaneta.jpg",
  },
  'santa-elena-silleteros': {
    autor: "Andreasuescun",
    licencia: "CC BY-SA 3.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Monumento_silleteros_Santa_Elena.JPG",
  },
  'santo-domingo-metrocable': {
    autor: "JoranL",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:Biblioteca_de_Espa%C3%B1a_and_Metrocable_01.jpg",
  },
  'teatro-pablo-tobon': {
    autor: "Felipe Restrepo Acosta",
    licencia: "CC BY-SA 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_Teatro_Pablo_Tob%C3%B3n_Uribe.jpg",
  },
}

/** Ruta de la foto empaquetada, o null si el parche no tiene. */
export function rutaFoto(id: string): string | null {
  return id in FOTOS ? `fotos/${id}.webp` : null
}
