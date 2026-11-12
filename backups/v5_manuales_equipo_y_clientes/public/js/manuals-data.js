// Manuales Operativos "Con Peras y Manzanas" por Nivel de Personal
// Se muestran ÚNICAMENTE dentro de las vistas autenticadas (Admin / Ruta)

export const STAFF_MANUALS = {
  duenos: {
    id: "duenos",
    shortTab: "👑 Dueños (Alejandro y Tello)",
    badge: "NIVEL 1 • ACCESO TOTAL Y SUPERVISIÓN",
    title: "Manual para Dueños y Dirección",
    people: "Alejandro y Tello",
    summary:
      "Ustedes tienen la llave maestra de todo el negocio: ven los carros moviéndose en vivo en el mapa, comprueban qué tiendas visitó cada vendedor, fijan el precio mínimo permitido en calle, auditan cortes de dinero/cajas y descargan respaldos.",
    accessNote:
      "Entras al Panel Central (/admin.html) con la Clave Maestra, y cuando sales a vender en carro entras a Modo Chofer (/chofer.html) con tu nombre y tu PIN de 4 dígitos.",
    steps: [
      {
        num: "1",
        icon: "🗺️",
        heading: "Ver a los vendedores en tiempo real y revisar sus visitas",
        bodyHtml:
          "Entra a la pestaña <strong>🗺️ Ruta, GPS y Cortes</strong>. Ahí tienes el mapa de toda la ciudad (puedes tocar <strong>⛶ Pantalla Completa</strong> para dejarlo abierto en monitor o celular):<br>" +
          "• <strong>🚗 Carros y recorrido:</strong> Ves dónde anda cada vendedor ahorita, cuántas cajas trae en la cajuela y la <strong>línea de color</strong> con todas las calles por donde ya pasó hoy.<br>" +
          "• <strong>Semáforo de negocios en el mapa:</strong><br>" +
          "&nbsp;&nbsp;🟢 <strong>Verde:</strong> Ya compró hoy (te dice cuántas cajas y cuánto pagó).<br>" +
          "&nbsp;&nbsp;🟡 <strong>Amarillo:</strong> El vendedor pasó pero no le compraron (el sistema mide con GPS a cuántos metros reales estaba del local para comprobar que sí fue físicamente).<br>" +
          "&nbsp;&nbsp;⚪ <strong>Gris:</strong> Negocios que todavía nadie visita hoy.",
        example:
          "Ejemplo: Si un vendedor dice 'ya pasé a Carnicería San Juan pero tenía fruta', en el mapa verás el punto en 🟡 Amarillo diciendo: 'Visitado por Carlos (GPS a 14 metros)'."
      },
      {
        num: "2",
        icon: "🚨",
        heading: "Foquitos de pedidos nuevos y alarma sonora",
        bodyHtml:
          "Arriba a la derecha toca una vez el botón <strong>🔔 Sonido</strong> para dejar activada la campana.<br>" +
          "• Cada vez que un cliente pide aguacate en línea, suena una campana doble, aparece una <strong>barra roja parpadeante</strong> arriba y se prende un <strong>🔴 Foquito Rojo</strong> en el mapa.<br>" +
          "• Toca ese foquito rojo directamente en el mapa: ahí mismo ves qué pidió y eliges a qué carro cercano asignárselo sin cambiar de pantalla.",
        example:
          "Ejemplo: Prende un 🔴 Foquito Rojo en el centro y ves en el mapa que el carro de Carlos va a 4 cuadras con aguacate Maduro; tocas el foquito, eliges 'Carlos' y cambia a 🔵 Azul (En Ruta)."
      },
      {
        num: "3",
        icon: "🏷️",
        heading: "Fijar Precios del Día y Candado de Precio Mínimo",
        bodyHtml:
          "En la pestaña <strong>🏷️ Precios y Difusión</strong> controlas cada calibre (<strong>Super, Extra, Primera y Media</strong>):<br>" +
          "• <strong>Precio por Caja ($):</strong> El precio público que ven los clientes en la página web y el que sale por defecto.<br>" +
          "• <strong>Mínimo Ruta ($):</strong> Es el piso autorizado. Si en la calle un vendedor intenta cobrar una caja más barata que ese mínimo, su celular no lo deja guardar la venta.",
        example:
          "Ejemplo: Si pones Primera en $320 y Mínimo Ruta en $280, el vendedor puede negociar en $300 o $290, pero jamás malbaratarla en $250."
      },
      {
        num: "4",
        icon: "💰",
        heading: "Revisar el Corte de Cajas y Dinero sin hacer cuentas a mano",
        bodyHtml:
          "En <strong>🗺️ Ruta, GPS y Cortes</strong> (abajo del mapa) están las tarjetas de <strong>Pre-Corte Automático por Chofer</strong>:<br>" +
          "• El sistema cruza solito lo que <strong>Güerita</strong> despachó en almacén contra las notas que el vendedor registró en su celular.<br>" +
          "• Te dice con letras claras: cuántas cajas físicas debe devolver a bodega y exactamente cuánto <strong>Efectivo en billetes</strong> debe entregar en oficina (separando Transferencias y Créditos).",
        example:
          "Ejemplo: Si sacó 30 cajas y vendió 22 en ruta, el sistema marca automático: 'Por devolver a bodega: 8 cajas' y te desglosa cuánto efectivo exacto debes recibir."
      },
      {
        num: "5",
        icon: "🔐",
        heading: "Dar de alta más vendedores, PINs y Respaldos",
        bodyHtml:
          "• En <strong>🚗 Choferes y PIN</strong> puedes cambiar celulares, asignar o cambiar el PIN de 4 dígitos de cualquier vendedor, agregar choferes nuevos cuando crezca la flotilla y mandarles su acceso con <strong>📲 Mandar App</strong>.<br>" +
          "• Con el botón <strong>💾 Respaldar</strong> arriba a la derecha descargas en 1 clic toda la base de datos del negocio a tu computadora o teléfono.",
        example:
          "Recomendación: Descarga un respaldo los sábados al cerrar la semana para tener doble tranquilidad."
      }
    ],
    whatsappText:
      `👑 *MANUAL RÁPIDO DUEÑOS — AGUACATES SALINAS*\n` +
      `*(Para Alejandro y Tello)*\n\n` +
      `1️⃣ *Ver carros y tiendas en vivo:* Entra al Panel Admin -> pestaña *🗺️ Ruta, GPS y Cortes* (puedes tocar *⛶ Pantalla Completa*).\n` +
      `   • Ves cada carro 🚗 moviéndose y la línea de las calles que recorrió hoy.\n` +
      `   • Tiendas en mapa: 🟢 Compró hoy | 🟡 Visitado sin venta (con distancia GPS real) | ⚪ Pendiente.\n\n` +
      `2️⃣ *Foquitos de pedidos nuevos:* Activa *🔔 Sonido* arriba a la derecha. Cuando caiga un pedido sonará campana y prenderá un *🔴 Foquito Rojo* en el mapa; tócalo ahí mismo para asignarlo al carro más cercano.\n\n` +
      `3️⃣ *Precios y Candado Mínimo:* En *🏷️ Precios y Difusión* defines el Precio Web y el *Mínimo Ruta ($)* para que nadie venda abajo del mínimo autorizado.\n\n` +
      `4️⃣ *Cortes sin calculadora:* Abajo del mapa ves el *Pre-Corte Automático* que cruza Almacén vs Ventas en Ruta (cajas exactas a devolver y efectivo exacto a entregar).\n\n` +
      `5️⃣ *Choferes y Respaldo:* En *🚗 Choferes y PIN* administras vendedores/PINs y arriba en *💾 Respaldar* guardas copia de todo el sistema.`
  },

  oficina: {
    id: "oficina",
    shortTab: "💼 Oficina (Liz y Alejandra)",
    badge: "NIVEL 2 • ADMINISTRACIÓN, PEDIDOS Y CORTES",
    title: "Manual de Administración y Oficina",
    people: "Liz y Alejandra",
    summary:
      "Esta guía resume el día a día en Oficina explicado paso a paso: mandar la lista de precios de la mañana sin escribirle uno por uno a 450 clientes, atender los pedidos que caen con alarma, asignarlos al carro correcto y recibir el corte de la tarde en 1 minuto.",
    accessNote:
      "En oficina entran al Panel de Administración (/admin.html). Además, cuando Liz salga a ruta/ventas, también tiene su usuario listo en Modo Chofer (/chofer.html).",
    steps: [
      {
        num: "1",
        icon: "📣",
        heading: "En la mañana: Mandar precios del día a los 450 contactos en 15 segundos",
        bodyHtml:
          "Ya no hay que mandar 450 mensajes uno por uno:<br>" +
          "1. Entra a la pestaña <strong>🏷️ Precios y Difusión</strong>.<br>" +
          "2. Si hoy cambió algún precio o disponibilidad, ajústalo y toca <strong>Guardar y Actualizar Precios en Vivo</strong>.<br>" +
          "3. Toca el botón verde <strong>📋 Copiar Mensaje de Hoy</strong>.<br>" +
          "4. Abre el WhatsApp de la empresa y pégalo en tus <strong>2 Listas de Difusión</strong> (Lista 1 y Lista 2). ¡Se les envía a todos en segundos y con el link para que pidan solos!",
        example:
          "Tip: Los clientes que no quieran hoy no estorban, y los que sí quieran meterán su pedido directo y te prenderá foquito en el mapa."
      },
      {
        num: "2",
        icon: "🔔",
        heading: "Activar la Campana y recibir Pedidos Nuevos",
        bodyHtml:
          "Al abrir el sistema en la computadora o celular de oficina, toca el botón <strong>🔔 Sonido</strong> arriba a la derecha.<br>" +
          "• En cuanto un cliente haga pedido en línea: sonará una campanita, verás arriba una <strong>barra roja parpadeante</strong> y se encenderá un <strong>🔴 Foquito Rojo</strong> en el mapa.<br>" +
          "• Si es un cliente nuevo que escribió su calle pero no adjuntó GPS, en su pedido toca <strong>📍 Ubicar en Mapa</strong> y haz un clic donde queda su negocio: ¡así ya tendrá foquito automático siempre!",
        example:
          "Ejemplo: Pide 'Taquería El Primo' 3 cajas de Media maduras. Suena la alarma y arriba te avisa: '¡1 pedido nuevo sin asignar!'."
      },
      {
        num: "3",
        icon: "🚗",
        heading: "Asignar el pedido al vendedor ideal (evitando vueltas en balde)",
        bodyHtml:
          "Antes de asignar un pedido, revisa dos cosas rapidísimo:<br>" +
          "1. En el <strong>Mapa (🗺️ Ruta, GPS y Cortes)</strong> mira quién anda más cerca del foquito rojo y cuántas cajas / qué madurez lleva en su carro.<br>" +
          "2. Selecciona el nombre del chofer ahí mismo dentro del foquito del mapa (o en <strong>📦 Pedidos en Línea</strong>).<br>" +
          "3. Al asignarlo, el pedido aparece <strong>instantáneamente en el celular del chofer</strong> (y si gustas también puedes tocar <strong>Enviar a Chofer</strong> para mandarle copia a su WhatsApp con link de Google Maps).",
        example:
          "Ventaja: Así nunca le asignas un pedido de aguacate Maduro a un chofer que hoy solo salió con Verde o que ya se quedó sin calibre Extra."
      },
      {
        num: "4",
        icon: "🏪",
        heading: "Guardar tiendas nuevas que manden por WhatsApp",
        bodyHtml:
          "Los choferes ya pueden guardar tiendas nuevas solos desde su celular, pero si tienes ubicaciones guardadas en WhatsApp:<br>" +
          "1. Ve a <strong>🗺️ Ruta, GPS y Cortes</strong> y toca <strong>➕ Punto / Tienda</strong>.<br>" +
          "2. Elige si es Tienda, Carnicería, Restaurante o Frutería, pon su nombre y pega el enlace de Google Maps (o toca <strong>👆 Elegir en Mapa</strong>).<br>" +
          "3. Toca <strong>💾 Guardar Negocio en el Mapa</strong>.",
        example:
          "Cada negocio guardado aparecerá en el mapa para supervisar que los vendedores pasen a visitarlo."
      },
      {
        num: "5",
        icon: "🧾",
        heading: "En la tarde: Recibir el Corte del Chofer sin enredos de papelitos",
        bodyHtml:
          "Cuando un vendedor regresa a cerrar el día:<br>" +
          "1. Primero <strong>Güerita</strong> cuenta cuántas cajas físicas sobrantes bajó del carro y las anota en Devolución.<br>" +
          "2. Tú abres <strong>🗺️ Ruta, GPS y Cortes</strong> y miras la tarjeta del chofer en <strong>Pre-Corte Automático</strong>:<br>" +
          "&nbsp;&nbsp;• Si dice <strong>✓ ¡Cajas cuadran al 100%!</strong>, no falta ni una sola caja.<br>" +
          "&nbsp;&nbsp;• Si dice <strong>⚠️ Faltan X cajas por comprobar</strong>, es que olvidó anotar una venta o devolver cajas.<br>" +
          "&nbsp;&nbsp;• El recuadro verde oscuro te dice al centavo cuánto <strong>💵 Efectivo a Entregar</strong> debe darte en la mano, cuánto entró por <strong>🏦 Transferencia</strong> y quién quedó con <strong>📝 Crédito / Resta</strong>.",
        example:
          "Ejemplo: 'Efectivo a Entregar: $4,850' -> Cuentas los billetes, revisas en el banco las transferencias anotadas y ¡corte terminado en 1 minuto!"
      }
    ],
    whatsappText:
      `💼 *MANUAL DE OFICINA Y ADMINISTRACIÓN — SALINAS*\n` +
      `*(Para Liz y Alejandra)*\n\n` +
      `1️⃣ *Precios de la mañana (en 15 seg):* Pestaña *🏷️ Precios y Difusión* -> actualiza precios -> toca *📋 Copiar Mensaje de Hoy* y pégalo en las 2 Listas de Difusión de WhatsApp.\n\n` +
      `2️⃣ *Alarma de pedidos nuevos:* Al entrar toca *🔔 Sonido* arriba a la derecha. Cada pedido nuevo suena, prende barra roja arriba y enciende un *🔴 Foquito Rojo* en el mapa.\n\n` +
      `3️⃣ *Asignar chofer:* Toca el Foquito Rojo en el mapa, revisa qué carro anda cerca y trae esa madurez/calibre, y asígnaselo ahí mismo (le llega directo a su celular).\n\n` +
      `4️⃣ *Agregar tiendas al mapa:* En *🗺️ Ruta, GPS y Cortes* toca *➕ Punto / Tienda* para pegar links de ubicaciones o elegirlas en el mapa.\n\n` +
      `5️⃣ *Corte de la tarde en 1 minuto:* Primero Güerita anota las cajas devueltas en Almacén; luego tú ves en *Pre-Corte Automático* si las cajas cuadran al 100% y el monto exacto de *💵 Efectivo a Entregar* que debes recibir.`
  },

  almacen: {
    id: "almacen",
    shortTab: "📦 Almacén ('Güerita')",
    badge: "NIVEL 3 • BODEGA, SALIDAS Y DEVOLUCIONES",
    title: "Manual Súper Sencillo de Almacén",
    people: "Para 'Güerita' (Encargada de Almacén)",
    summary:
      "¡Hola Güerita! Con este sistema ya no tienes que batallar haciendo sumas y restas a mano ni llenando copias de tarjetas. Tú solo usas la primera pantalla (📋 Control de Almacén) y únicamente haces 3 pasos muy fáciles durante el día.",
    accessNote:
      "Entras al Panel (/admin.html) y ya aparece abierta tu pestaña: 📋 Control de Almacén. No necesitas moverle a ninguna otra pestaña.",
    steps: [
      {
        num: "1",
        icon: "🌅",
        heading: "Paso 1 (Al abrir en la mañana): Anotar con cuántas cajas empezamos",
        bodyHtml:
          "1. Revisa que arriba diga la <strong>Fecha de hoy</strong>.<br>" +
          "2. Toca el botón <strong>↺ Jalar Cierre Ayer</strong>: eso copia solito las cajas que sobraron ayer en el piso para que no las escribas otra vez (o si prefieres, escríbelas tú en <strong>M, P, E y S</strong>).<br>" +
          "3. <strong>¿Sacaron cajas nuevas del cuarto frío / refrigerador al piso?</strong> Escribe cuántas sacaron en los cuadritos azules que dicen <strong>+ M, + P, + E, + S</strong>.<br>" +
          "4. Toca el botón verde <strong>Guardar Inventario Base</strong>.<br>" +
          "<em>(Nota: Si más tarde a mediodía sacan otras cajas del refrigerador, nada más súmalas ahí mismo en los cuadritos +M, +P, +E, +S y vuelve a tocar Guardar).</em>",
        example:
          "Ejemplo: Amanecieron 10 cajas de Primera en piso y sacaron 20 más del refrigerador -> En 'P' hay 10 y en '+ P' pones 20. El sistema suma solito 30 en piso."
      },
      {
        num: "2",
        icon: "🚚",
        heading: "Paso 2 (Cada vez que sale un carro): Registrar qué se lleva el chofer",
        bodyHtml:
          "Cada vez que <strong>Carlos, Tello, Alejandro o Liz</strong> suban cajas a su carro para salir a vender:<br>" +
          "1. Ve al recuadro que dice <strong>2. Registrar Salida de Carro (Nueva Vuelta)</strong>.<br>" +
          "2. En <strong>Chofer / Vendedor</strong> elige el nombre de quién se lleva el carro.<br>" +
          "3. En <strong>Maduración que lleva</strong> elige cómo va la fruta (<em>Maduro, Sazón, Quebrado, Verde, Maduro y Sazón, etc.</em>).<br>" +
          "4. Escribe cuántas cajas subió de cada tamaño: <strong>M (Media), P (Primera), E (Extra) y S (Super)</strong>.<br>" +
          "5. Toca el botón verde <strong>+ Dar Salida de Carro</strong>.<br>" +
          "<em>¡Y listo! Si ese mismo vendedor regresa más tarde por una segunda o tercera vuelta, vuelves a llenar este mismo cuadrito igualito.</em>",
        example:
          "Ejemplo: Sale Carlos a las 8:30 AM con aguacate Maduro: 5 de Media, 10 de Primera, 5 de Extra y 0 de Super -> Tocas '+ Dar Salida de Carro' y ya quedó guardado con la hora exacta."
      },
      {
        num: "3",
        icon: "↩️",
        heading: "Paso 3 (Cuando regresa un carro): Anotar cuántas cajas devolvió",
        bodyHtml:
          "Cuando el vendedor termina su vuelta y baja cajas que no vendió:<br>" +
          "1. Baja hasta la lista <strong>3. Bitácora de Vueltas y Devoluciones</strong>.<br>" +
          "2. Busca el renglón o tarjeta de ese chofer y toca el botón <strong>Editar / Devolución</strong>.<br>" +
          "3. Se abre una ventanita: en la parte de abajo que dice <strong>DEVOLUCIÓN A BODEGA</strong> escribe cuántas cajas regresó de <strong>M, P, E y S</strong>.<br>" +
          "4. Toca <strong>Guardar Cambios</strong>.<br>" +
          "¡El sistema resta solito lo que vendió y vuelve a sumar las cajas devueltas a tu existencia en piso!",
        example:
          "Ejemplo: Carlos se había llevado 10 cajas de Primera y regresó 2 cajas buenas -> Pones '2' en Devolución P, guardas, y el sistema calcula solito que vendió 8 y regresa esas 2 al piso."
      },
      {
        num: "4",
        icon: "✅",
        heading: "¿Cómo sé si mi almacén está cuadrado al cerrar el día?",
        bodyHtml:
          "Mira los cuadros de hasta arriba (el primer cuadro verde oscuro dice <strong>TOTAL EN PISO</strong>):<br>" +
          "• Ese número te dice cuántas cajas físicas deben estar paradas ahorita mismo en el piso de la bodega (separadas por M, P, E y S).<br>" +
          "• Si cuentas las cajas del piso al final de la tarde y coinciden con esos números, <strong>¡tu almacén cerró perfecto!</strong> Si necesitan hoja en papel, toca <strong>🖨️ Imprimir Corte</strong>.",
        example:
          "Recuerda los 4 códigos de siempre: M = Media | P = Primera | E = Extra | S = Super."
      }
    ],
    whatsappText:
      `📦 *GUÍA FÁCIL DE ALMACÉN — PARA GÜERITA* 🥑\n\n` +
      `¡Hola Güerita! Solo ocupas usar la primera pantalla (*📋 Control de Almacén*) con estos *3 pasos sencillos*:\n\n` +
      `1️⃣ *EN LA MAÑANA (Al abrir):*\n` +
      `• Toca *↺ Jalar Cierre Ayer* para poner las cajas con las que amanecimos.\n` +
      `• Si sacan cajas del refrigerador/cámara fría, anótalas en los cuadritos *+M, +P, +E, +S*.\n` +
      `• Toca *Guardar Inventario Base*.\n\n` +
      `2️⃣ *CADA VEZ QUE SALE UN CARRO:*\n` +
      `• Ve a *2. Registrar Salida de Carro*.\n` +
      `• Elige el *Chofer* (Carlos, Tello, Alejandro o Liz) y qué *Maduración* lleva (Maduro, Sazón, Quebrado, Verde).\n` +
      `• Pon cuántas cajas sube de *M, P, E y S* y toca *+ Dar Salida de Carro*.\n` +
      `*(Si da otra vuelta más tarde, haces lo mismo otra vez).* \n\n` +
      `3️⃣ *CUANDO REGRESA CON CAJAS SOBRANTES:*\n` +
      `• Abajo en la lista busca su vuelta y toca *Editar / Devolución*.\n` +
      `• Escribe cuántas cajas regresó en *Devolución (M, P, E, S)* y toca *Guardar Cambios*.\n\n` +
      `✨ *¡El sistema suma y resta todo solito!* Arriba en el cuadro verde oscuro siempre verás cuántas cajas exactas deben haber en piso.`
  },

  ventas: {
    id: "ventas",
    shortTab: "🚗 Ventas (Carlos, Tello, Alejandro, Liz)",
    badge: "NIVEL 4 • RUTA, CLIENTES, VENTAS Y CORTE",
    title: "Manual de Ventas en Ruta (App Celular)",
    people: "Carlos, Tello, Alejandro y Liz",
    summary:
      "Esta es tu herramienta de bolsillo en la calle (/chofer.html). Te dice cuántas cajas traes en el carro, te avisa de pedidos nuevos, guarda tiendas con GPS sin mandar WhatsApps sueltos, manda notas digitales a los clientes y te arma tu corte solito.",
    accessNote:
      "Abre en tu celular aguacates-salinas.web.app/chofer.html, elige tu nombre (Carlos, Tello, Alejandro o Liz), pon tu PIN de 4 números y deja marcada la casilla 'Mantener sesión iniciada'.",
    steps: [
      {
        num: "1",
        icon: "🛰️",
        heading: "Al subirte al carro: Prende tu GPS con 1 toque",
        bodyHtml:
          "En cuanto entres a la app, mira arriba a la derecha y toca el botón <strong>⚪ Activar GPS</strong> para que se ponga en verde: <strong>🟢 GPS Activo</strong>.<br>" +
          "• Déjala abierta mientras manejas (el sistema evita que tu pantalla se duerma).<br>" +
          "• Así Oficina ve en qué colonia andas para mandarte los pedidos que queden cerquita de ti y no hacerte dar vueltas de embalde.",
        example:
          "Cuando ya termines tu día y apagues el carro en la bodega, vuelves a tocar el botón para apagar el GPS."
      },
      {
        num: "2",
        icon: "🚗",
        heading: "Botón 1 abajo — 'Mi Ruta': Tus cajas disponibles y Pedidos de Oficina",
        bodyHtml:
          "• <strong>Cuadro verde de arriba:</strong> Te muestra cuántas cajas te cargó Güerita hoy y cuántas te quedan libres en el carro de <strong>M, P, E y S</strong>.<br>" +
          "• <strong>Pedidos Asignados por Oficina:</strong> Cuando caiga un pedido para ti, aparece aquí mismo con la dirección y qué madurez pidió:<br>" +
          "&nbsp;&nbsp;1. Toca <strong>📍 Abrir Mapa</strong> para que Google Maps te lleve directo o <strong>📞 Llamar</strong> si necesitas hablarle.<br>" +
          "&nbsp;&nbsp;2. Toca <strong>🚗 Voy en Camino</strong> cuando vayas para allá.<br>" +
          "&nbsp;&nbsp;3. Al bajar las cajas y cobrarle, toca <strong>✅ Entregar y Cobrar</strong> para confirmar cómo te pagó.",
        example:
          "En cuanto confirmas la entrega, esas cajas se descuentan solitas de tu carro y se suman a tu corte del día."
      },
      {
        num: "3",
        icon: "🏪",
        heading: "Botón 2 abajo — 'Clientes': Guardar tiendas nuevas y marcar visitas",
        bodyHtml:
          "<strong>¡Ya no mandes ubicaciones sueltas por WhatsApp!</strong> Toca el botón <strong>🏪 Clientes</strong> abajo:<br>" +
          "• <strong>¿Llegaste a un negocio nuevo?</strong> Párate afuera del local, toca el botón verde <strong>📍 Guardar Nuevo Negocio Aquí (GPS)</strong>, elige si es Tienda, Carnicería, Restaurante o Frutería, escribe su nombre y guárdalo. ¡Queda en el mapa para siempre!<br>" +
          "• <strong>¿Fuiste a ver a un cliente guardado y SÍ te compró?</strong> Búscalo en la lista y toca <strong>➕ Venderle</strong> (ya llena su nombre y celular por ti).<br>" +
          "• <strong>¿Pasaste a verlo pero HOY NO compró (tenía aguacate o estaba cerrado)?</strong> Toca <strong>📍 Pasé (Sin venta)</strong> y elige el motivo. Eso registra tu ubicación GPS y pinta la tienda en amarillo en el mapa para comprobar que sí cumpliste con visitarla.",
        example:
          "Ejemplo: Pasas a 'Abarrotes Don Pepe' y todavía tiene media caja. Tocas '📍 Pasé (Sin venta)' -> 'Aún tiene aguacate' y en oficina ven que ya cumpliste con pasar."
      },
      {
        num: "4",
        icon: "➕",
        heading: "Botón 3 abajo — 'Vender': Ventas rápidas en calle y Nota Digital",
        bodyHtml:
          "Para cualquier venta directa en tu recorrido, toca <strong>➕ Vender</strong>:<br>" +
          "1. Escribe el nombre del cliente o negocio.<br>" +
          "2. Toca <strong>+</strong> en las cajas que le entregas (<strong>S, E, P o M</strong>). Si le mejoras el precio, cámbialo en el cuadrito de <em>$ Precio</em> (el sistema te cuida avisándote cuál es el precio mínimo autorizado).<br>" +
          "3. Elige cómo te pagó:<br>" +
          "&nbsp;&nbsp;• <strong>💵 Efectivo</strong> o <strong>🏦 Transferencia</strong>.<br>" +
          "&nbsp;&nbsp;• <strong>📝 Crédito / Deja Anticipo:</strong> Pide siempre su celular de 10 dígitos; si te dio una parte en efectivo ponla en <em>Anticipo</em> y el sistema calcula solito cuánto resta deber.<br>" +
          "4. Toca <strong>✅ Registrar Venta</strong>. Enseguida te saldrá la pantalla para tocar <strong>📲 Mandar Nota por WhatsApp al Cliente</strong> con su folio oficial.",
        example:
          "Si el cliente además te pide papelito físico, se lo das, pero igual regístrala siempre aquí para que tus cajas y tu dinero cuadren al regresar."
      },
      {
        num: "5",
        icon: "💰",
        heading: "Botón 4 abajo — 'Mi Corte': Cerrar tu día sin cuentas ni discusiones",
        bodyHtml:
          "Toca <strong>💰 Mi Corte</strong> en cualquier momento del día o antes de llegar a la bodega:<br>" +
          "• Te dice exactamente <strong>cuántas cajas físicas debes devolverle a Güerita</strong>.<br>" +
          "• Te dice al peso exacto <strong>cuánto Efectivo en billetes debes entregar en Oficina</strong> (ya descontando lo que fue por transferencia o crédito).<br>" +
          "• Abajo ves la lista de todas tus notas del día por si quieres revisar alguna o reenviarla por WhatsApp.",
        example:
          "Si el número de cajas en tu cajuela y tus billetes coinciden con lo que dice 'Mi Corte', entregas en 1 minuto y te vas tranquilo a casa."
      }
    ],
    whatsappText:
      `🚗 *MANUAL DE RUTA EN CELULAR — AGUACATES SALINAS*\n` +
      `*(Para Carlos, Tello, Alejandro y Liz)*\n\n` +
      `👉 *Tu link de trabajo:* https://aguacates-salinas.web.app/chofer.html\n` +
      `*(Elige tu nombre e ingresa tu PIN personal de 4 dígitos)*\n\n` +
      `1️⃣ *Al salir:* Toca arriba *⚪ Activar GPS* para que pase a *🟢 GPS Activo* y oficina sepa qué pedidos cercanos mandarte.\n\n` +
      `2️⃣ *🚗 Mi Ruta:* Ahí ves cuántas cajas traes libres en el carro y los pedidos que te asigna Oficina (*📍 Abrir Mapa* -> *🚗 Voy en Camino* -> *✅ Entregar y Cobrar*).\n\n` +
      `3️⃣ *🏪 Clientes (Tiendas, Carnicerías, Restaurantes):*\n` +
      `• *Negocio nuevo:* Ya NO mandes ubicación suelta por WhatsApp; toca *📍 Guardar Nuevo Negocio Aquí (GPS)*.\n` +
      `• *Si pasaste pero hoy no compró:* Búscalo y toca *📍 Pasé (Sin venta)* para que quede registrada tu visita en el mapa.\n\n` +
      `4️⃣ *➕ Vender:* Anota cajas entregadas y cómo pagó (*Efectivo, Transferencia o Crédito con Anticipo*). Al guardar puedes mandarle su *📲 Nota Digital por WhatsApp* en 1 toque.\n\n` +
      `5️⃣ *💰 Mi Corte:* Te dice sin calculadora cuántas cajas exactas devuelves a Güerita en almacén y cuánto efectivo exacto entregas en oficina.`
  },

  clientes: {
    id: "clientes",
    shortTab: "🛒 Guía Pública Clientes",
    badge: "PÚBLICO • VISIBLE EN LA TIENDA EN LÍNEA",
    title: "Explicación Pública para Clientes (Tienda Web)",
    people: "Clientes de Tiendas, Carnicerías, Restaurantes y Fruterías",
    summary:
      "Esta es la explicación amigable y 100% pública que ya ven los clientes directamente al entrar a aguacates-salinas.web.app (no muestra absolutamente nada interno de almacén, choferes ni administración).",
    accessNote:
      "Pública en https://aguacates-salinas.web.app — También puedes copiar este texto si un cliente te pregunta por WhatsApp cómo pedir en la página.",
    steps: [
      {
        num: "1",
        icon: "🥑",
        heading: "Paso 1: Elige tus Cajas y Tamaño",
        bodyHtml:
          "Entra al enlace de la tienda y toca el botón <strong>+</strong> en los tamaños que ocupes hoy (<strong>Super, Extra, Primera o Media</strong>). Puedes combinar varios calibres y ver tu total al momento con los precios actualizados del día.",
        example: ""
      },
      {
        num: "2",
        icon: "📍",
        heading: "Paso 2: Tus Datos, Punto de Madurez y Ubicación",
        bodyHtml:
          "Escribe el nombre de tu negocio, tu celular, cómo prefieres tu aguacate (<strong>Maduro listo para hoy, Sazón, Quebrado o Verde</strong>) y toca <strong>📍 Adjuntar mi ubicación GPS</strong> si estás en tu local para llegar directo. Tu teléfono guardará tus datos para tus próximos pedidos.",
        example: ""
      },
      {
        num: "3",
        icon: "🚚",
        heading: "Paso 3: Confirma en 1 Toque y Paga al Recibir",
        bodyHtml:
          "Presiona <strong>Confirmar Pedido en Línea</strong>. Tu orden entra directo con folio a nuestro reparto, puedes ver en vivo cuando va en camino desde el botón <strong>Mis Pedidos</strong> y pagas al recibir tu mercancía (<strong>Efectivo o Transferencia</strong>).",
        example: ""
      }
    ],
    whatsappText:
      `🥑 *¿CÓMO HACER TU PEDIDO EN LÍNEA? — COMERCIALIZADORA SALINAS*\n\n` +
      `Levanta tu pedido en menos de 30 segundos aquí:\n` +
      `👉 https://aguacates-salinas.web.app\n\n` +
      `1️⃣ *Elige tus cajas:* Toca *(+)* en los tamaños que necesites (*Super, Extra, Primera o Media*). Ahí mismo ves el precio del día.\n` +
      `2️⃣ *Indica tu madurez y datos:* Elige si lo quieres *Maduro para hoy, Sazón, Quebrado o Verde*. Si estás en tu negocio, toca *📍 Adjuntar mi ubicación GPS* una sola vez (tu celular recordará tus datos para la próxima).\n` +
      `3️⃣ *Confirma y recibe:* Toca *Confirmar Pedido en Línea* y paga al recibir tu mercancía en *Efectivo o Transferencia*.\n\n` +
      `_“La lealtad es escasa en estos tiempos y nosotros la valoramos. Gracias por tu lealtad.”_`
  }
};
