/**
 * Fotos del catalogo. Todas vienen de Wikimedia Commons con licencia libre y
 * estan empaquetadas en la app (`public/fotos/`, 640x360 en WebP) para que
 * abra sin conexion. Las licencias CC BY y CC BY-SA exigen credito: por eso
 * cada foto guarda autor, licencia y enlace a su pagina en Commons, y la app
 * lo muestra en el detalle del parche.
 *
 * Un parche puede tener varias fotos, que la tarjeta pasa en carrusel. Un
 * parche sin entrada aqui se dibuja con un patron generado a partir de su id,
 * no con la foto de otro sitio.
 *
 * Este archivo se genera: ver README, seccion "Fotos y creditos".
 */

export interface CreditoFoto {
  /** Ruta relativa dentro de la app. */
  archivo: string
  autor: string
  licencia: string
  licenciaUrl: string
  pagina: string
}

export const FOTOS: Record<string, CreditoFoto[]> = {
  'atanasio-girardot': [
    {
      archivo: "fotos/atanasio-girardot-1.webp",
      autor: "Harrysaurio",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Estadio_Atanasio_Girardot.jpg",
    },
    {
      archivo: "fotos/atanasio-girardot-2.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Estadio_Atanasio_Girardot-Medellin.JPG",
    },
    {
      archivo: "fotos/atanasio-girardot-3.webp",
      autor: "User34790",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Atanasio_Girardot_2025-08-16.jpg",
    },
  ],
  'bello-parque-santander': [
    {
      archivo: "fotos/bello-parque-santander-1.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Santander(2)-Bello.JPG",
    },
    {
      archivo: "fotos/bello-parque-santander-2.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Santander-Bello.JPG",
    },
    {
      archivo: "fotos/bello-parque-santander-3.webp",
      autor: "Lsanmarm",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_de_Bello-Antioquia.jpg",
    },
  ],
  'biblioteca-epm': [
    {
      archivo: "fotos/biblioteca-epm-1.webp",
      autor: "Jorge Láscar from Australia",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:EPM_Library_(Biblioteca_EPM)_(5083056568).jpg",
    },
    {
      archivo: "fotos/biblioteca-epm-2.webp",
      autor: "SajoR",
      licencia: "Public domain",
      licenciaUrl: "https://commons.wikimedia.org",
      pagina: "https://commons.wikimedia.org/wiki/File:BiBlioteca_EPM-Medellin.JPG",
    },
    {
      archivo: "fotos/biblioteca-epm-3.webp",
      autor: "SajoR",
      licencia: "Public domain",
      licenciaUrl: "https://commons.wikimedia.org",
      pagina: "https://commons.wikimedia.org/wiki/File:Biblioteca_EPM-Interior-Medellin.JPG",
    },
  ],
  'biblioteca-piloto': [
    {
      archivo: "fotos/biblioteca-piloto-1.webp",
      autor: "Alejandro Rojas (SajoR)",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Biblioteca_P%C3%BAblica_Piloto_-_Entrada_principal_-_Medellin_1.jpg",
    },
    {
      archivo: "fotos/biblioteca-piloto-2.webp",
      autor: "Alejandro Rojas (SajoR)",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Biblioteca_P%C3%BAblica_Piloto_-_Sala_General_primer_piso_-_Medellin_1.jpg",
    },
  ],
  'caldas-parque': [
    {
      archivo: "fotos/caldas-parque-1.webp",
      autor: "~~×α£đ~~es",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "http://creativecommons.org/licenses/by-sa/3.0/",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_de_Caldas.JPG",
    },
  ],
  'carlos-e-parque': [
    {
      archivo: "fotos/carlos-e-parque-1.webp",
      autor: "Miguel Olaya from Bogotá, Colombia",
      licencia: "CC BY-SA 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Carlos_E._Restrepo_(3182497944).jpg",
    },
  ],
  'cerro-el-picacho': [
    {
      archivo: "fotos/cerro-el-picacho-1.webp",
      autor: "Luis90f",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Panor%C3%A1mica_de_Medell%C3%ADn_desde_el_Cerro_El_Picacho.jpg",
    },
    {
      archivo: "fotos/cerro-el-picacho-2.webp",
      autor: "Camilogc04",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Vista_Picacho.jpg",
    },
  ],
  'cerro-el-volador': [
    {
      archivo: "fotos/cerro-el-volador-1.webp",
      autor: "Kamilokardona",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Vista_del_Ecoparque_Cerro_El_Volador._Medell%C3%ADn._Colombia.JPG",
    },
    {
      archivo: "fotos/cerro-el-volador-2.webp",
      autor: "XalD",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Panor%C3%A1mica_desde_el_Cerro_El_Volador_hacia_la_Fiscal%C3%ADa.jpg",
    },
  ],
  'cerro-la-asomadera': [
    {
      archivo: "fotos/cerro-la-asomadera-1.webp",
      autor: "XalD",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Cerro_de_La_Asomadera_desde_el_cerro_Nutibara.jpg",
    },
  ],
  'cerro-nutibara': [
    {
      archivo: "fotos/cerro-nutibara-1.webp",
      autor: "Paco Godoy",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Pueblito_Paisa,_Medell%C3%ADn.JPG",
    },
    {
      archivo: "fotos/cerro-nutibara-2.webp",
      autor: "Edgar Jiménez",
      licencia: "CC BY-SA 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Pueblito_Paisa-Navidad_2008-Medellin.jpg",
    },
    {
      archivo: "fotos/cerro-nutibara-3.webp",
      autor: "Paco Godoy",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Entrando_al_Pueblito_Paisa.JPG",
    },
  ],
  'cerro-quitasol': [
    {
      archivo: "fotos/cerro-quitasol-1.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Cerro_Quitasol-Bello.JPG",
    },
  ],
  'cerro-tres-cruces': [
    {
      archivo: "fotos/cerro-tres-cruces-1.webp",
      autor: "Luis90f",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Sur_de_Medellin_desde_el_Cerro_de_las_Tres_Cruces.jpg",
    },
  ],
  'ciclovia-medellin': [
    {
      archivo: "fotos/ciclovia-medellin-1.webp",
      autor: "Secretaría de Movilidad de Medellín",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Parques_del_R%C3%ADo_Medell%C3%ADn_-_ciclov%C3%ADa_en_soterrado,_2019.jpg",
    },
  ],
  'comuna-13': [
    {
      archivo: "fotos/comuna-13-1.webp",
      autor: "Bernard Gagnon",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Comuna_13,_Medell%C3%ADn_03.jpg",
    },
    {
      archivo: "fotos/comuna-13-2.webp",
      autor: "Bernard Gagnon",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Graffiti_in_Comuna_13,_Medell%C3%ADn_01.jpg",
    },
    {
      archivo: "fotos/comuna-13-3.webp",
      autor: "Bernard Gagnon",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Graffiti_in_Comuna_13,_Medell%C3%ADn_04.jpg",
    },
  ],
  'copacabana-parque': [
    {
      archivo: "fotos/copacabana-parque-1.webp",
      autor: "XalD",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "http://creativecommons.org/licenses/by-sa/3.0/",
      pagina: "https://commons.wikimedia.org/wiki/File:Copacabana-iglesia06.jpg",
    },
    {
      archivo: "fotos/copacabana-parque-2.webp",
      autor: "XalD",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "http://creativecommons.org/licenses/by-sa/3.0/",
      pagina: "https://commons.wikimedia.org/wiki/File:Copacabana-iglesia17.jpg",
    },
  ],
  'ditaires': [
    {
      archivo: "fotos/ditaires-1.webp",
      autor: "John Jairo Estrada",
      licencia: "CC BY-SA 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Ditaires.jpg",
    },
  ],
  'ecoparque-el-salado': [
    {
      archivo: "fotos/ecoparque-el-salado-1.webp",
      autor: "ChuliPichuli",
      licencia: "CC BY-SA 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Ecoparque_Los_Salados_de_Envigado.jpg",
    },
    {
      archivo: "fotos/ecoparque-el-salado-2.webp",
      autor: "ChuliPichuli",
      licencia: "CC BY-SA 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Ecoparque_Los_Salados_de_Envigado(2).jpg",
    },
    {
      archivo: "fotos/ecoparque-el-salado-3.webp",
      autor: "ChuliPichuli",
      licencia: "CC BY-SA 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Ecoparque_Los_Salados_de_Envigado(3).jpg",
    },
  ],
  'envigado-parque-principal': [
    {
      archivo: "fotos/envigado-parque-principal-1.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2019_Envigado_-_Parque_Principal.jpg",
    },
    {
      archivo: "fotos/envigado-parque-principal-2.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Fuente_Parque_Principal_de_Envigado.JPG",
    },
    {
      archivo: "fotos/envigado-parque-principal-3.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2019_Envigado_-_Edificios_en_el_Parque_Principal_de_Envigado.jpg",
    },
  ],
  'guarne-parque': [
    {
      archivo: "fotos/guarne-parque-1.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_principal_Guarne_-_Antioquia.jpg",
    },
  ],
  'itagui-parque-obrero': [
    {
      archivo: "fotos/itagui-parque-obrero-1.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Fuente_y_Estatua_de_Bolivar-Itagui.JPG",
    },
  ],
  'jardin-botanico': [
    {
      archivo: "fotos/jardin-botanico-1.webp",
      autor: "George Donnelly",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Jard%C3%ADn_Bot%C3%A1nico_de_Medell%C3%ADn-_Lago.jpg",
    },
    {
      archivo: "fotos/jardin-botanico-2.webp",
      autor: "TitiNicola",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Jard%C3%ADn_Bot%C3%A1nico_Medell%C3%ADn_1.jpg",
    },
    {
      archivo: "fotos/jardin-botanico-3.webp",
      autor: "XalD",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "http://creativecommons.org/licenses/by-sa/3.0/",
      pagina: "https://commons.wikimedia.org/wiki/File:Jard%C3%ADn_Bot%C3%A1nico_Medell%C3%ADn_edif.JPG",
    },
  ],
  'jardin-circunvalar': [
    {
      archivo: "fotos/jardin-circunvalar-1.webp",
      autor: "ALONSOZAR",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:BARRIO_COLORIDO_JARDIN_CIRCUNVALAR_MEDELLIN.jpg",
    },
    {
      archivo: "fotos/jardin-circunvalar-2.webp",
      autor: "ALONSOZAR",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:BALCON_DE_MEDELLIN_JARDIN_CIRCUNVALAR_2015.jpg",
    },
    {
      archivo: "fotos/jardin-circunvalar-3.webp",
      autor: "ALONSOZAR",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:MEDELLIN_ENTRE_REJAS_JARDIN_CIRCUNVALAR_2015.jpg",
    },
  ],
  'la-4-sur': [
    {
      archivo: "fotos/la-4-sur-1.webp",
      autor: "Yimicorrea",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Puente_atirantado_Gilberto_Echeverri_-_de_la_4_sur_-_Medell%C3%ADn.JPG",
    },
    {
      archivo: "fotos/la-4-sur-2.webp",
      autor: "Secretaría de Movilidad de Medellín",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Puente_de_la_4_sur,_2019.jpg",
    },
  ],
  'la-estrella-parque': [
    {
      archivo: "fotos/la-estrella-parque-1.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Principal_de_La_Estrella.JPG",
    },
    {
      archivo: "fotos/la-estrella-parque-2.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Principal_de_La_Estrella(1).JPG",
    },
  ],
  'la-presidenta': [
    {
      archivo: "fotos/la-presidenta-1.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_quebrada_La_Presidenta.jpg",
    },
    {
      archivo: "fotos/la-presidenta-2.webp",
      autor: "Waterresource",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Quebrada_La_Presidenta,_Medell%C3%ADn.jpg",
    },
    {
      archivo: "fotos/la-presidenta-3.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_Quebrada_La_Presidenta.jpg",
    },
  ],
  'la-romera': [
    {
      archivo: "fotos/la-romera-1.webp",
      autor: "Josefito123",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Ecologico_La_Romera_20220704_065605.jpg",
    },
  ],
  'mamm': [
    {
      archivo: "fotos/mamm-1.webp",
      autor: "Andrés Molina Mesa",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Museo_de_Arte_Moderno_de_Medell%C3%ADn_-_Fachada.jpg",
    },
    {
      archivo: "fotos/mamm-2.webp",
      autor: "Yimicorrea",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Museo_de_arte_moderno_de_-_Medell%C3%ADn_-.JPG",
    },
    {
      archivo: "fotos/mamm-3.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Vista_del_Museo_de_Arte_Moderno_de_Medellin.jpg",
    },
  ],
  'mirador-las-palmas': [
    {
      archivo: "fotos/mirador-las-palmas-1.webp",
      autor: "Yeyereales",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Mirador_de_Las_Palmas,_Medell%C3%ADn,_Antiquia.jpg",
    },
  ],
  'museo-el-castillo': [
    {
      archivo: "fotos/museo-el-castillo-1.webp",
      autor: "XalD",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:El_Castillo-frente.JPG",
    },
    {
      archivo: "fotos/museo-el-castillo-2.webp",
      autor: "XalD",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:El_Castillo-fuente.JPG",
    },
  ],
  'parque-arvi': [
    {
      archivo: "fotos/parque-arvi-1.webp",
      autor: "Paco Godoy",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Bosque_Parque_Arv%C3%AD.JPG",
    },
    {
      archivo: "fotos/parque-arvi-2.webp",
      autor: "Alejandro Rojas (SajoR)",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Metrocable_del_Parque_Arv%C3%AD_-_Medell%C3%ADn.jpg",
    },
  ],
  'parque-de-las-luces': [
    {
      archivo: "fotos/parque-de-las-luces-1.webp",
      autor: "Jorge Láscar from Australia",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:La_Plaza_de_Cisneros_(Cisneros_Square)_AKA._Plaza_de_la_Luz_(Light_Square)_(5083061058).jpg",
    },
    {
      archivo: "fotos/parque-de-las-luces-2.webp",
      autor: "Jorge Láscar from Australia",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:La_Plaza_de_Cisneros_(Cisneros_Square)_AKA._Plaza_de_la_Luz_(Light_Square)_(5082463525).jpg",
    },
    {
      archivo: "fotos/parque-de-las-luces-3.webp",
      autor: "Jorge Láscar",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Plaza_de_Cisneros_Medellin_Colombia.jpg",
    },
  ],
  'parque-de-los-deseos': [
    {
      archivo: "fotos/parque-de-los-deseos-1.webp",
      autor: "Jorge Láscar from Australia",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Park_of_the_Wishes_(Parque_de_los_Deseos)_(5083080664).jpg",
    },
    {
      archivo: "fotos/parque-de-los-deseos-2.webp",
      autor: "Jorge Láscar from Australia",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Park_of_the_Wishes_(Parque_de_los_Deseos)_(5083082956).jpg",
    },
    {
      archivo: "fotos/parque-de-los-deseos-3.webp",
      autor: "Zack Knowles",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Constellation_Globe,_Parque_de_los_Deseos_-_panoramio.jpg",
    },
  ],
  'parque-del-periodista': [
    {
      archivo: "fotos/parque-del-periodista-1.webp",
      autor: "SajoR",
      licencia: "Public domain",
      licenciaUrl: "https://commons.wikimedia.org",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_del_Periodista.JPG",
    },
  ],
  'parque-explora': [
    {
      archivo: "fotos/parque-explora-1.webp",
      autor: "XalD",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "http://creativecommons.org/licenses/by-sa/3.0/",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Explora-exterior.JPG",
    },
    {
      archivo: "fotos/parque-explora-2.webp",
      autor: "XalD",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "http://creativecommons.org/licenses/by-sa/3.0/",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Explora-acceso.JPG",
    },
    {
      archivo: "fotos/parque-explora-3.webp",
      autor: "User: (WT-shared) CONOCER at wts wikivoyage",
      licencia: "Public domain",
      licenciaUrl: "https://commons.wikimedia.org",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Explora._from_Metrostation_Universidad,_Medell%C3%ADn.jpg",
    },
  ],
  'parque-norte': [
    {
      archivo: "fotos/parque-norte-1.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Norte(1)-Medellin.JPG",
    },
    {
      archivo: "fotos/parque-norte-2.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 2.5",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/2.5",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Norte(3)-Medellin.JPG",
    },
    {
      archivo: "fotos/parque-norte-3.webp",
      autor: "SajoR",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Alumbrados_2017_-_Sector_Parque_Norte_(15).jpg",
    },
  ],
  'perpetuo-socorro': [
    {
      archivo: "fotos/perpetuo-socorro-1.webp",
      autor: "Yimicorrea",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Vista_de_la_Iglesia_del_Perpetuo_Socorro_al_centro_-_Medell%C3%ADn.JPG",
    },
    {
      archivo: "fotos/perpetuo-socorro-2.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_zona_posterior_de_la_Parroquia_del_Perpetuo_Socorro.jpg",
    },
  ],
  'pies-descalzos': [
    {
      archivo: "fotos/pies-descalzos-1.webp",
      autor: "HaseyJDBS",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_de_los_Pies_Descalzos_01.jpg",
    },
    {
      archivo: "fotos/pies-descalzos-2.webp",
      autor: "HaseyJDBS",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_de_los_Pies_Descalzos_03.jpg",
    },
    {
      archivo: "fotos/pies-descalzos-3.webp",
      autor: "SajoR",
      licencia: "Public domain",
      licenciaUrl: "https://commons.wikimedia.org",
      pagina: "https://commons.wikimedia.org/wiki/File:Parque_Pies_Descalzos-AreaVerde-Medellin.JPG",
    },
  ],
  'placita-de-florez': [
    {
      archivo: "fotos/placita-de-florez-1.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_Placita_de_Fl%C3%B3rez.jpg",
    },
  ],
  'plaza-botero': [
    {
      archivo: "fotos/plaza-botero-1.webp",
      autor: "Steffen Schmitz (more photos)",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Medell%C3%ADn,_Plaza_Botero,_2023-07_CN-01.jpg",
    },
    {
      archivo: "fotos/plaza-botero-2.webp",
      autor: "Juancllinasl",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Palacio_Municipal_de_Medell%C3%ADn_-_Museo_de_Antioquia.JPG",
    },
    {
      archivo: "fotos/plaza-botero-3.webp",
      autor: "Juancllinasl",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Palacio_Municipal_de_Medell%C3%ADn_-_Museo_de_Antioquia_2.JPG",
    },
  ],
  'plaza-minorista': [
    {
      archivo: "fotos/plaza-minorista-1.webp",
      autor: "Free Walking Tours Medellin",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Minorista_Plaza.jpg",
    },
    {
      archivo: "fotos/plaza-minorista-2.webp",
      autor: "TEspiral",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Canasta_de_guayaba_verde_en_la_plaza_de_mercado_Minorista_de_Medell%C3%ADn.jpg",
    },
  ],
  'provenza': [
    {
      archivo: "fotos/provenza-1.webp",
      autor: "José Luiz",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Provenza_-_Carrera_35_-_Medell%C3%ADn_-_Colombia_2024.jpg",
    },
    {
      archivo: "fotos/provenza-2.webp",
      autor: "Xemenendura",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Provenza,_Medell%C3%ADn_o.jpg",
    },
    {
      archivo: "fotos/provenza-3.webp",
      autor: "Iho jose",
      licencia: "CC0",
      licenciaUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
      pagina: "https://commons.wikimedia.org/wiki/File:Provenza_en_la_noche_de_viernes_en_Medell%C3%ADn.jpg",
    },
  ],
  'rionegro-parque-libertad': [
    {
      archivo: "fotos/rionegro-parque-libertad-1.webp",
      autor: "Kamilokardona",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Cordova_del_Maestro_Rodrigo_Arenas_Betancur_en_El_parque_de_la_libertad_._Rionegro_(Antioquia).JPG",
    },
    {
      archivo: "fotos/rionegro-parque-libertad-2.webp",
      autor: "Kamilokardona",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Campanario_de_la_Concatedral_de_San_Nicol%C3%A1s_el_Magno_de_Rionegro.JPG",
    },
  ],
  'ruta-n': [
    {
      archivo: "fotos/ruta-n-1.webp",
      autor: "Jordi Kf",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Ruta_n.jpg",
    },
    {
      archivo: "fotos/ruta-n-2.webp",
      autor: "Dr EG from Medellin, Colombia",
      licencia: "CC BY 2.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/2.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Ruta_N_medellin.JPG",
    },
  ],
  'sabaneta-parque-principal': [
    {
      archivo: "fotos/sabaneta-parque-principal-1.webp",
      autor: "Tokota",
      licencia: "CC BY 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Sabaneta_Parque.JPG",
    },
    {
      archivo: "fotos/sabaneta-parque-principal-2.webp",
      autor: "Cquiran",
      licencia: "CC BY 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Iglesia_santa_ana_sabaneta.jpg",
    },
  ],
  'santa-elena-silleteros': [
    {
      archivo: "fotos/santa-elena-silleteros-1.webp",
      autor: "Andreasuescun",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Monumento_silleteros_Santa_Elena.JPG",
    },
    {
      archivo: "fotos/santa-elena-silleteros-2.webp",
      autor: "Andreasuescun",
      licencia: "CC BY-SA 3.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Iglesia_Santa_Elena.JPG",
    },
  ],
  'santo-domingo-metrocable': [
    {
      archivo: "fotos/santo-domingo-metrocable-1.webp",
      autor: "JoranL",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Biblioteca_de_Espa%C3%B1a_and_Metrocable_01.jpg",
    },
    {
      archivo: "fotos/santo-domingo-metrocable-2.webp",
      autor: "Bernard Gagnon",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:Estaci%C3%B3n_Santo_Domingo,_Medell%C3%ADn_01.jpg",
    },
  ],
  'teatro-pablo-tobon': [
    {
      archivo: "fotos/teatro-pablo-tobon-1.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2018_Medell%C3%ADn_Teatro_Pablo_Tob%C3%B3n_Uribe.jpg",
    },
    {
      archivo: "fotos/teatro-pablo-tobon-2.webp",
      autor: "SajoR",
      licencia: "Public domain",
      licenciaUrl: "https://commons.wikimedia.org",
      pagina: "https://commons.wikimedia.org/wiki/File:Teatro_Pablo_Tobon_Uribe-Medellin.JPG",
    },
    {
      archivo: "fotos/teatro-pablo-tobon-3.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2018_jardines_del_Teatro_Pablo_Tob%C3%B3n_Uribe.jpg",
    },
  ],
  'zona-fucsia': [
    {
      archivo: "fotos/zona-fucsia-1.webp",
      autor: "Felipe Restrepo Acosta",
      licencia: "CC BY-SA 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina: "https://commons.wikimedia.org/wiki/File:2018_carrera_42_con_avenida_Maracaibo_Medell%C3%ADn.jpg",
    },
  ],
}

/** Fotos de un parche, en orden. Lista vacia si no tiene ninguna. */
export function fotosDe(id: string): CreditoFoto[] {
  return FOTOS[id] ?? []
}
