# Vinculacion TaleSpire / Foundry v14

Version del modulo: 1.4.0 (el Symbiote sigue en 1.3.0, sin cambios). Protocolo y persistencia: 1.

## Instalacion

1. Mantener los componentes actuales que permiten abrir Foundry en TaleSpire y el bridge de dados.
2. Instalar talespire-mini-link dentro de Data/modules. module.json debe quedar directamente dentro de esa carpeta.
3. Reiniciar Foundry si el nuevo modulo no aparece. Activar TaleSpire Foundry Bridge - Mini Links en el mundo.
4. Instalar/actualizar rolfoundry en la carpeta Symbiotes de TaleSpire. manifest.json debe quedar directamente dentro de rolfoundry, sin una segunda carpeta rolfoundry anidada.
5. Cerrar y volver a abrir el Symbiote para cargar las nuevas suscripciones y el extra.

Rutas habituales en Windows:

    <carpeta de datos de Foundry>\Data\modules\talespire-mini-link
    %USERPROFILE%\AppData\LocalLow\BouncyRock Entertainment\TaleSpire\Symbiotes\rolfoundry

El paquete minimo de Symbiote tiene cuatro archivos: manifest.json, logo.png, talespire-roll-return.js y talespire-mini-link.js. El entryPoint del manifest debe ser la URL publica de tu servidor de Foundry; ese servidor debe tener su propia compatibilidad de navegador y modulos. Este paquete no instala parches de servidor.

## Uso

Abrir el panel con el boton de cadena de los controles de Tokens, en la columna de herramientas del menu lateral izquierdo. El panel muestra conexion, seleccion y vinculos accesibles.

1. Entrar como el GM activo designado por Foundry.
2. Seleccionar un token de escena en el canvas del cliente Foundry abierto DENTRO del Symbiote.
3. Seleccionar una sola mini de TaleSpire.
4. Pulsar Vincular mini seleccionada.
5. Si existe alguna asociacion para esa mini o ese token, confirmar su reemplazo.

Seleccionar token controla y centra el token de Foundry, cambiando de escena solo mediante esta accion explicita. Abrir hoja usa la hoja configurada del actor del token, incluida una hoja personalizada. Consultar mini muestra informacion de TaleSpire, no modifica la seleccion de TaleSpire. Desvincular elimina solo la relacion, nunca el token, actor o mini.

### Objetivo al seleccionar (1.4.0)

Marcar como objetivo al seleccionar una mini (ajuste de cliente, activado por defecto). Durante la partida el jugador solo selecciona en TaleSpire la mini a la que quiere pegarle y ataca desde Foundry o VN Enhanced:

- Una mini vinculada que no es tuya pasa a ser tu objetivo en Foundry, el mismo que pone Select as target de VN Enhanced. VN pinta la placa, el duelo y el HUD sin cambios propios.
- Varias minis seleccionadas en TaleSpire = varios objetivos (areas, hechizos multiobjetivo).
- Tu propia mini nunca se marca como objetivo. Deseleccionar en TaleSpire (clic en el suelo) conserva los objetivos.
- Para el GM, sus tokens son los que no tienen dueno jugador (PNJs): seleccionar un PJ lo marca como objetivo.
- No hace falta ser dueno ni tener permiso OBSERVER sobre el enemigo. Se comprueba el token colocado: escena que estas viendo, no oculto por el GM y mismo actor que al vincular.
- Cada enemigo debe estar vinculado una vez por el GM. Una mini sin vinculo no hace nada.

La seleccion automatica es opcional y esta desactivada inicialmente. Con el objetivo automatico activo, controla solo tu propia mini vinculada (el atacante), de modo que elegir un enemigo nunca cambia quien ataca; sin el, controla la mini vinculada seleccionada como en 1.3.0. No cambia escenas automaticamente. El enfoque automatico requiere activar tambien la seleccion automatica.

## Identidad y almacenamiento

La clave es Campaign ID + Creature Instance ID de TaleSpire. El destino es el Token UUID completo Scene.<id>.Token.<id>. Actor UUID y estado de actor sintetico se guardan como comprobacion adicional, nunca como sustitucion de un token desaparecido.

Fuente principal: game.settings, namespace talespire-mini-link, clave links (world). Copia recuperable: flags.talespire-mini-link.link de cada TokenDocument. No se usan Actor flags ni localStorage para identidad.

