/**
 * TaleSpire Foundry Bridge - Mini Links - enganche del soft gate.
 *
 * Entrada propia en `esmodules`, deliberadamente separada del resto del modulo:
 * el gate no toca ni una linea del codigo existente, asi que no puede romperlo,
 * y quitarlo es borrar esta carpeta y dos lineas del manifiesto.
 *
 * Con Velvet License Hub activo en el mundo, la licencia es del hub: este
 * modulo se registra en el y se calla — ni llama al servidor, ni muestra
 * tarjeta, ni recordatorio propio. Una sola conexion de Patreon cubre a todos.
 * Sin hub, el flujo individual de siempre, con su prueba gratuita.
 *
 * Todo va envuelto en try/catch: la regla de oro del soft gate es que ninguna
 * funcion se bloquea jamas, y eso incluye que un fallo de la propia capa de
 * licencia no pueda tumbar el modulo.
 */

import { MODULE_ID, MODULE_TITLE } from "./constants.js";
import LicenseClient from "./license.js";
import LicenseUI, { licenseMenuClass, isWorldLicensed } from "./license-ui.js";

const HUB_ID = "velvet-license-hub";

/**
 * La API del hub, o null para usar el flujo propio de este modulo.
 *
 * Un hub activo cuya API nunca aparecio (fallo al inicializar) cuenta como
 * ausente: mejor una tarjeta de mas que un modulo que no pregunta nunca.
 * @returns {object|null}
 */
function licenseHub() {
  const hub = game.modules.get(HUB_ID);
  return (hub?.active && (hub.api?.apiVersion >= 1)) ? hub.api : null;
}

Hooks.once("init", () => {
  try {
    game.settings.register(MODULE_ID, "worldLicensed", {
      scope: "world", config: false, type: Boolean, default: false
    });
    // Con el hub activo, su menu es el unico sitio donde gestionar la licencia:
    // una entrada "Licencia de Patreon" por modulo solo llenaria los ajustes.
    // Aqui solo se puede saber si esta activo; su API se publica en su propio
    // init, que puede no haber corrido todavia.
    if ( !game.modules.get(HUB_ID)?.active ) {
      game.settings.registerMenu(MODULE_ID, "licenseMenu", {
        name:  "talespire-mini-link.Settings.License.Name",
        label: "talespire-mini-link.Settings.License.Label",
        hint:  "talespire-mini-link.Settings.License.Hint",
        icon:  "fa-brands fa-patreon",
        type:  licenseMenuClass(),
        restricted: true
      });
    }
  }
  catch ( error ) {
    console.error(`${MODULE_TITLE} | No se pudo registrar la licencia`, error);
  }
});

Hooks.once("ready", async () => {
  // Foundry tambien carga los modulos en join, setup y stream, donde no hay
  // mundo que licenciar ni GM a quien preguntar.
  if ( game.view !== "game" ) return;
  try {
    const hub = licenseHub();
    if ( hub ) {
      // Antes de cualquier await: el hub decide si mostrar su tarjeta despues
      // de que todos los modulos se hayan registrado.
      hub.register(MODULE_ID);
      return;
    }
    if ( game.user?.isGM ) {
      const client = LicenseClient.instance;
      const licensed = await client.initialize();
      if ( licensed ) await game.settings.set(MODULE_ID, "worldLicensed", true);
      else if ( !client.hasStoredCredentials && !isWorldLicensed() ) LicenseUI.show();
    }
    // Los jugadores solo leen el flag de mundo: nunca hablan con el servidor.
    LicenseUI.startReminder();
  }
  catch ( error ) {
    console.error(`${MODULE_TITLE} | Fallo la comprobacion de licencia`, error);
  }
});

// Activar a mitad de sesion silencia el recordatorio en todos los clientes sin
// necesidad de recargar. Con el hub activo el recordatorio propio no arranca
// nunca, asi que tampoco hay nada que reanudar.
Hooks.on("updateSetting", setting => {
  if ( setting.key !== `${MODULE_ID}.worldLicensed` ) return;
  if ( licenseHub() ) return;
  if ( isWorldLicensed() ) LicenseUI.stopReminder();
  else LicenseUI.startReminder();
});
