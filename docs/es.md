# RainViewer

## Qué hace la integración

El mosaico mundial de radares de lluvia de [RainViewer](https://www.rainviewer.com) en Gladys, sin cuenta ni clave de API. Cada lugar se convierte en un dispositivo:

- **Radar de lluvia**: una imagen de cámara del radar centrada en el lugar, sobre un mapa de OpenStreetMap, renovada con cada imagen de radar (cada 10 minutos);
- **Lluvia**: si llueve ahora en el lugar (1 = lluvia);
- **Intensidad de lluvia**: su intensidad aproximada, en mm/h;
- **Lluvia más cercana**: la distancia a la lluvia más cercana, en km (0 cuando llueve en el lugar, 50 cuando no cae lluvia a menos de 50 km);
- **Hora del radar**: la hora de la imagen de radar.

Complementa las integraciones de radar nacionales (Buienradar para los Países Bajos y Bélgica, DWD para Alemania) con una fuente mundial.

## Requisitos

- Gladys Assistant 5.1.0 o posterior.
- Una conexión a Internet: el radar viene de los servidores de RainViewer.
- Al menos un lugar: una casa de Gladys con ubicación (Ajustes → Casas), o un «Otro lugar» de la configuración.

## Instalación

1. En Gladys, abra **Integraciones → Instalar desde GitHub** e introduzca `https://github.com/guim31/gladys-rainviewer`.
2. Acepte el acceso a la ubicación de sus casas: da a cada casa su radar.
3. Abra la pestaña **Descubrimiento** y añada los lugares que desee.

## Configuración

- **Idioma de los nombres de funciones**: inglés, francés, alemán o español (francés por defecto). Se usa al añadir un dispositivo y para la hora del radar.
- **Extensión de la imagen de radar**: Región (unos 500 km, por defecto), País (unos 1.000 km) o Continente (unos 2.000 km). Los valores de lluvia se leen siempre a la escala más fina.
- **Distancia «Lluvia acercándose» (km)**: de 2 a 50 km, 15 por defecto.
- **Otros lugares**: opcional, `Nombre: latitud, longitud` separados por punto y coma, por ejemplo `Oficina: 48.8566, 2.3522; Chalé: 45.92, 6.87`. Renombrar un lugar crea un dispositivo nuevo. Ocho lugares como máximo, casas incluidas.

El botón **Comprobar el radar** lee ahora la última imagen de radar y dice, para cada lugar, si llueve.

## Dispositivos

Los valores se leen en la última imagen de radar, a la escala más fina de la API pública (alrededor de 1 km por píxel en Europa):

- llueve en el lugar cuando el radar ve al menos 15 dBZ a alrededor de 1 km (por debajo, los ecos débiles son como mucho llovizna, a menudo ecos de suelo);
- la intensidad se deduce de la reflectividad con la relación de Marshall-Palmer: una aproximación, a menudo con un factor dos de error, suficiente para distinguir la llovizna del chaparrón;
- la lluvia más cercana se busca en un radio de 50 km.

Fuera de la cobertura radar (océanos, gran parte de África y Asia), el dispositivo solo muestra la hora del radar, y la integración lo indica en su registro.

## Widget del panel

**Radar de lluvia**: la imagen de radar de un lugar, la lluvia que cae allí y la lluvia más cercana, con la hora de la imagen de radar. El ajuste **Mostrar la imagen de radar** oculta la imagen, para un mosaico pequeño. La cámara de cada lugar también funciona en el recuadro de cámara de Gladys y con la acción de escena «Enviar una imagen de cámara».

## Escenas

Disparadores:

- **RainViewer: lluvia acercándose**: la lluvia del radar llega a la distancia configurada de un lugar donde aún no llueve. Una vez por aproximación (también cuando un chubasco empieza en el lugar entre dos imágenes de radar, a 0 km), nunca al arrancar. Variables: lugar, distancia (km).
- **RainViewer: la lluvia ha parado**: el radar no muestra lluvia sobre un lugar desde hace 20 minutos, tras un episodio de lluvia. Variables: lugar, duración de la lluvia (min).

Deje el lugar vacío para todos los lugares. La lluvia que empieza es la función **Lluvia** que pasa a 1, una condición de dispositivo habitual.

Acción:

- **RainViewer: leer la lluvia**: lee la última imagen de radar de un lugar: llueve, intensidad (mm/h), lluvia más cercana (km), hora del radar, para una condición o un mensaje. Falla (en rojo) fuera de la cobertura radar.

## Límites

- La API pública de RainViewer solo sirve las dos últimas horas de radar: sin imágenes de previsión (nowcast), así que la integración vigila la distancia de la lluvia en lugar de predecirla.
- Zoom 7 como máximo y un solo esquema de colores (Universal Blue), como permite la API pública.
- Un radar ve la lluvia, no siempre la nieve; algunos ecos no son lluvia (ecos de suelo, parques eólicos).
- RainViewer no garantiza su disponibilidad: cuando no responde durante 30 minutos, la integración lo indica en Gladys y se reanuda sola.

## Cómo se ha probado

Probada contra la API real de RainViewer: lugares bajo la lluvia, en seco, cerca de la lluvia y fuera de la cobertura radar, un corte de red, y las imágenes de radar comprobadas a simple vista. Las pruebas reproducen teselas de radar reales. Aún no probada en un Gladys real: sus comentarios son bienvenidos en [GitHub](https://github.com/guim31/gladys-rainviewer/issues).

## Créditos y condiciones

Datos de radar de [RainViewer](https://www.rainviewer.com), cuya API gratuita es para uso personal y educativo; la mención «RainViewer» figura en cada imagen y en el widget. Mapa © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright); las teselas del mapa se guardan 30 días en caché, como pide la política de uso de OSM. Esta integración no está afiliada a RainViewer.

## Ayuda

Preguntas y errores: [incidencias de GitHub](https://github.com/guim31/gladys-rainviewer/issues).
