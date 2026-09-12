/**
 * Traduccion al ingles del catalogo. Los nombres propios se dejan en espanol a
 * proposito: es lo que dice el letrero, lo que entiende un taxista y lo que se
 * busca en un mapa. Lo que se traduce es todo lo demas, y cuando el nombre es
 * puramente descriptivo se anade la parte generica en ingles.
 */

export interface TraduccionParche {
  nombre: string
  sector: string
  descripcion: string
  comoLlegar?: string
  notaHorario?: string
  advertencia?: string
}

const REF = 'Indicative hours: double-check before you head out, they shift on holidays and in season.'

export const PARCHES_EN: Record<string, TraduccionParche> = {
  'jardin-botanico': {
    nombre: 'Jardín Botánico Joaquín Antonio Uribe',
    sector: 'Aranjuez / North side',
    descripcion:
      'Fourteen hectares of urban forest with a lake, the Orquideorama and plenty of picnic lawn. Free to enter and full of shade: the cheapest, greenest Sunday in the city.',
    comoLlegar: 'Universidad Metro station (line A), one block away.',
    notaHorario: REF,
  },
  'parque-explora': {
    nombre: 'Parque Explora',
    sector: 'Aranjuez / North side',
    descripcion:
      'Hands-on science museum with a freshwater aquarium, a physics hall and the planetarium next door. Built to be touched: the best plan with kids on a rainy day.',
    comoLlegar: 'Universidad Metro station (line A).',
    notaHorario: 'Closed on Mondays. ' + REF,
  },
  'parque-de-los-deseos': {
    nombre: 'Parque de los Deseos',
    sector: 'Aranjuez / North side',
    descripcion:
      'A sandy plaza facing the planetarium where people sit and talk late into the evening. Free open-air cinema and concerts are programmed here.',
    comoLlegar: 'Universidad Metro station (line A).',
    notaHorario: 'The cultural programme changes every month.',
  },
  'cerro-nutibara': {
    nombre: 'Cerro Nutibara and Pueblito Paisa',
    sector: 'Nutibara / Guayabal',
    descripcion:
      'A replica Antioquian village on top of a hill, with the best panorama of the valley. The climb is short but steep; up top there are crafts and traditional food.',
    comoLlegar: 'Industriales Metro station, then a walk or a short taxi ride.',
    notaHorario: REF,
  },
  'cerro-el-volador': {
    nombre: 'Cerro El Volador',
    sector: 'Robledo / Universidad Nacional',
    descripcion:
      'The largest of the city’s hills: dirt trails, bamboo groves and a flat summit where people watch the sunset. A classic for running, or for flying kites in August.',
    comoLlegar: 'Caribe or Universidad Metro station (line A).',
    notaHorario: 'Best to come down before dark. ' + REF,
    advertencia:
      'Climb in daylight and with company: the trails empty out and there are occasional robberies.',
  },
  'parque-arvi': {
    nombre: 'Parque Arví',
    sector: 'Santa Elena township',
    descripcion:
      'A high Andean forest reserve with guided trails, a farmers’ market and cold mountain air. The cable-car ride over the canopy is worth the trip on its own.',
    comoLlegar: 'Metrocable line L from Santo Domingo Savio station (line K).',
    notaHorario: 'The Metrocable to Arví does not run on Mondays. ' + REF,
  },
  'comuna-13': {
    nombre: 'Comuna 13 – San Javier escalators',
    sector: 'San Javier / Las Independencias',
    descripcion:
      'Graffiti, hip hop and neighbourhood memory along a set of outdoor escalators up the hillside. Packed at weekends; guides from the barrio tell the story themselves.',
    comoLlegar: 'San Javier Metro station (line B), then a feeder bus or a walk.',
    notaHorario: 'The escalators run until around 21:00.',
    advertencia:
      'It gets very crowded at weekends. Go with guides from the barrio itself, stay on the route and ask before photographing people.',
  },
  'plaza-botero': {
    nombre: 'Plaza Botero and Museo de Antioquia',
    sector: 'La Candelaria / Downtown',
    descripcion:
      'Twenty-three Botero sculptures out in the open in front of the museum that holds his work. The plaza is free and always busy; the museum charges, with occasional free days.',
    comoLlegar: 'Parque Berrío Metro station (line A).',
    notaHorario: 'Museum hours. The plaza is public space. ' + REF,
  },
  mamm: {
    nombre: 'Museo de Arte Moderno de Medellín (MAMM)',
    sector: 'Ciudad del Río',
    descripcion:
      'Contemporary art inside a former steelworks in Ciudad del Río, with a cinema, a terrace and a shop. The park across the street fills with skaters at dusk.',
    comoLlegar: 'Industriales Metro station (line A), a 10-minute walk.',
    notaHorario: 'Closed on Mondays. ' + REF,
  },
  'casa-de-la-memoria': {
    nombre: 'Casa de la Memoria museum',
    sector: 'Boston / Bicentenario',
    descripcion:
      'A free museum devoted to the memory of the armed conflict and its victims. Hard and necessary; you leave understanding the city you are hanging out in.',
    comoLlegar: 'Bicentenario tram station (line T-A).',
    notaHorario: 'Closed on Mondays. ' + REF,
  },
  'pies-descalzos': {
    nombre: 'Parque de los Pies Descalzos (Barefoot Park)',
    sector: 'Alpujarra / Downtown',
    descripcion:
      'Sand, bamboo and water jets made for walking barefoot in the middle of downtown. The EPM library and the water museum are right next door.',
    comoLlegar: 'Alpujarra Metro station (line A).',
    notaHorario: REF,
  },
  'biblioteca-epm': {
    nombre: 'EPM public library',
    sector: 'Alpujarra / Downtown',
    descripcion:
      'Wide reading rooms, wifi and tables to study or work at without buying anything. One of the best free options downtown if you need somewhere quiet.',
    comoLlegar: 'Alpujarra Metro station (line A).',
    notaHorario: REF,
  },
  'biblioteca-piloto': {
    nombre: 'Biblioteca Pública Piloto',
    sector: 'Carlos E. Restrepo',
    descripcion:
      'A historic library holding the city’s photographic archive, in a neighbourhood full of cafés and bookshops. Carlos E. is one of the few genuinely walkable districts.',
    comoLlegar: 'Suramericana Metro station (line B).',
    notaHorario: REF,
  },
  'ruta-n': {
    nombre: 'Ruta N',
    sector: 'Sevilla / North side',
    descripcion:
      'An innovation hub with open floors and tech and startup events most weeks. A good way into the city’s working crowd.',
    comoLlegar: 'Hospital Metro station (line A).',
    notaHorario: 'Access to the halls depends on what is programmed. ' + REF,
  },
  'parque-norte': {
    nombre: 'Parque Norte',
    sector: 'Aranjuez / North side',
    descripcion:
      'The city’s classic amusement park: roller coaster, lake and rides for every age. Pay per wristband or per ride.',
    comoLlegar: 'Universidad Metro station (line A).',
    notaHorario: 'Mostly open at weekends and on public holidays. ' + REF,
  },
  'atanasio-girardot': {
    nombre: 'Atanasio Girardot sports complex',
    sector: 'Estadio / Laureles',
    descripcion:
      'A public sports complex with a running track, courts, outdoor gym and pools. People jog around it at every hour, and on match days the whole district is a party.',
    comoLlegar: 'Estadio Metro station (line B).',
    notaHorario: 'Some venues charge or need booking. ' + REF,
  },
  'aeroparque-juan-pablo-ii': {
    nombre: 'Aeroparque Juan Pablo II',
    sector: 'Belén / Guayabal',
    descripcion:
      'A skating track, courts and lawns beside Olaya Herrera airport. A Sunday plan with family, a bike and planes taking off overhead.',
    comoLlegar: 'Buses along La 70, or Metroplús Industriales and a short taxi ride.',
    notaHorario: REF,
  },
  'ciclovia-medellin': {
    nombre: 'Medellín Ciclovía',
    sector: 'Several corridors across the city',
    descripcion:
      'Dozens of kilometres closed to cars for cycling, running or walking. It is free, it belongs to everyone, and it is probably the most democratic plan in the city.',
    comoLlegar: 'Many stretches; several pass close to Metro stations.',
    notaHorario: 'Sunday and holiday mornings, plus some weekday evenings. ' + REF,
  },
  'cerro-tres-cruces': {
    nombre: 'Cerro de las Tres Cruces',
    sector: 'Belén / La Palma',
    descripcion:
      'A demanding climb that fills from five in the morning with people working out. At the top there are bars, a 360-degree view and someone selling orange juice.',
    comoLlegar: 'Buses towards Belén Las Violetas or La Palma.',
    notaHorario: 'Go early, and with company. ' + REF,
  },
  'jardin-circunvalar': {
    nombre: 'Jardín Circunvalar and Camino de la Vida',
    sector: 'Eastern hillside / Comuna 8',
    descripcion:
      'A path along the eastern hillside linking working-class barrios with allotments, lookouts and eco-parks. The full view of the valley, without paying a peso.',
    comoLlegar: 'Ayacucho tram and Metrocable line M to Trece de Noviembre.',
    notaHorario: REF,
    advertencia:
      'Walk the path by day and in a group; it runs through working-class hillside barrios and is better with someone who knows it.',
  },
  'parque-lleras': {
    nombre: 'Parque Lleras',
    sector: 'El Poblado',
    descripcion:
      'The tourist heart of Medellín nightlife: bars, restaurants and people from everywhere around a small square. Expensive and loud, but an obligatory classic.',
    comoLlegar: 'Poblado Metro station (line A), then a bus or a long walk.',
    notaHorario: 'Every venue keeps its own hours. ' + REF,
    advertencia:
      'This is where scopolamine robberies against foreigners are reported most: over five hundred cases by 2026, mostly men approached through dating apps. Do not accept drinks you did not see poured, and do not leave with someone you just met.',
  },
  provenza: {
    nombre: 'Provenza',
    sector: 'El Poblado',
    descripcion:
      'Tree-lined streets full of chef-led restaurants, specialty coffee and design shops. The priciest district in the city, but worth walking just for the atmosphere.',
    comoLlegar: 'Poblado Metro station (line A) and the circular bus.',
    notaHorario: REF,
  },
  'parque-del-poblado': {
    nombre: 'Parque del Poblado',
    sector: 'El Poblado',
    descripcion:
      'Enormous ceiba trees, benches and the usual crowd sitting on the rim of the fountain. El Poblado’s default meeting point, and it costs nothing.',
    comoLlegar: 'Poblado Metro station (line A), a 15-minute walk.',
    advertencia:
      'Quiet by day; at night it is the warm-up for the Lleras nightlife, with phone snatching and dealing in the open. Watch your things and never leave your drink unattended.',
  },
  'ciudad-del-rio': {
    nombre: 'Ciudad del Río',
    sector: 'Ciudad del Río',
    descripcion:
      'A new district around the MAMM: grass, food trucks, skateboards and people walking the dog. Relaxed, and kinder on the wallet than El Poblado.',
    comoLlegar: 'Industriales Metro station (line A).',
    notaHorario: REF,
  },
  'mercado-del-rio': {
    nombre: 'Mercado del Río',
    sector: 'Ciudad del Río',
    descripcion:
      'A covered food hall with dozens of stalls from all over the world and long shared tables. Works for a family lunch as well as dinner with friends.',
    comoLlegar: 'Industriales Metro station (line A).',
    notaHorario: REF,
  },
  'carrera-70': {
    nombre: 'La 70',
    sector: 'Estadio / Laureles',
    descripcion:
      'Paisa nightlife for real: salsa, tango, vallenato and sancocho at midnight. Cheaper and more local than El Poblado, two blocks from the stadium.',
    comoLlegar: 'Estadio or Floresta Metro station (line B).',
    notaHorario: REF,
    advertencia:
      'It gets rough in the small hours: heavy drinking, the odd fight and phone snatching. Head back by taxi or app.',
  },
  'la-33': {
    nombre: 'La 33',
    sector: 'Laureles',
    descripcion:
      'A strip of bars and restaurants in Laureles with terraces out on the street. Neighbourhood feel, mid-range prices and a good mix of ages.',
    comoLlegar: 'Estadio Metro station (line B) or Metroplús.',
    notaHorario: REF,
  },
  'perpetuo-socorro': {
    nombre: 'Distrito Perpetuo Socorro',
    sector: 'Perpetuo Socorro',
    descripcion:
      'An old district of workshops and warehouses turned creative quarter: chef-led kitchens, galleries, murals and design studios.',
    comoLlegar: 'Industriales Metro station (line A).',
    notaHorario: REF,
  },
  'plaza-minorista': {
    nombre: 'Plaza Minorista José María Villa',
    sector: 'Cisneros / Downtown',
    descripcion:
      'The largest market hall in the city: fruit, herbs, juices and three-thousand-peso lunches. Come hungry and without a schedule.',
    comoLlegar: 'Cisneros Metro station (line B).',
    notaHorario: REF,
    advertencia:
      'It is a huge, crowded market: bring little cash, no jewellery, and keep your phone in your pocket.',
  },
  'placita-de-florez': {
    nombre: 'Placita de Flórez',
    sector: 'La Candelaria / Downtown',
    descripcion:
      'A traditional market with flowers, plants and local food. It looks its best in December and during the silletero season.',
    comoLlegar: 'San Antonio Metro station and a walk, or the tram (line T-A).',
    notaHorario: REF,
    advertencia:
      'You are downtown: go by day, with little cash and your phone put away.',
  },
  'parque-de-las-luces': {
    nombre: 'Parque de las Luces (Plaza Cisneros)',
    sector: 'Cisneros / Downtown',
    descripcion:
      'Three hundred light masts over a hard plaza beside the EPM library and the Carré building. At night it is one of the postcards of downtown.',
    comoLlegar: 'Alpujarra or Cisneros Metro station.',
    notaHorario: 'Best visited early in the evening, and with company.',
    advertencia:
      'The plaza is hard-surfaced and very exposed, and the area empties at night. Go early and with company.',
  },
  'la-presidenta': {
    nombre: 'Parque Lineal La Presidenta',
    sector: 'El Poblado',
    descripcion:
      'A path along the stream with trees, farmers’ markets on Saturdays and people out running. A free breather in the middle of El Poblado.',
    comoLlegar: 'Buses along Avenida El Poblado; Poblado Metro station.',
    notaHorario: REF,
  },
  'museo-el-castillo': {
    nombre: 'Museo El Castillo',
    sector: 'El Poblado / Los Balsos',
    descripcion:
      'A Gothic-style house museum with French gardens and a view over the valley. Quiet, unusual and surprisingly cheap for the area.',
    notaHorario: REF,
  },
  'teatro-pablo-tobon': {
    nombre: 'Teatro Pablo Tobón Uribe',
    sector: 'Boston / Downtown',
    descripcion:
      'A historic theatre with a season of dance, music and performing arts, plus a café and a bookshop. Many shows cost less than a night out at a bar.',
    comoLlegar: 'Prado Metro station (line A) or Bicentenario tram.',
    notaHorario: 'Depends on the programme. ' + REF,
  },
  'parque-juanes-de-la-paz': {
    nombre: 'Parque Juanes de la Paz',
    sector: 'La Cruz / Comuna 3',
    descripcion:
      'A hillside sports ground with courts, an outdoor gym and a view over the valley. A neighbourhood plan, free and very busy at weekends.',
    comoLlegar: 'Metrocable line K to Andalucía, then a feeder bus.',
    notaHorario: REF,
  },
  'santo-domingo-metrocable': {
    nombre: 'Santo Domingo Savio lookout',
    sector: 'Santo Domingo Savio / Comuna 1',
    descripcion:
      'The Metrocable ride over the north-eastern barrios and the terrace beside the Parque Biblioteca España, with one of the best views of the valley. The library building has been under works, but the lookout and the district are still the plan.',
    comoLlegar: 'Metrocable line K from Acevedo Metro station.',
    notaHorario: 'Follows Metrocable hours. ' + REF,
    advertencia:
      'Go during the day and stay around the station and the library.',
  },
  'envigado-parque-principal': {
    nombre: 'Envigado main square',
    sector: 'Central Envigado',
    descripcion:
      'A small-town square inside the metropolitan area: a church, benches, corner shops and good traditional restaurants all around it.',
    comoLlegar: 'Envigado Metro station (line A), then a bus or a walk.',
    notaHorario: 'The places around the square close around midnight.',
  },
  'ecoparque-el-salado': {
    nombre: 'Ecoparque El Salado',
    sector: 'El Escobero (rural Envigado)',
    descripcion:
      'Forest, a stream and trails with camping areas and barbecue pits. The closest nature plan if you are in the south of the valley.',
    comoLlegar: 'Envigado buses towards El Escobero.',
    notaHorario: REF,
  },
  'sabaneta-parque-principal': {
    nombre: 'Sabaneta main square',
    sector: 'Central Sabaneta',
    descripcion:
      'A southern tradition: the Santa Ana church, chorizo and arepa on the street, and bars around the square playing until late. Cheap and very paisa.',
    comoLlegar: 'Sabaneta Metro station (line A), then a bus or a walk.',
    notaHorario: 'Bars around the square close in the small hours at weekends.',
  },
  'la-romera': {
    nombre: 'La Romera nature reserve',
    sector: 'Alto de la Romera',
    descripcion:
      'Cloud forest with trails, howler monkeys and a view over the valley. A classic mountain-bike climb out of Sabaneta.',
    notaHorario: 'Access can be restricted for conservation. ' + REF,
  },
  ditaires: {
    nombre: 'Parque Ditaires',
    sector: 'Ditaires',
    descripcion:
      'A large public park with lakes, a running track, courts and pools. One of the best free public spaces in the south of the valley.',
    comoLlegar: 'Itagüí Metro station (line A), then a bus or a walk.',
    notaHorario: 'The pools and some venues charge. ' + REF,
  },
  'itagui-parque-obrero': {
    nombre: 'Itagüí main square',
    sector: 'Central Itagüí',
    descripcion:
      'The town’s central square, with shops, street food and the feel of a working town. A good, cheap place to meet.',
    comoLlegar: 'Itagüí Metro station (line A).',
  },
  'la-estrella-parque': {
    nombre: 'La Estrella main square',
    sector: 'Central La Estrella',
    descripcion:
      'A mountain town stuck to the edge of the metro area, with cool air and traditional food around the square. The base for climbing Cerro El Romeral.',
    comoLlegar: 'La Estrella Metro station (line A), then a bus.',
  },
  'cerro-el-romeral': {
    nombre: 'Cerro El Romeral',
    sector: 'Alto El Romeral',
    descripcion:
      'One of the peaks closing the valley to the south: mist, low páramo scrub and the full panorama of the metro area. A long hike, or a climb by bike.',
    notaHorario: 'Go early; the mist rolls in during the afternoon. ' + REF,
  },
  'caldas-parque': {
    nombre: 'Caldas main square',
    sector: 'Central Caldas',
    descripcion:
      'The far south of the valley, with cool air and small-town prices. A good starting point for the swimming holes and hamlets nearby.',
    comoLlegar: 'Buses from Itagüí or La Estrella Metro stations.',
  },
  'bello-parque-santander': {
    nombre: 'Parque Santander, Bello',
    sector: 'Central Bello',
    descripcion:
      'The heart of the most populated town in the north of the valley: shops, street food and a lot of neighbourhood life. Cheap and well connected.',
    comoLlegar: 'Bello or Niquía Metro station (line A).',
  },
  'cerro-quitasol': {
    nombre: 'Cerro Quitasol',
    sector: 'North end of the Aburrá Valley',
    descripcion:
      'A demanding hike up the peak that closes the valley to the north, with a view from end to end of the metro area. Go in a group and set off early.',
    comoLlegar: 'Niquía Metro station (line A), then transport to the trailhead.',
    notaHorario: 'Check safety and weather conditions before climbing.',
  },
  'copacabana-parque': {
    nombre: 'Copacabana main square',
    sector: 'Central Copacabana',
    descripcion:
      'A quiet town in the north of the valley, warm and full of weekend family life. A good destination for a short, cheap trip out.',
    comoLlegar: 'Niquía Metro station, then buses to Copacabana.',
  },
  'girardota-basilica': {
    nombre: 'Girardota main square and Señor Caído basilica',
    sector: 'Central Girardota',
    descripcion:
      'A traditional pilgrimage destination in the north of the valley, with a square, shops and local food around it. On Sundays it fills with pilgrims.',
    comoLlegar: 'Buses from Niquía station or the Terminal del Norte.',
    notaHorario: REF,
  },
  'barbosa-charcos': {
    nombre: 'Barbosa swimming holes',
    sector: 'Villages along the river',
    descripcion:
      'The north end of the valley is swimming-hole country: cold water, big rocks and a barbecue with the family. Go early and respect the warnings about flash floods.',
    comoLlegar: 'Buses from the Terminal del Norte in Medellín.',
    notaHorario: 'Stay out of the river in heavy rain.',
  },
  'rionegro-parque-libertad': {
    nombre: 'Parque La Libertad, Rionegro',
    sector: 'Central Rionegro',
    descripcion:
      'The historic square of the Antioquian Oriente, with a cathedral, museums nearby and very good food. Cool air and the feel of a large town.',
    comoLlegar: 'Buses from the Terminal del Norte or del Sur towards Rionegro.',
  },
  'guarne-parque': {
    nombre: 'Guarne main square',
    sector: 'Central Guarne',
    descripcion:
      'The first town of the Oriente on the way out of Medellín: cold air, arepa de mote and bakeries. A short escape when you do not want to drive far.',
    comoLlegar: 'Buses from the Terminal del Norte along the Medellín–Bogotá road.',
  },
  'piedras-blancas': {
    nombre: 'Piedras Blancas eco park',
    sector: 'Piedras Blancas',
    descripcion:
      'Pine forest, a reservoir, trails and a stone museum in the Santa Elena township. Cold, quiet and less than an hour from the city.',
    comoLlegar: 'Metrocable line L to Arví and local transport, or the Santa Elena road.',
    notaHorario: REF,
  },
  'santa-elena-silleteros': {
    nombre: 'Silletero flower farms, Santa Elena',
    sector: 'Santa Elena hamlets',
    descripcion:
      'Silletero families open their farms to show how the flower arrangements of the Feria de las Flores are built, with gardens and country cooking.',
    comoLlegar: 'Metrocable line L to Arví, or buses from downtown along the Santa Elena road.',
    notaHorario: 'Many farms ask you to book ahead. ' + REF,
  },
  'parque-del-periodista': {
    nombre: 'Parque del Periodista',
    sector: 'La Candelaria / Downtown',
    descripcion:
      'A small downtown square that has been the meeting point of alternative Medellín since the eighties: punks, rockers, rappers, students and poets buying beer at the corner shop and drinking it on the pavement. Long-standing bars like El Eslabón and El Guanábano sit around it.',
    comoLlegar: 'Prado Metro station (line A), a few blocks away.',
    notaHorario: 'The scene builds from Thursday to Saturday at dusk; the bars close in the small hours.',
    advertencia:
      'This is a genuinely permissive zone: people drink in the street and dealing happens in the open, and fights break out now and then. Go with company, keep your phone in your pocket and do not stay until dawn if you do not know the area.',
  },
  'carlos-e-parque': {
    nombre: 'Parque de Carlos E. Restrepo',
    sector: 'Carlos E. Restrepo',
    descripcion:
      'The Carlos E. boulevard is the bohemian corner of Laureles: university lecturers and students, bookshops, cafés and people sitting on the ground with a beer. One of the few places where you can stay for hours without buying anything and nobody minds.',
    comoLlegar: 'Suramericana Metro station (line B).',
    notaHorario: 'Friday afternoons are the busiest; the cafés close around midnight.',
    advertencia:
      'People drink on the pavement as a matter of course, but using drugs in public space is banned by decree in Medellín. At night, mind your phone as you would anywhere.',
  },
  'la-curva-bantu': {
    nombre: 'La Curva (Bantú)',
    sector: 'Barranquilla / Universidad de Antioquia',
    descripcion:
      'The S-bend on Calle Barranquilla opposite the university, where students drink on the pavement because it costs less than inside the bar. People call it Bantú after the bar that gave the corner its name. It fills up Thursday to Sunday and does not stop even during a campus strike.',
    comoLlegar: 'Universidad or Hospital Metro station (line A).',
    notaHorario: 'The scene runs Thursday to Sunday from late afternoon.',
    advertencia:
      'A pavement, poor lighting and a lot of drinking: this is a student hangout, not a bar. Watch your things, do not photograph people without asking, and do not stay on your own into the small hours.',
  },
  'la-4-sur': {
    nombre: 'La 4 Sur skatepark',
    sector: 'Gilberto Echeverri bridge / Guayabal',
    descripcion:
      'The largest skatepark in the city, underneath the 4 Sur bridge. The bridge acts as a roof, so people skate whether it rains or not. Daytime belongs to skaters, BMX and rollers; on Friday and Saturday nights it turns into a party with sound systems and motorbikes.',
    comoLlegar: 'Poblado or Industriales Metro station (line A), about a 15-minute walk.',
    notaHorario: 'Daytime is for skating; the night scene is Friday and Saturday from 19:00.',
    advertencia: 'It gets rowdy at night: a lot of drinking and the odd bit of trouble. With kids, go during the day.',
  },
  'zona-fucsia': {
    nombre: 'Zona Fucsia',
    sector: 'Avenida Maracaibo / Downtown',
    descripcion:
      'The new centre of gravity for LGBTIQ+ nightlife in the city: bars and clubs opened since 2022 along Avenida Maracaibo, between El Palo and carrera 43. Less touristy and a good deal cheaper than El Poblado.',
    comoLlegar: 'Prado Metro station (line A).',
    notaHorario: 'Each venue keeps its own hours; the strip moves Thursday to Saturday.',
    advertencia: 'This is downtown: at night arrive and leave by taxi or app, and do not walk the surrounding streets alone.',
  },
  'calle-barbacoas': {
    nombre: 'Calle Barbacoas',
    sector: 'La Candelaria / Downtown',
    descripcion:
      'One block from Parque Bolívar, behind the cathedral, runs the street that has held up gay life in Medellín since the eighties. It used to be called the Street of Sin and still has the oldest bars in the city, El Machete among them.',
    comoLlegar: 'Parque Berrío or Prado Metro station (line A).',
    notaHorario: 'The street comes alive at night, above all Thursday to Saturday.',
    advertencia:
      'The area is difficult at night and borders the red-light district downtown. Go straight to the bar by taxi or app and do not wander the neighbouring streets.',
  },
  'cerro-la-asomadera': {
    nombre: 'Cerro La Asomadera eco park',
    sector: 'Buenos Aires / Comuna 9',
    descripcion:
      'One of the seven tutelary hills and the most central of them all: nature trails, an outdoor gym, a court and a pool, with the whole valley below. Surprisingly quiet for somewhere this close to downtown.',
    comoLlegar: 'Ayacucho tram to Miraflores, then a walk uphill.',
    notaHorario: 'Indicative hours: double-check before you head out, they shift on holidays and in season.',
  },
  'mirador-las-palmas': {
    nombre: 'Las Palmas lookout',
    sector: 'Vía Las Palmas / El Poblado',
    descripcion:
      'The Medellín postcard at night: from the airport road you see the whole valley lit up. There are two lookouts along the road; the higher one has the better view and several restaurants with terraces.',
    comoLlegar: 'Only reachable by car, taxi or app along the Las Palmas road.',
    notaHorario: 'Each restaurant keeps its own hours; the roadside lookout is public.',
    advertencia: 'There is no public transport up there and the road is all tight bends with heavy motorbike traffic. At night, go by car.',
  },
  'cerro-el-picacho': {
    nombre: 'Cerro El Picacho lookout park',
    sector: 'Doce de Octubre / Comuna 6',
    descripcion:
      'Over 2,000 metres up in the north-west, with one of the most complete panoramas of the Aburrá Valley. The climb is hard and the neighbourhood around it is working class: this is the city seen from where almost nobody looks at it.',
    comoLlegar: 'Metrocable line P from Acevedo to El Progreso, then uphill on foot.',
    notaHorario: 'Best climbed early. Indicative hours: double-check before you head out.',
    advertencia: 'It is a hill in a working-class neighbourhood: go early, go in a group, and ask about conditions on the day before setting off.',
  },
  'cerro-pan-de-azucar': {
    nombre: 'Cerro Pan de Azúcar eco park',
    sector: 'Villa Hermosa / Comuna 8',
    descripcion:
      'The highest of the tutelary hills, with a stone stairway climbing out of Comuna 8. At the top there is birdwatching and the full view of the valley, the city on one side and the Oriente on the other.',
    comoLlegar: 'Ayacucho tram and Metrocable line M to Trece de Noviembre; the trails start there.',
    notaHorario: 'Go early and come down before dark.',
    advertencia: 'Climb in a group and stick to the marked trails.',
  },
}