Los nombres no determinan asociaciones y no se almacenan en el registro compartido. El panel resuelve nombres de Foundry despues de comprobar acceso; el nombre de la mini seleccionada procede de TaleSpire. Para otras minis se muestra su ID. Los IDs y metadatos de enlace de world settings no son secretos frente a usuarios autenticados.

Las relaciones sobreviven recargas y reinicios por estar en los datos del mundo. La verificacion real de reinicios queda pendiente (ver QA). Hacer respaldo del mundo antes de actualizar o distribuir.

Recuperar flags de tokens incorpora asociaciones validas ausentes del registro. No sobrescribe conflictos. Omite flags copiados cuyo UUID estampado no coincide con el token actual, y relaciones previamente retiradas. Las marcas de retirada evitan resucitar asociaciones si fallo limpiar un flag. No borrar el registro manualmente: se perderian esas marcas.

Los flags recuperados no se consideran autoridad: sus propietarios pueden editarlos. La recuperacion exige confirmar como GM la lista exacta de asociaciones y rechaza cambios mientras esta abierta la confirmacion.

## Arquitectura

El manifest existente carga Foundry directamente como pagina remota. El extra del Symbiote publica TML_SYMBIOTE.request en esa misma pagina; el modulo consume solicitudes/respuestas versionadas y correlacionadas. No se introduce iframe, servidor, puerto, socket de comandos ni postMessage.

El extra solo lee la API de TaleSpire. El modulo valida seleccion, controla permisos y guarda vinculos. HELLO/PING consultan disponibilidad; el panel abierto se actualiza cada cinco segundos y por eventos. Las solicitudes tienen timeout. Las suscripciones solo invalidan datos; las selecciones se vuelven a consultar mediante la API.

La sincronizacion de registros entre clientes usa las world settings de Foundry. La seleccion de canvas sigue siendo local a cada cliente. No hay retransmision de seleccion entre el navegador de escritorio y el Symbiote.

## Seguridad y limites

- Crear, reemplazar, recuperar y borrar vinculos requiere el GM activo designado. Usar SOLO una sesion editora de ese GM: no hay transacciones distribuidas entre dos sesiones de la misma cuenta.
- Los jugadores ven en el panel solo tokens accesibles, no ocultos, con permiso OBSERVER sobre el actor. Para controlar un token hace falta ownership. No se cambia ownership.
- La API publica consultada no ofrece seleccionar/enfocar una mini arbitraria desde Foundry. Esas capacidades se declaran no compatibles. El objetivo va de TaleSpire a Foundry, no al reves: marcar un objetivo en Foundry no selecciona la mini. No se implementa HP sync ni modificacion de iniciativa.
- El combate actual puede consultarse en la API del modulo y en depuracion. No se mueve el turno ni se resaltan minis automaticamente.
- El canvas debe estar habilitado para seleccionar tokens. Una interfaz VN que lo oculte requiere mostrarlo temporalmente para crear el vinculo.
- Si Foundry se apaga completamente, la pagina puede necesitar recargarse cuando vuelva. No se puede garantizar reconexion de una pagina que ya no existe.
- El borrado de una mini se refleja cuando se consulta su informacion; no se elimina automaticamente la asociacion persistente. La lista valida la mitad Foundry del vinculo, no la existencia continua de todas las minis.
- La instalacion no reemplaza las limitaciones del navegador integrado de TaleSpire ni aplica nuevos parches al core.

## Diagnostico

Activar Depuracion de vinculos en ajustes. El panel muestra versiones, capacidades y combatiente actual; la consola registra errores con prefijo [TaleSpireFoundry].

Desconectado: comprobar que se usa el Symbiote actualizado, no un navegador normal, y que la campana TaleSpire esta abierta. Protocolo incompatible: actualizar ambos componentes. Sin token: seleccionarlo en ese mismo cliente y comprobar que existe canvas. Actor cambiado: volver a vincular expresamente. Token desaparecido: desvincular o seleccionar otro destino.

Para retirar esta funcion, desactivar talespire-mini-link. No afecta al bridge de dados. En el manifest puede retirarse /talespire-mini-link.js de extras y el bloque de suscripciones creatures, conservando dice y symbiote. No borrar otros extras ni aplicar scripts antiguos de restauracion del core.
