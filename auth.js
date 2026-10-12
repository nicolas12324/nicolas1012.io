/* ==========================================================================
   DESBLOQUEO DE LA ZONA DE CUADRE (lado del navegador)
   Se mantiene desbloqueada mientras la pestaña del navegador siga abierta.
   ========================================================================== */
window.Auth = (function () {
  const KEY = "tienda.cuadre";
  let memory = false;

  function unlock(user, pass) {
    const u = String(user || "").trim().toLowerCase();
    const ok = APP_CONFIG.users.some(
      (x) => x.user.toLowerCase() === u && x.pass === String(pass || "")
    );
    if (ok) {
      memory = true;
      try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    }
    return ok;
  }

  function lock() {
    memory = false;
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }

  function isUnlocked() {
    try { return memory || sessionStorage.getItem(KEY) === "1"; }
    catch (e) { return memory; }
  }

  return { unlock, lock, isUnlocked };
})();
